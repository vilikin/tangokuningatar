import type { BotApi } from "./bot-api";
import { formatTime, GAMES, parseScores, type Score } from "./parser";
import type { Chat, ChatMemberUpdated, Message, Update, User } from "./telegram";

// Must be one of the emoji Telegram allows bots to react with.
export const SCORE_REACTION = "👍";

/**
 * Handles an authenticated update. Only updates from ALLOWED_CHAT_ID are logged
 * in full, and only scores posted there get a reaction and a reply. Anything
 * else gets a single metadata line without message content.
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
    await handleMessage(update, update.message, allowedChatId, bot);
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

async function handleMessage(update: Update, message: Message, allowedChatId: string, bot: BotApi): Promise<void> {
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
  console.log({
    event: "group_message",
    update_id: update.update_id,
    message_id: message.message_id,
    date: toIsoDate(message.date),
    ...describeSender(message.from),
    ...(message.sender_chat && { sender_chat_id: message.sender_chat.id, sender_chat_title: message.sender_chat.title }),
    text,
    scores,
    raw: JSON.stringify(update),
  });

  if (scores.length > 0) {
    await acknowledgeScores(update, message, scores, bot);
  }
}

async function acknowledgeScores(update: Update, message: Message, scores: Score[], bot: BotApi): Promise<void> {
  // Independent calls: if reacting fails (e.g. the group restricts reactions), still reply.
  const results = await Promise.allSettled([
    bot.setMessageReaction(message.chat.id, message.message_id, SCORE_REACTION),
    bot.replyTo(message.chat.id, message.message_id, formatReply(scores)),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error({ event: "telegram_error", update_id: update.update_id, error: String(result.reason) });
    }
  }
}

/** Temporary: shows exactly what was parsed, until scores are stored and ranked. */
export function formatReply(scores: Score[]): string {
  return scores
    .map((score) =>
      [
        `Parsed ${GAMES[score.game]} #${score.puzzleNumber}`,
        `Time: ${formatTime(score.timeSeconds)} (${score.timeSeconds} s)`,
        `No hints: ${score.noHints ? "yes" : "no"}`,
        `No redraws: ${score.noRedraws ? "yes" : "no"}`,
      ].join("\n"),
    )
    .join("\n\n");
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
