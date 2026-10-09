// Parses the share text LinkedIn generates for its daily puzzles, e.g.
//
//   Queens #892            Patches #206 | 0:29 🧶
//   1:00 👑                With no hints & no redraws
//   lnkd.in/queens.        lnkd.in/patches.
//
// The header is `<Game> #<number>`, and the time follows it either on the same
// line (after " | ") or at the start of the next line. Flags such as "no hints"
// appear somewhere between the header and the lnkd.in link. Anything else in the
// message (chatter, streak brags, hashtags) is ignored, and one message may
// contain several results.

export const GAMES = {
  queens: "Queens",
  tango: "Tango",
  zip: "Zip",
  "mini-sudoku": "Mini Sudoku",
  patches: "Patches",
  wend: "Wend",
} as const;
// Pinpoint and Crossclimb are deliberately not supported: they're never parsed
// as scores. findShamefulGames only spots them so the poster can be shamed.
export const SHAMEFUL_GAMES = {
  pinpoint: "Pinpoint",
  crossclimb: "Crossclimb",
} as const;

export type ShamefulGameId = keyof typeof SHAMEFUL_GAMES;

export type GameId = keyof typeof GAMES;

export interface Score {
  game: GameId;
  puzzleNumber: number;
  timeSeconds: number;
  noHints: boolean;
  noRedraws: boolean;
}

const gameIdsByName = new Map(Object.entries(GAMES).map(([id, name]) => [name.toLowerCase(), id as GameId]));

// "Mini Sudoku" may arrive with any whitespace between the words.
const gameNamePattern = Object.values(GAMES)
  .map((name) => name.split(" ").join("\\s+"))
  .join("|");

// `<Game> #<number>` at the start of a line. Numbers may use thousands separators (#1,024).
const HEADER = new RegExp(`^(${gameNamePattern})\\s*#\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(?!\\d)(.*)$`, "i");

// m:ss or h:mm:ss, not glued to further digits.
const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})(?![\d:])`;
// Time right after the header: "Wend #123 | 1:22", tolerating other separators or none.
const TIME_AFTER_HEADER = new RegExp(String.raw`^\s*(?:[|·•\-–—:]\s*)?${TIME}`);
// Time opening the line after the header: "1:00 👑".
const TIME_AT_LINE_START = new RegExp(`^${TIME}`);

const NO_HINTS = /\bno\s+hints\b/i;
const NO_REDRAWS = /\bno\s+redraws\b/i;
const LINK = /\blnkd\.in\//i;

// How far past the header flags are looked for, if no lnkd.in link ends the result first.
const MAX_LINES_PER_RESULT = 5;

// A shared result rather than a mention: "Pinpoint #512 | 3 guesses", or the lnkd.in link.
const SHAMEFUL_HEADER = /^(pinpoint|crossclimb)\s*#\s*\d[\d,]*\s*\|/i;
const SHAMEFUL_LINK = /\blnkd\.in\/(pinpoint|crossclimb)\b/i;

/** Pinpoint or Crossclimb results in the message, each game once, in order of appearance. */
export function findShamefulGames(text: string): ShamefulGameId[] {
  const found = new Set<ShamefulGameId>();
  for (const line of normalize(text).split("\n")) {
    const match = SHAMEFUL_HEADER.exec(line) ?? SHAMEFUL_LINK.exec(line);
    if (match) {
      found.add(match[1]!.toLowerCase() as ShamefulGameId);
    }
  }
  return [...found];
}

export function parseScores(text: string): Score[] {
  const lines = normalize(text).split("\n");
  const scores: Score[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i]!);
    if (!header) {
      continue;
    }
    const [, gameName, number, restOfLine] = header as unknown as [string, string, string, string];

    const time = TIME_AFTER_HEADER.exec(restOfLine) ?? TIME_AT_LINE_START.exec(lines[i + 1] ?? "");
    if (!time) {
      // A header without a time, e.g. someone just mentioning "Queens #892".
      continue;
    }
    const timeSeconds = toSeconds(time);
    if (timeSeconds === null) {
      continue;
    }

    const block = resultLines(lines, i);
    scores.push({
      game: gameIdsByName.get(gameName.replace(/\s+/g, " ").toLowerCase())!,
      puzzleNumber: Number(number.replaceAll(",", "")),
      timeSeconds,
      noHints: block.some((line) => NO_HINTS.test(line)),
      noRedraws: block.some((line) => NO_REDRAWS.test(line)),
    });
  }
  return scores;
}

/** The header line and the lines after it, up to the lnkd.in link or the next result. */
function resultLines(lines: string[], headerIndex: number): string[] {
  const block = [lines[headerIndex]!];
  for (let i = headerIndex + 1; i < lines.length && block.length < MAX_LINES_PER_RESULT; i++) {
    const line = lines[i]!;
    if (HEADER.test(line)) {
      break;
    }
    block.push(line);
    if (LINK.test(line)) {
      break;
    }
  }
  return block;
}

function toSeconds([, hours, minutes, seconds]: RegExpExecArray): number | null {
  const h = Number(hours ?? 0);
  const m = Number(minutes);
  const s = Number(seconds);
  if (s >= 60 || (hours !== undefined && m >= 60)) {
    return null;
  }
  return h * 3600 + m * 60 + s;
}

/** Copy-paste can bring CRLF, non-breaking spaces, zero-width characters and fullwidth digits. */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}
