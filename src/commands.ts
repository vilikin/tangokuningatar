import { shownOrder } from "./april-fools";
import type { BotApi } from "./bot-api";
import { formatTurtle, formatWeekLeader } from "./crowning";
import { findMissedResults, type MissedResults, toIsoDate } from "./daily-shame";
import { type PlayerTotal, playerTotals, slowestRelativeScore } from "./db";
import { displayNames, formatDuration, formatWeek, joinNames } from "./format";
import { GAMES, type GameId } from "./parser";
import { puzzleDate, puzzleDayStart, puzzleWeek, type PuzzleWeek } from "./puzzle-day";

export const BOT_USERNAME = "tangokuningatar_bot";

// `/today`, or `/today@tangokuningatar_bot` when picked from the menu in a group.
// Telegram command names can't contain hyphens, but `/week-zip` typed by hand works too.
const COMMAND = /^\/([a-z0-9_-]+)(?:@(\w+))?(?:\s|$)/i;

/** `week_zip`, `week_mini_sudoku`, …: one per game. */
const WEEK_GAME_COMMANDS = new Map(
  (Object.keys(GAMES) as GameId[]).map((game) => [`week_${game.replaceAll("-", "_")}`, game]),
);

/**
 * The command a message starts with, lowercased and with hyphens as underscores,
 * unless it's addressed to another bot.
 */
export function parseCommand(text: string): string | null {
  const match = COMMAND.exec(text.trim());
  if (!match || (match[2] !== undefined && match[2].toLowerCase() !== BOT_USERNAME)) {
    return null;
  }
  return match[1]!.toLowerCase().replaceAll("-", "_");
}

/** Builds the reply to a command, or returns null for commands the bot doesn't have. */
export async function runCommand(
  command: string,
  db: D1Database,
  nowSeconds: number,
  bot: BotApi,
  chatId: number,
): Promise<string | null> {
  if (command === "today") {
    const totals = await playerTotals(db, puzzleDayStart(nowSeconds));
    return formatLeaderboard("🏆 Today's leaderboard", shownOrder(totals, nowSeconds));
  }
  if (command === "week") {
    const week = puzzleWeek(nowSeconds);
    return formatLeaderboard(weekHeader("all games", week), shownOrder(await playerTotals(db, week.start), nowSeconds));
  }
  if (command === "kuningatar") {
    const week = puzzleWeek(nowSeconds);
    const [totals, turtle] = await Promise.all([playerTotals(db, week.start), slowestRelativeScore(db, week.start)]);
    return formatWeekLeader(week, totals, turtle, nowSeconds);
  }
  if (command === "turtle") {
    const week = puzzleWeek(nowSeconds);
    const [totals, turtle] = await Promise.all([playerTotals(db, week.start), slowestRelativeScore(db, week.start)]);
    return formatTurtle(week, totals, turtle);
  }
  if (command === "missing") {
    const today = toIsoDate(puzzleDate(nowSeconds));
    return formatMissing((await findMissedResults(db, bot, chatId, today, nowSeconds)).players);
  }
  const game = WEEK_GAME_COMMANDS.get(command);
  if (game) {
    const week = puzzleWeek(nowSeconds);
    const totals = await playerTotals(db, week.start, game);
    return formatLeaderboard(weekHeader(GAMES[game], week), shownOrder(totals, nowSeconds));
  }
  return null;
}

/** The reply to /missing: who hasn't posted all of today's games yet, without pinging anyone. */
export function formatMissing(missing: MissedResults["players"]): string {
  if (missing.length === 0) {
    return "✅ Everyone has posted all of today's results. Nobody gets shamed at 10:00!";
  }
  const names = displayNames(
    missing.map(({ player }) => ({
      telegramUserId: player.telegram_user_id,
      firstName: player.first_name,
      lastName: player.last_name,
    })),
  );
  const lines = missing.map(({ player, missed }) => {
    const games = missed.length === Object.keys(GAMES).length ? "nothing yet" : joinNames(missed.map((game) => GAMES[game]));
    return `• ${names.get(player.telegram_user_id)}: ${games}`;
  });
  return ["🕵️ Still missing today's results:", "", ...lines, "", "Anything still missing at 10:00 gets shamed. 🔔"].join("\n");
}

function weekHeader(what: string, week: PuzzleWeek): string {
  return `🏆 This week's leaderboard: ${what}\n${formatWeek(week)}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const BELOW_PODIUM = "🐢";

export function formatLeaderboard(header: string, totals: PlayerTotal[]): string {
  if (totals.length === 0) {
    return `${header}\n\nNo scores yet. Get puzzling! 🧩`;
  }
  const lines = rankTotals(totals).map(({ rank, name, total }) => {
    const games = total.games === 1 ? "1 game" : `${total.games} games`;
    return `${MEDALS[rank - 1] ?? BELOW_PODIUM} ${name}: ${formatDuration(total.totalSeconds)} (${games})`;
  });
  return [header, "", ...lines].join("\n");
}

export interface Standing {
  rank: number;
  name: string;
  total: PlayerTotal;
}

/** Ranks and display names for totals that are already in order. Equal games and time share a rank. */
export function rankTotals(totals: PlayerTotal[]): Standing[] {
  const names = displayNames(totals);
  let rank = 0;
  return totals.map((total, i) => {
    const previous = totals[i - 1];
    if (!previous || previous.games !== total.games || previous.totalSeconds !== total.totalSeconds) {
      rank = i + 1;
    }
    return { rank, name: names.get(total.telegramUserId)!, total };
  });
}
