// /ennustus: a daily puzzle horoscope. The same person gets the same one all
// puzzle day, so asking again doesn't reroll it.
import { formatDuration } from "./format";
import { GAMES, type GameId } from "./parser";
import { puzzleDate } from "./puzzle-day";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ADVICE = [
  "Trust your first instinct. Then double-check it.",
  "A queen in the corner is worth two in the middle.",
  "Someone in this group is about to have a very bad Tango. It might be you.",
  "Post your result before anyone else. Fortune favours the early.",
  "Coffee first, Zip second.",
  "The turtle is watching. Move fast.",
  "Do not play Pinpoint. You know why.",
  "Your rival is closer than you think.",
  "Avoid redraws. The stars are counting.",
  "Play before lunch. After lunch, the puzzles fight back.",
  "A personal best is in the air. Breathe it in.",
  "Mercury is in retrograde. Blame it for anything over a minute.",
  "Today's Patches will test your patience. Be the patience.",
  "The Tangokuningatar crown sits heavy. Try it on anyway.",
];

export function ennustus(nowSeconds: number, senderId: number | undefined, senderName: string | undefined): string {
  const date = puzzleDate(nowSeconds);
  const seed = `${senderId ?? 0}:${date.toISOString().slice(0, 10)}`;
  const pick = (salt: string, count: number) => hash(`${seed}:${salt}`) % count;

  const games = Object.keys(GAMES) as GameId[];
  const lucky = games[pick("lucky", games.length)]!;
  const others = games.filter((game) => game !== lucky);
  const beware = others[pick("beware", others.length)]!;
  const stars = 2 + pick("stars", 4); // 2–5: the stars are kind
  const luckyTime = 15 + pick("time", 76); // 0:15–1:30

  const day = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}.${date.getUTCMonth() + 1}.`;
  return [
    `🔮 ${senderName ? `${senderName}'s ennustus` : "Ennustus"} for ${day}`,
    "",
    `Lucky game: ${GAMES[lucky]} ${"★".repeat(stars)}${"☆".repeat(5 - stars)}`,
    `Beware of: ${GAMES[beware]}`,
    `Lucky time: ${formatDuration(luckyTime)}`,
    "",
    ADVICE[pick("advice", ADVICE.length)]!,
  ].join("\n");
}

/** FNV-1a: small, fast and the same everywhere. Not for anything secret. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h;
}
