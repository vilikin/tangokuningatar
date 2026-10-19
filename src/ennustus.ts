// /ennustus: a daily puzzle horoscope. The same person gets the same one all
// puzzle day, so asking again doesn't reroll it. We play at the same time, side
// by side, so the advice is about the race and each other, not the time of day.
import { activePlayers, type Player } from "./db";
import { displayNames, formatDuration } from "./format";
import { GAMES, type GameId } from "./parser";
import { puzzleDate, puzzleDayStart } from "./puzzle-day";

// Rivals are picked from whoever posted in the four weeks before today's puzzles
// came out, so the pick can't change during the day.
const RIVAL_LOOKBACK_SECONDS = 28 * 86_400;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ADVICE = [
  "Trust your first instinct. Then double-check it.",
  "A queen in the corner is worth two in the middle.",
  "Someone in this group is about to have a very bad Tango. It might be you.",
  "Groan loudly at Zip. It throws everyone else off.",
  "Silence is your weapon today. Don't say your time until everyone's done.",
  "The turtle is watching. Move fast.",
  "Do not play Pinpoint. You know why.",
  "Your rival is closer than you think.",
  "Avoid redraws. The stars are counting.",
  "If someone sighs, they're stuck. Smile.",
  "A personal best is in the air. Breathe it in.",
  "Mercury is in retrograde. Blame it for anything over a minute.",
  "Today's Patches will test your patience. Be the patience.",
  "The Tangokuningatar crown sits heavy. Try it on anyway.",
];

export async function ennustusFor(db: D1Database, nowSeconds: number, sender: { id: number; first_name: string } | undefined) {
  const dayStart = puzzleDayStart(nowSeconds);
  const players = await activePlayers(db, dayStart - RIVAL_LOOKBACK_SECONDS, dayStart);
  return ennustus(nowSeconds, sender?.id, sender?.first_name, players);
}

/** `players` are the candidates for a rival; the sender is never their own. */
export function ennustus(
  nowSeconds: number,
  senderId: number | undefined,
  senderName: string | undefined,
  players: Player[],
): string {
  const date = puzzleDate(nowSeconds);
  const seed = `${senderId ?? 0}:${date.toISOString().slice(0, 10)}`;
  const pick = (salt: string, count: number) => hash(`${seed}:${salt}`) % count;

  const games = Object.keys(GAMES) as GameId[];
  const lucky = games[pick("lucky", games.length)]!;
  const others = games.filter((game) => game !== lucky);
  const beware = others[pick("beware", others.length)]!;
  const stars = 2 + pick("stars", 4); // 2–5: the stars are kind
  const luckyTime = 15 + pick("time", 76); // 0:15–1:30
  const rivals = players.filter((player) => player.telegram_user_id !== senderId);
  const rival = rivals.length > 0 ? rivals[pick("rival", rivals.length)]! : null;
  const names = displayNames(
    players.map((player) => ({ telegramUserId: player.telegram_user_id, firstName: player.first_name, lastName: player.last_name })),
  );

  const day = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}.${date.getUTCMonth() + 1}.`;
  return [
    `🔮 ${senderName ? `${senderName}'s ennustus` : "Ennustus"} for ${day}`,
    "",
    `Lucky game: ${GAMES[lucky]} ${"★".repeat(stars)}${"☆".repeat(5 - stars)}`,
    `Beware of: ${GAMES[beware]}`,
    `Lucky time: ${formatDuration(luckyTime)}`,
    ...(rival ? [`Rival today: ${names.get(rival.telegram_user_id)}`] : []),
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
