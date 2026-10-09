import { describe, expect, it } from "vitest";
import { findShamefulGames, formatTime, parseScores, type Score } from "../src/parser";

const score = (overrides: Partial<Score> & Pick<Score, "game" | "puzzleNumber" | "timeSeconds">): Score => ({
  noHints: false,
  noRedraws: false,
  ...overrides,
});

describe("real share texts", () => {
  it.each<[string, string, Score]>([
    ["Zip", "Zip #571\n0:37 🏁\nlnkd.in/zip.", score({ game: "zip", puzzleNumber: 571, timeSeconds: 37 })],
    [
      "Zip with a CEO brag",
      "Zip #571\n0:19 🏁\n🏅 I’m smarter than 90% of CEOs today!\n#AreYouSmarterThanaCEO\nlnkd.in/zip.",
      score({ game: "zip", puzzleNumber: 571, timeSeconds: 19 }),
    ],
    [
      "Wend",
      "Wend #123 | 1:22 🌀\nWith no hints\nlnkd.in/wend.",
      score({ game: "wend", puzzleNumber: 123, timeSeconds: 82, noHints: true }),
    ],
    [
      "Patches",
      "Patches #206 | 0:14 🧶\nWith no hints\nlnkd.in/patches.",
      score({ game: "patches", puzzleNumber: 206, timeSeconds: 14, noHints: true }),
    ],
    [
      "Patches with no redraws and a streak",
      "Patches #206 | 0:29 🧶\nWith no hints & no redraws\n🏅 I’m on a 172-day win streak!\nlnkd.in/patches.",
      score({ game: "patches", puzzleNumber: 206, timeSeconds: 29, noHints: true, noRedraws: true }),
    ],
    [
      "Mini Sudoku",
      "Mini Sudoku #424 | 2:16 with no hints ✏️\nThe classic game, made mini. Handcrafted by the originators of “Sudoku.”\nlnkd.in/minisudoku.",
      score({ game: "mini-sudoku", puzzleNumber: 424, timeSeconds: 136, noHints: true }),
    ],
    ["Tango", "Tango #732\n1:02 🌗\nlnkd.in/tango.", score({ game: "tango", puzzleNumber: 732, timeSeconds: 62 })],
    ["Queens", "Queens #892\n1:00 👑\nlnkd.in/queens.", score({ game: "queens", puzzleNumber: 892, timeSeconds: 60 })],
  ])("%s", (_, text, expected) => {
    expect(parseScores(text)).toEqual([expected]);
  });
});

describe("robustness", () => {
  it("finds a result surrounded by chatter", () => {
    const text = "Huomenta! Tänään meni hyvin:\n\nQueens #892\n1:00 👑\nlnkd.in/queens.\n\nKuka voittaa?";
    expect(parseScores(text)).toEqual([score({ game: "queens", puzzleNumber: 892, timeSeconds: 60 })]);
  });

  it("parses several results pasted into one message", () => {
    const text = [
      "Queens #892\n1:00 👑\nlnkd.in/queens.",
      "Patches #206 | 0:29 🧶\nWith no hints & no redraws\nlnkd.in/patches.",
      "Zip #571\n0:37 🏁\nlnkd.in/zip.",
    ].join("\n\n");
    expect(parseScores(text)).toEqual([
      score({ game: "queens", puzzleNumber: 892, timeSeconds: 60 }),
      score({ game: "patches", puzzleNumber: 206, timeSeconds: 29, noHints: true, noRedraws: true }),
      score({ game: "zip", puzzleNumber: 571, timeSeconds: 37 }),
    ]);
  });

  it("doesn't let one result's flags leak into the next when the link is missing", () => {
    const text = "Patches #206 | 0:29 🧶\nWith no hints & no redraws\nZip #571\n0:37 🏁";
    expect(parseScores(text)).toEqual([
      score({ game: "patches", puzzleNumber: 206, timeSeconds: 29, noHints: true, noRedraws: true }),
      score({ game: "zip", puzzleNumber: 571, timeSeconds: 37 }),
    ]);
  });

  it("ignores flags in chatter after the result's link", () => {
    const text = "Queens #892\n1:00 👑\nlnkd.in/queens.\nno hints needed today 😎";
    expect(parseScores(text)).toEqual([score({ game: "queens", puzzleNumber: 892, timeSeconds: 60 })]);
  });

  it.each([
    ["Windows line endings", "Tango #732\r\n1:02 🌗\r\nlnkd.in/tango."],
    ["non-breaking spaces", "Tango #732\n1:02 🌗"],
    ["zero-width characters", "​Tango #732​\n1:02 🌗"],
    ["indentation and trailing spaces", "   Tango #732   \n   1:02 🌗   "],
    ["lowercase game name", "tango #732\n1:02 🌗"],
    ["a space after #", "Tango # 732\n1:02 🌗"],
    ["the time on the header line without a pipe", "Tango #732 1:02 🌗"],
    ["fullwidth digits", "Tango #７３２\n１:０２ 🌗"],
  ])("handles %s", (_, text) => {
    expect(parseScores(text)).toEqual([score({ game: "tango", puzzleNumber: 732, timeSeconds: 62 })]);
  });

  it("handles a multi-word game name split by odd whitespace", () => {
    expect(parseScores("Mini  Sudoku #424 | 2:16 ✏️")).toEqual([
      score({ game: "mini-sudoku", puzzleNumber: 424, timeSeconds: 136 }),
    ]);
  });

  it("reads hour-long times", () => {
    expect(parseScores("Queens #892\n1:02:03 👑")).toEqual([
      score({ game: "queens", puzzleNumber: 892, timeSeconds: 3723 }),
    ]);
  });

  it("reads puzzle numbers with thousands separators", () => {
    expect(parseScores("Queens #1,024\n1:00 👑")).toEqual([
      score({ game: "queens", puzzleNumber: 1024, timeSeconds: 60 }),
    ]);
  });
});

describe("things that are not scores", () => {
  it.each([
    ["an empty message", ""],
    ["ordinary chat", "Huomenta kaikki!"],
    ["a mention of a puzzle", "Queens #892 oli vaikea"],
    ["a mention with a time later in the sentence", "Queens #892 took me 1:00"],
    ["a mention with a time two lines down", "Queens #892\nwas hard\n1:00"],
    ["a header in the middle of a sentence", "Did you do Queens #892\n1:00?"],
    ["a game we don't support: Pinpoint", "Pinpoint #512 | 3 guesses\n1️⃣ 🟨\nlnkd.in/pinpoint."],
    ["a game we don't support: Crossclimb", "Crossclimb #377 | 1:23\nlnkd.in/crossclimb."],
    ["a game name that only starts like a supported one", "Zipper #12\n0:30"],
    ["an impossible time", "Queens #892\n1:75 👑"],
    ["a time glued to more digits", "Queens #892\n1:000"],
  ])("ignores %s", (_, text) => {
    expect(parseScores(text)).toEqual([]);
  });
});

describe("findShamefulGames", () => {
  it.each([
    ["a Pinpoint result", "Pinpoint #512 | 3 guesses\n1️⃣  | 1% match\n3️⃣  | 100% match 📌\nlnkd.in/pinpoint.", ["pinpoint"]],
    ["a Crossclimb result", "Crossclimb #377 | 1:23 🪜\nlnkd.in/crossclimb.", ["crossclimb"]],
    ["just the header", "pinpoint # 512 | 5 guesses", ["pinpoint"]],
    ["just the link", "Tänään tällainen 🙈\nlnkd.in/crossclimb.", ["crossclimb"]],
    ["both, each once", "Crossclimb #377 | 1:23\nlnkd.in/crossclimb.\nPinpoint #512 | 2 guesses\nlnkd.in/pinpoint.\nlnkd.in/crossclimb.", ["crossclimb", "pinpoint"]],
    ["a Pinpoint result next to a real score", "Queens #892\n1:00 👑\nlnkd.in/queens.\nPinpoint #512 | 3 guesses\nlnkd.in/pinpoint.", ["pinpoint"]],
  ])("finds %s", (_, text, expected) => {
    expect(findShamefulGames(text)).toEqual(expected);
  });

  it.each([
    ["a mention", "Pinpoint #512 oli helppo"],
    ["a mention mid-sentence", "Kuka teki Pinpoint #512 | ?"],
    ["supported games", "Queens #892\n1:00 👑\nlnkd.in/queens."],
    ["ordinary chat", "Huomenta!"],
  ])("ignores %s", (_, text) => {
    expect(findShamefulGames(text)).toEqual([]);
  });
});

describe("formatTime", () => {
  it.each([
    [0, "0:00"],
    [37, "0:37"],
    [62, "1:02"],
    [600, "10:00"],
    [3723, "1:02:03"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected);
  });
});
