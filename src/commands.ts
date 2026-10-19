import { type PlayerTotal, todaysTotals } from "./db";
import { puzzleDayStart } from "./puzzle-day";

export const BOT_USERNAME = "tangokuningatar_bot";

// `/today`, or `/today@tangokuningatar_bot` when picked from the menu in a group.
const COMMAND = /^\/([a-z0-9_]+)(?:@(\w+))?(?:\s|$)/i;

/** The command a message starts with, lowercased, unless it's addressed to another bot. */
export function parseCommand(text: string): string | null {
  const match = COMMAND.exec(text.trim());
  if (!match || (match[2] !== undefined && match[2].toLowerCase() !== BOT_USERNAME)) {
    return null;
  }
  return match[1]!.toLowerCase();
}

/** Builds the reply to a command, or returns null for commands the bot doesn't have. */
export async function runCommand(command: string, db: D1Database, nowSeconds: number): Promise<string | null> {
  switch (command) {
    case "today":
      return formatLeaderboard(await todaysTotals(db, puzzleDayStart(nowSeconds)));
    default:
      return null;
  }
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Medals for the top three, then keycap numbers: 4️⃣ … 🔟, 1️⃣1️⃣ … */
export function rankEmoji(rank: number): string {
  if (rank <= MEDALS.length) {
    return MEDALS[rank - 1]!;
  }
  return rank === 10 ? "🔟" : [...String(rank)].map((digit) => `${digit}\uFE0F\u20E3`).join("");
}

export function formatLeaderboard(totals: PlayerTotal[]): string {
  if (totals.length === 0) {
    return "No scores today yet. Get puzzling! 🧩";
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
    return `${rankEmoji(rank)} ${names.get(total.telegramUserId)}: ${formatDuration(total.totalSeconds)} (${games})`;
  });
  return ["🏆 Today's leaderboard", "", ...lines].join("\n");
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
