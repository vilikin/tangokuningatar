import { formatTurtle, formatWeekLeader } from "./crowning";
import { type PlayerTotal, playerTotals, slowestRelativeScore } from "./db";
import { displayNames, formatDuration, formatWeek } from "./format";
import { GAMES, type GameId } from "./parser";
import { puzzleDayStart, puzzleWeek, type PuzzleWeek } from "./puzzle-day";

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
export async function runCommand(command: string, db: D1Database, nowSeconds: number): Promise<string | null> {
  if (command === "today") {
    return formatLeaderboard("🏆 Today's leaderboard", await playerTotals(db, puzzleDayStart(nowSeconds)));
  }
  if (command === "week") {
    const week = puzzleWeek(nowSeconds);
    return formatLeaderboard(weekHeader("all games", week), await playerTotals(db, week.start));
  }
  if (command === "kuningatar") {
    const week = puzzleWeek(nowSeconds);
    return formatWeekLeader(week, await playerTotals(db, week.start));
  }
  if (command === "turtle") {
    const week = puzzleWeek(nowSeconds);
    const [totals, turtle] = await Promise.all([playerTotals(db, week.start), slowestRelativeScore(db, week.start)]);
    return formatTurtle(week, totals, turtle);
  }
  const game = WEEK_GAME_COMMANDS.get(command);
  if (game) {
    const week = puzzleWeek(nowSeconds);
    return formatLeaderboard(weekHeader(GAMES[game], week), await playerTotals(db, week.start, game));
  }
  return null;
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
  const names = displayNames(totals);
  let rank = 0;
  const lines = totals.map((total, i) => {
    const previous = totals[i - 1];
    // Equal games and time share a rank.
    if (!previous || previous.games !== total.games || previous.totalSeconds !== total.totalSeconds) {
      rank = i + 1;
    }
    const games = total.games === 1 ? "1 game" : `${total.games} games`;
    return `${MEDALS[rank - 1] ?? BELOW_PODIUM} ${names.get(total.telegramUserId)}: ${formatDuration(total.totalSeconds)} (${games})`;
  });
  return [header, "", ...lines].join("\n");
}
