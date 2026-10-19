import { type PlayerTotal, playerTotals } from "./db";
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
  const game = WEEK_GAME_COMMANDS.get(command);
  if (game) {
    const week = puzzleWeek(nowSeconds);
    return formatLeaderboard(weekHeader(GAMES[game], week), await playerTotals(db, week.start, game));
  }
  return null;
}

function weekHeader(what: string, week: PuzzleWeek): string {
  return `🏆 This week's leaderboard: ${what}\nWeek is Sat–Fri: ${formatDate("Sat", week.saturday)} – ${formatDate("Fri", week.friday)}`;
}

/** Sat 17.10. */
function formatDate(weekday: string, date: Date): string {
  return `${weekday} ${date.getUTCDate()}.${date.getUTCMonth() + 1}.`;
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

/** First names, with the last name added for players who share one. */
function displayNames(totals: PlayerTotal[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const { firstName } of totals) {
    counts.set(firstName, (counts.get(firstName) ?? 0) + 1);
  }
  return new Map(
    totals.map(({ telegramUserId, firstName, lastName }) => [
      telegramUserId,
      counts.get(firstName)! > 1 && lastName ? `${firstName} ${lastName}` : firstName,
    ]),
  );
}

/** 1:05, or 1:02:05 past an hour. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
