import type { BotApi } from "./bot-api";
import { listPlayers, listPosters, listPuzzleFirstPosts, type Player, recordShame } from "./db";
import { GAMES, type GameId } from "./parser";
import { puzzleDate, puzzleDayStart } from "./puzzle-day";

// The shame goes out at 10:00 Finnish time. That's when the puzzles reset (see
// puzzle-day.ts), except for the few weeks a year when only Finland or only the US
// has changed its clocks and they reset at 09:00; the puzzles that closed then are
// still the ones checked. The cron fires at both 07:00 and 08:00 UTC, and only the
// run at 10 o'clock in Finland does anything.
const SHAME_TIME_ZONE = "Europe/Helsinki";
const SHAME_HOUR = 10;

const shameHourFormat = new Intl.DateTimeFormat("en-US", { timeZone: SHAME_TIME_ZONE, hour: "numeric", hourCycle: "h23" });

// How far back to look for the puzzle numbers. Puzzle numbers go up by one a day.
const ANCHOR_LOOKBACK_DAYS = 60;
const SECONDS_PER_DAY = 86_400;

/**
 * Shames everyone who is in the group, has posted a score at some point, and
 * didn't post all six games for the puzzle day that just ended. One message
 * (GIF + caption mentioning them) per person.
 */
export async function runDailyShame(now: Date, env: Env, bot: BotApi): Promise<void> {
  const chatId = Number(env.ALLOWED_CHAT_ID?.trim());
  if (!chatId) {
    console.error({ event: "config_error", message: "ALLOWED_CHAT_ID is not set; not shaming anyone" });
    return;
  }

  const finnishHour = Number(shameHourFormat.format(now));
  if (finnishHour !== SHAME_HOUR) {
    console.log({ event: "daily_shame_skipped", reason: "not 10 o'clock in Finland", finnish_hour: finnishHour });
    return;
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  // The day whose puzzles closed at the latest reset.
  const puzzleDay = toIsoDate(puzzleDate(puzzleDayStart(nowSeconds) - 1));

  const firstPosts = await listPuzzleFirstPosts(env.DB, nowSeconds - ANCHOR_LOOKBACK_DAYS * SECONDS_PER_DAY);
  const puzzleNumbers = puzzleNumbersFor(puzzleDay, firstPosts);
  const posters = await listPosters(
    env.DB,
    Object.entries(puzzleNumbers).map(([game, puzzleNumber]) => ({ game, puzzleNumber })),
  );
  const posted = new Set(posters.map(({ telegram_user_id, game }) => `${telegram_user_id}:${game}`));

  const gameIds = Object.keys(GAMES) as GameId[];
  const shamed: number[] = [];
  for (const player of await listPlayers(env.DB)) {
    const missed = gameIds.filter((game) => !posted.has(`${player.telegram_user_id}:${game}`));
    if (missed.length === 0) {
      continue;
    }
    if (await shamePlayer(env, bot, chatId, player, puzzleDay, missed, now)) {
      shamed.push(player.telegram_user_id);
    }
  }

  console.log({ event: "daily_shame_done", puzzle_day: puzzleDay, puzzle_numbers: puzzleNumbers, shamed });
}

async function shamePlayer(
  env: Env,
  bot: BotApi,
  chatId: number,
  player: Player,
  puzzleDay: string,
  missed: GameId[],
  now: Date,
): Promise<boolean> {
  const userId = player.telegram_user_id;
  try {
    if (!(await bot.isChatMember(chatId, userId))) {
      console.log({ event: "shame_skipped", user_id: userId, reason: "not in the group" });
      return false;
    }
  } catch (error) {
    // E.g. "user not found" for someone who deleted their account.
    console.warn({ event: "shame_skipped", user_id: userId, reason: "membership check failed", error: String(error) });
    return false;
  }

  if (!(await recordShame(env.DB, userId, puzzleDay, missed, Math.floor(now.getTime() / 1000)))) {
    console.log({ event: "shame_skipped", user_id: userId, reason: "already shamed for this day" });
    return false;
  }

  try {
    await bot.sendShame(chatId, env.SHAME_GIF?.trim() || undefined, formatMissedShame(player, missed));
    return true;
  } catch (error) {
    // Not retried: the shame is already recorded, and a second run must not double up.
    console.error({ event: "telegram_error", user_id: userId, error: String(error) });
    return false;
  }
}

const SHAME_LINES: ((mention: string, games: string) => string)[] = [
  (mention, games) => `🔔 Shame! 🔔 ${mention} didn't post ${games} yesterday.`,
  (mention, games) => `${mention}, where were your ${games} results? The group noticed. 👀`,
  (mention, games) => `🚨 Missing results: ${games}. ${mention}, explain yourself.`,
];
const NOTHING_POSTED_LINE = (mention: string) => `🔔 Shame! 🔔 ${mention} didn't post a single result yesterday. Not one.`;

/** HTML caption that mentions (and notifies) the player, even one without a username. */
export function formatMissedShame(player: Player, missed: GameId[]): string {
  const mention = `<a href="tg://user?id=${player.telegram_user_id}">${escapeHtml(player.first_name)}</a>`;
  if (missed.length === Object.keys(GAMES).length) {
    return NOTHING_POSTED_LINE(mention);
  }
  const names = missed.map((game) => GAMES[game]);
  const games = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0]!;
  // Varies between people and days, predictable in tests.
  const line = SHAME_LINES[(player.telegram_user_id + missed.length) % SHAME_LINES.length]!;
  return line(mention, games);
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * The puzzle number each game had on `puzzleDay`. Numbers go up by one per
 * Pacific day, so number − day is the same for every on-time post. A late post
 * (yesterday's puzzle after the reset) only makes it smaller, never larger, so
 * the largest value seen is the right one. Games nobody posted recently are left out.
 */
export function puzzleNumbersFor(
  puzzleDay: string,
  firstPosts: { game: string; puzzle_number: number; first_posted_at: number }[],
): Partial<Record<GameId, number>> {
  const offsets = new Map<string, number>();
  for (const { game, puzzle_number, first_posted_at } of firstPosts) {
    const offset = puzzle_number - dayIndex(puzzleDate(first_posted_at));
    offsets.set(game, Math.max(offset, offsets.get(game) ?? -Infinity));
  }
  const numbers: Partial<Record<GameId, number>> = {};
  for (const game of Object.keys(GAMES) as GameId[]) {
    const offset = offsets.get(game);
    if (offset !== undefined) {
      numbers[game] = offset + dayIndex(new Date(`${puzzleDay}T00:00:00Z`));
    }
  }
  return numbers;
}

/** Days since 1970-01-01 for a date at midnight UTC. */
function dayIndex(date: Date): number {
  return Math.round(date.getTime() / (SECONDS_PER_DAY * 1000));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
