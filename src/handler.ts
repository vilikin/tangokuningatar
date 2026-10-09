import type { BotApi } from "./bot-api";
import { saveScores } from "./db";
import { findShamefulGames, GAMES, parseScores, SHAMEFUL_GAMES, type Score, type ShamefulGameId } from "./parser";
import type { Chat, ChatMemberUpdated, Message, Update, User } from "./telegram";

// Must be among the emoji Telegram allows bots to react with.
export const SCORE_REACTION = "👍";
export const SHAME_REACTION = "👎";

/**
 * Handles an authenticated update. Only updates from ALLOWED_CHAT_ID are logged
 * in full, and only scores posted there are saved and get a 👍. Pinpoint and
 * Crossclimb results get a 👎 and a shaming reply. Anything else gets a single
 * metadata line without message content.
 */
export async function handleUpdate(update: Update, env: Env, bot: BotApi): Promise<void> {
  const allowedChatId = env.ALLOWED_CHAT_ID?.trim();
  if (!allowedChatId) {
    console.error({
      event: "config_error",
      message: "ALLOWED_CHAT_ID is not set; ignoring all updates",
      update_id: update.update_id,
    });
    return;
  }

  if (update.message) {
    await handleMessage(update, update.message, allowedChatId, env.DB, bot);
  } else if (update.my_chat_member) {
    handleMyChatMember(update, update.my_chat_member, allowedChatId);
  } else {
    console.log({
      event: "ignored_update",
      update_id: update.update_id,
      reason: "unsupported update type",
      fields: Object.keys(update),
    });
  }
}

async function handleMessage(
  update: Update,
  message: Message,
  allowedChatId: string,
  db: D1Database,
  bot: BotApi,
): Promise<void> {
  const chatId = String(message.chat.id);

  // Telegram's half of a group → supergroup upgrade that arrives in the *new* chat,
  // which isn't allowlisted yet. Without this it would be silently ignored.
  if (message.migrate_from_chat_id !== undefined && String(message.migrate_from_chat_id) === allowedChatId) {
    logMigration(update, allowedChatId, chatId);
  }

  if (chatId !== allowedChatId) {
    logIgnored(update, "message", message.chat);
    return;
  }

  if (message.migrate_to_chat_id !== undefined) {
    logMigration(update, allowedChatId, String(message.migrate_to_chat_id));
  }

  const text = message.text ?? message.caption ?? null;
  const scores = text ? parseScores(text) : [];
  const shamefulGames = text ? findShamefulGames(text) : [];
  console.log({
    event: "group_message",
    update_id: update.update_id,
    message_id: message.message_id,
    date: toIsoDate(message.date),
    ...describeSender(message.from),
    ...(message.sender_chat && { sender_chat_id: message.sender_chat.id, sender_chat_title: message.sender_chat.title }),
    text,
    scores,
    shameful_games: shamefulGames,
    raw: JSON.stringify(update),
  });

  const stored = scores.length > 0 && (await storeScores(update, message, scores, db));

  // A bot gets one reaction per message, so shame wins over a score posted alongside
  // (which is still saved).
  if (shamefulGames.length > 0) {
    await settle(update, [
      bot.setMessageReaction(message.chat.id, message.message_id, SHAME_REACTION),
      bot.replyTo(message.chat.id, message.message_id, formatShame(shamefulGames, message)),
    ]);
  } else if (stored) {
    await settle(update, [bot.setMessageReaction(message.chat.id, message.message_id, SCORE_REACTION)]);
  }
}

/** Returns whether the scores are in the database (newly saved or already there). */
async function storeScores(update: Update, message: Message, scores: Score[], db: D1Database): Promise<boolean> {
  const sender = message.from;
  const skipReason = !sender
    ? "no sender"
    : sender.is_bot
      ? "sent by a bot"
      : message.forward_origin
        ? "forwarded, would be credited to the wrong person"
        : null;
  if (!sender || skipReason) {
    console.log({ event: "scores_not_saved", update_id: update.update_id, reason: skipReason });
    return false;
  }

  try {
    const { saved, duplicates } = await saveScores(db, message, sender, scores);
    console.log({ event: "scores_saved", update_id: update.update_id, from_id: sender.id, saved, duplicates });
    return true;
  } catch (error) {
    console.error({ event: "db_error", update_id: update.update_id, error: String(error) });
    return false;
  }
}

/** Runs Bot API calls independently: one failing (e.g. reactions restricted) doesn't stop the others. */
async function settle(update: Update, calls: Promise<void>[]): Promise<void> {
  for (const result of await Promise.allSettled(calls)) {
    if (result.status === "rejected") {
      console.error({ event: "telegram_error", update_id: update.update_id, error: String(result.reason) });
    }
  }
}

const SUPPORTED_GAMES = joinNames(Object.values(GAMES));

const SHAME_LINES: ((name: string, games: string) => string)[] = [
  (name, games) => `🔔 Shame! 🔔 ${name} posted a ${games} result. We don't do that here.`,
  (name, games) => `${games}? In this group? 👎 ${name}, think about what you've done.`,
  (name, games) => `🚨 ${games} detected. ${name}, this is a ${SUPPORTED_GAMES} household.`,
];

/** Picks a line by message ID: varied in the chat, predictable in tests. */
export function formatShame(games: ShamefulGameId[], message: Message): string {
  const line = SHAME_LINES[message.message_id % SHAME_LINES.length]!;
  return line(message.from?.first_name ?? "Someone", joinNames(games.map((game) => SHAMEFUL_GAMES[game])));
}

function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

function handleMyChatMember(update: Update, change: ChatMemberUpdated, allowedChatId: string): void {
  const allowed = String(change.chat.id) === allowedChatId;
  console.log({
    event: "bot_membership_changed",
    update_id: update.update_id,
    allowed_chat: allowed,
    chat_id: change.chat.id,
    chat_type: change.chat.type,
    chat_title: change.chat.title ?? null,
    date: toIsoDate(change.date),
    ...describeSender(change.from),
    old_status: change.old_chat_member.status,
    new_status: change.new_chat_member.status,
    ...(allowed && { raw: JSON.stringify(update) }),
  });
}

function logIgnored(update: Update, kind: string, chat: Chat): void {
  console.log({
    event: "ignored_update",
    update_id: update.update_id,
    reason: "chat not allowlisted",
    kind,
    chat_id: chat.id,
    chat_type: chat.type,
  });
}

function logMigration(update: Update, oldChatId: string, newChatId: string): void {
  console.warn({
    event: "chat_migrated",
    message: `ACTION REQUIRED: the group was upgraded to a supergroup. Set ALLOWED_CHAT_ID to "${newChatId}" in wrangler.jsonc and deploy.`,
    update_id: update.update_id,
    old_chat_id: oldChatId,
    new_chat_id: newChatId,
  });
}

function describeSender(user: User | undefined) {
  return {
    from_id: user?.id ?? null,
    from_name: user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : null,
    from_username: user?.username ?? null,
  };
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
