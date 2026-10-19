// /mood: how the group is doing today compared with each player's own usual.
import { type MoodResult, moodResults } from "./db";
import { displayNames } from "./format";
import { GAMES } from "./parser";
import { puzzleDayStart } from "./puzzle-day";

// "Usual" is a player's average on that game over the four weeks before today,
// and only counts once they have a few results there.
const HISTORY_SECONDS = 28 * 86_400;
const MIN_HISTORY = 3;

const MOODS: { below: number; emoji: string; name: string; line: string }[] = [
  { below: 0.85, emoji: "🤩", name: "ecstatic", line: "I'm so proud I could cry." },
  { below: 0.95, emoji: "😊", name: "happy", line: "Look at you all go." },
  { below: 1.05, emoji: "😐", name: "meh", line: "Business as usual." },
  { below: 1.2, emoji: "😒", name: "disappointed", line: "I'm not angry, just disappointed." },
  { below: Infinity, emoji: "😭", name: "devastated", line: "Was everyone playing with their eyes closed?" },
];

export async function mood(db: D1Database, nowSeconds: number): Promise<string> {
  return formatMood(await moodResults(db, puzzleDayStart(nowSeconds), HISTORY_SECONDS, MIN_HISTORY));
}

export function formatMood(results: MoodResult[]): string {
  if (results.length === 0) {
    return (
      "😶 No mood yet. I compare today's results with each player's own average, " +
      `so I need someone who has played the same game at least ${MIN_HISTORY} times in the last 4 weeks.`
    );
  }
  const ratios = results.map((result) => ({ result, ratio: result.timeSeconds / Math.max(result.usualSeconds, 1) }));
  const average = ratios.reduce((sum, { ratio }) => sum + ratio, 0) / ratios.length;
  const { emoji, name, line } = MOODS.find(({ below }) => average < below)!;

  const count = results.length === 1 ? "1 result" : `${results.length} results`;
  const lines = [
    `${emoji} Today's mood: ${name}`,
    `The group is ${pace(average)} today (${count}, compared with each player's own average from the last 4 weeks).`,
    line,
  ];
  if (ratios.length > 1) {
    const sorted = [...ratios].sort((a, b) => a.ratio - b.ratio);
    const names = displayNames(results);
    const describe = ({ result, ratio }: (typeof ratios)[number]) =>
      `${names.get(result.telegramUserId)} on ${GAMES[result.game]}, ${pace(ratio)}`;
    lines.push("", `Best: ${describe(sorted[0]!)}.`, `Worst: ${describe(sorted.at(-1)!)}.`);
  }
  return lines.join("\n");
}

/** "12% faster than usual", "30% slower than usual", "right on their usual pace". */
function pace(ratio: number): string {
  const percent = Math.round(Math.abs(ratio - 1) * 100);
  if (percent === 0) {
    return "right on the usual pace";
  }
  return `${percent}% ${ratio < 1 ? "faster" : "slower"} than usual`;
}
