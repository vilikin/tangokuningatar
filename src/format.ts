// Formatting shared by the bot's replies and posts.
import type { PuzzleWeek } from "./puzzle-day";

export interface Named {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
}

/** First names, with the last name added for players who share one. */
export function displayNames(players: Named[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const { firstName } of players) {
    counts.set(firstName, (counts.get(firstName) ?? 0) + 1);
  }
  return new Map(
    players.map(({ telegramUserId, firstName, lastName }) => [
      telegramUserId,
      counts.get(firstName)! > 1 && lastName ? `${firstName} ${lastName}` : firstName,
    ]),
  );
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** 1:05, or 1:02:05 past an hour. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Week is Sat–Fri: Sat 17.10. – Fri 23.10. */
export function formatWeek(week: PuzzleWeek): string {
  return `Week is Sat–Fri: ${formatDate("Sat", week.saturday)} – ${formatDate("Fri", week.friday)}`;
}

function formatDate(weekday: string, date: Date): string {
  return `${weekday} ${date.getUTCDate()}.${date.getUTCMonth() + 1}.`;
}
