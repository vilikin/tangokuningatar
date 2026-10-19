import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { formatLeaderboard, parseCommand } from "../src/commands";
import type { PlayerTotal } from "../src/db";
import { formatDuration } from "../src/format";
import { puzzleDayStart, puzzleWeek } from "../src/puzzle-day";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import otherGroupMessage from "./fixtures/other-group-message.json";
import { logged, savedScores, send, telegramCalls } from "./helpers";

const OUR_GROUP = -5465433776;

const AINO = groupScore.message.from;
const MIKKO = groupChatMessage.message.from;
const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };

const at = (iso: string) => Date.parse(iso) / 1000;

let nextId = 0;

/** A message in our group from `from`, posted at `iso`. */
function message(from: object, iso: string, text: string) {
  nextId++;
  return {
    update_id: 702000000 + nextId,
    message: { message_id: 902000 + nextId, from, chat: groupScore.message.chat, date: at(iso), text },
  };
}

const replies = () => telegramCalls().filter(({ method }) => method === "sendMessage");

describe("parseCommand", () => {
  it.each([
    ["/today", "today"],
    ["/today@tangokuningatar_bot", "today"],
    ["/Today@TangoKuningatar_Bot please", "today"],
    ["  /today\n", "today"],
    ["/nope", "nope"],
    ["/week_zip", "week_zip"],
    ["/week-zip", "week_zip"],
    ["/week-mini-sudoku@tangokuningatar_bot", "week_mini_sudoku"],
  ])("reads %j as %j", (text, expected) => {
    expect(parseCommand(text)).toBe(expected);
  });

  it.each(["/today@some_other_bot", "today", "what's /today?", "/", "Queens #892\n1:00 👑"])("ignores %j", (text) => {
    expect(parseCommand(text)).toBeNull();
  });
});

describe("puzzleDayStart", () => {
  it.each([
    // 10:00 in Finland, both in summer and winter time.
    ["2026-10-09T15:00:00Z", "2026-10-09T07:00:00Z"],
    ["2026-12-15T12:00:00Z", "2026-12-15T08:00:00Z"],
    // Before the reset, the puzzles are still yesterday's.
    ["2026-10-09T06:59:59Z", "2026-10-08T07:00:00Z"],
    ["2026-10-09T07:00:00Z", "2026-10-09T07:00:00Z"],
    // DST ends 2026-11-01 and starts 2026-03-08 in the US: midnight had the old offset.
    ["2026-11-01T12:00:00Z", "2026-11-01T07:00:00Z"],
    ["2026-03-08T12:00:00Z", "2026-03-08T08:00:00Z"],
  ])("at %s is %s", (now, expected) => {
    expect(puzzleDayStart(at(now))).toBe(at(expected));
  });
});

describe("puzzleWeek", () => {
  it.each([
    // 2026-10-17 is a Saturday.
    ["2026-10-17T07:00:00Z", "2026-10-17T07:00:00Z", "2026-10-17", "2026-10-23"],
    ["2026-10-19T12:00:00Z", "2026-10-17T07:00:00Z", "2026-10-17", "2026-10-23"],
    // Friday's puzzles are out until 10:00 on Saturday in Finland.
    ["2026-10-24T06:59:59Z", "2026-10-17T07:00:00Z", "2026-10-17", "2026-10-23"],
    ["2026-10-24T07:00:00Z", "2026-10-24T07:00:00Z", "2026-10-24", "2026-10-30"],
    // DST ends on Sunday 2026-11-01: the week started on summer time.
    ["2026-11-05T12:00:00Z", "2026-10-31T07:00:00Z", "2026-10-31", "2026-11-06"],
    // Across a year boundary.
    ["2027-01-01T12:00:00Z", "2026-12-26T08:00:00Z", "2026-12-26", "2027-01-01"],
  ])("at %s starts at %s and runs %s to %s", (now, start, saturday, friday) => {
    expect(puzzleWeek(at(now))).toEqual({
      start: at(start),
      saturday: new Date(`${saturday}T00:00:00Z`),
      friday: new Date(`${friday}T00:00:00Z`),
    });
  });
});

describe("formatLeaderboard", () => {
  const HEADER = "🏆 Today's leaderboard";

  const total = (firstName: string, games: number, totalSeconds: number, lastName: string | null = null): PlayerTotal => ({
    telegramUserId: firstName.length * 1000 + totalSeconds + (lastName?.length ?? 0),
    firstName,
    lastName,
    games,
    totalSeconds,
  });

  it("gives medals to the top three and turtles to the rest", () => {
    expect(
      formatLeaderboard(HEADER, [
        total("Aino", 3, 95),
        total("Mikko", 3, 130),
        total("Liisa", 2, 50),
        total("Pekka", 1, 3725),
        total("Sanna", 1, 3800),
      ]),
    ).toBe(
      "🏆 Today's leaderboard\n\n🥇 Aino: 1:35 (3 games)\n🥈 Mikko: 2:10 (3 games)\n🥉 Liisa: 0:50 (2 games)\n🐢 Pekka: 1:02:05 (1 game)\n🐢 Sanna: 1:03:20 (1 game)",
    );
  });

  it("shares a rank between exact ties", () => {
    expect(formatLeaderboard(HEADER, [total("Aino", 2, 60), total("Mikko", 2, 60), total("Liisa", 2, 61)])).toBe(
      "🏆 Today's leaderboard\n\n🥇 Aino: 1:00 (2 games)\n🥇 Mikko: 1:00 (2 games)\n🥉 Liisa: 1:01 (2 games)",
    );
  });

  it("tells players apart by last name when they share a first name", () => {
    expect(formatLeaderboard(HEADER, [total("Aino", 1, 60, "Virtanen"), total("Aino", 1, 70, "Korhonen"), total("Mikko", 1, 80)])).toContain(
      "🥇 Aino Virtanen: 1:00 (1 game)\n🥈 Aino Korhonen: 1:10 (1 game)\n🥉 Mikko: 1:20 (1 game)",
    );
  });

  it("says so when nobody has played", () => {
    expect(formatLeaderboard(HEADER, [])).toBe("🏆 Today's leaderboard\n\nNo scores yet. Get puzzling! 🧩");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [59, "0:59"],
    [600, "10:00"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("/today", () => {
  async function postYesterday() {
    // Posted before today's puzzles were released at 07:00 UTC.
    await send(message(AINO, "2026-10-08T20:00:00Z", "Queens #892\n0:40 👑\nlnkd.in/queens."));
    await send(message(MIKKO, "2026-10-09T05:00:00Z", "Zip #571 | 0:15 🏁\nlnkd.in/zip."));
  }

  async function postYesterdayAndToday() {
    await postYesterday();
    await send(message(AINO, "2026-10-09T08:00:00Z", "Queens #893\n1:00 👑\nlnkd.in/queens.\n\nZip #572 | 0:30 🏁\nlnkd.in/zip."));
    await send(message(MIKKO, "2026-10-09T09:00:00Z", "Queens #893\n0:50 👑\nlnkd.in/queens."));
    await send(message(LIISA, "2026-10-09T10:00:00Z", "Queens #893\n2:00 👑\nlnkd.in/queens."));
    await send(message(LIISA, "2026-10-09T10:05:00Z", "Zip #572 | 0:20 🏁\nlnkd.in/zip."));
    // Yesterday's puzzle posted late: doesn't count today.
    await send(message(LIISA, "2026-10-09T10:10:00Z", "Queens #892\n0:05 👑\nlnkd.in/queens."));
  }

  it("replies with today's combined times, most games first, then fastest", async () => {
    await postYesterdayAndToday();
    const command = message(MIKKO, "2026-10-09T15:00:00Z", "/today");

    await send(command);

    expect(replies().at(-1)).toEqual({
      method: "sendMessage",
      params: {
        chat_id: OUR_GROUP,
        text: "🏆 Today's leaderboard\n\n🥇 Aino: 1:30 (2 games)\n🥈 Liisa: 2:20 (2 games)\n🥉 Mikko: 0:50 (1 game)",
        reply_parameters: { message_id: command.message.message_id },
        link_preview_options: { is_disabled: true },
      },
    });
    expect(logged("log")).toContainEqual({
      event: "command",
      update_id: command.update_id,
      message_id: command.message.message_id,
      command: "today",
      known: true,
      from_id: MIKKO.id,
      from_name: "Mikko",
      from_username: null,
    });
  });

  it("still shows yesterday's puzzles before the new ones are out", async () => {
    await postYesterday();

    await send(message(AINO, "2026-10-09T06:30:00Z", "/today"));

    expect(replies().at(-1)?.params).toMatchObject({
      text: "🏆 Today's leaderboard\n\n🥇 Mikko: 0:15 (1 game)\n🥈 Aino: 0:40 (1 game)",
    });
  });

  it("answers the menu form addressed to the bot", async () => {
    await send(message(AINO, "2026-10-09T15:00:00Z", "/today@tangokuningatar_bot"));

    expect(replies()).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ text: "🏆 Today's leaderboard\n\nNo scores yet. Get puzzling! 🧩" }) }),
    ]);
  });

  it("ignores commands for other bots and commands it doesn't have", async () => {
    await send(message(AINO, "2026-10-09T15:00:00Z", "/today@some_other_bot"));
    await send(message(AINO, "2026-10-09T15:00:00Z", "/yesterday"));
    await send(message(AINO, "2026-10-09T15:00:00Z", "/week_pinpoint"));

    expect(telegramCalls()).toEqual([]);
    expect(logged("log")).toContainEqual(expect.objectContaining({ event: "command", command: "yesterday", known: false }));
    expect(logged("log")).toContainEqual(expect.objectContaining({ event: "command", command: "week_pinpoint", known: false }));
  });

  it("doesn't save scores from a command message", async () => {
    await send(message(AINO, "2026-10-09T15:00:00Z", "/today\nQueens #893\n1:00 👑"));

    expect(await savedScores()).toEqual([]);
    expect(replies()).toHaveLength(1);
  });

  it("doesn't answer in other chats", async () => {
    const command = message(AINO, "2026-10-09T15:00:00Z", "/today");
    await send({ ...command, message: { ...command.message, chat: otherGroupMessage.message.chat } });

    expect(telegramCalls()).toEqual([]);
  });

  it("logs a database failure without replying", async () => {
    await env.DB.exec("DROP TABLE scores");

    const response = await send(message(AINO, "2026-10-09T15:00:00Z", "/today"));

    expect(response.status).toBe(200);
    expect(telegramCalls()).toEqual([]);
    expect(logged("error")).toEqual([
      expect.objectContaining({ event: "db_error", command: "today", error: expect.stringContaining("no such table: scores") }),
    ]);
  });
});

describe("/missing", () => {
  const TODAY = { Queens: 893, Tango: 693, Zip: 572, "Mini Sudoku": 300, Patches: 210, Wend: 40 };

  /** Posts these games of today's puzzles (released at 07:00 UTC on 9 October). */
  async function postToday(from: object, games: (keyof typeof TODAY)[]) {
    const text = games.map((game) => `${game} #${TODAY[game]} | 1:00\nlnkd.in/x.`).join("\n\n");
    await send(message(from, "2026-10-09T08:00:00Z", text));
  }

  /** Answers getChatMember with "left" for these users and "member" for everyone else. */
  function mockMembers(leftIds: number[] = []) {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/getChatMember")) {
        const { user_id } = JSON.parse(String(init?.body)) as { user_id: number };
        const status = leftIds.includes(user_id) ? "left" : "member";
        return Response.json({ ok: true, result: { status, user: { id: user_id } } });
      }
      return Response.json({ ok: true, result: true });
    });
  }

  it("lists who is still missing today's results, and which ones", async () => {
    mockMembers();
    await postToday(AINO, ["Queens", "Tango", "Zip", "Mini Sudoku", "Patches", "Wend"]);
    await postToday(MIKKO, ["Queens", "Zip"]);
    // Only yesterday's puzzle: nothing today.
    await send(message(LIISA, "2026-10-09T05:00:00Z", "Queens #892\n2:00 👑\nlnkd.in/queens."));

    await send(message(AINO, "2026-10-09T15:00:00Z", "/missing"));

    expect(replies().at(-1)?.params).toMatchObject({
      chat_id: OUR_GROUP,
      text:
        "🕵️ Still missing today's results:\n\n" +
        "• Mikko: Tango, Mini Sudoku, Patches and Wend\n" +
        "• Liisa: nothing yet\n\n" +
        "Anything still missing at 10:00 gets shamed. 🔔",
    });
  });

  it("leaves out people who have left the group", async () => {
    mockMembers([LIISA.id]);
    await postToday(AINO, ["Queens", "Tango", "Zip", "Mini Sudoku", "Patches", "Wend"]);
    await send(message(LIISA, "2026-10-09T05:00:00Z", "Queens #892\n2:00 👑\nlnkd.in/queens."));

    await send(message(AINO, "2026-10-09T15:00:00Z", "/missing"));

    expect(replies().at(-1)?.params).toMatchObject({
      text: "✅ Everyone has posted all of today's results. Nobody gets shamed at 10:00!",
    });
  });

  it("doesn't ping anyone or send the GIF", async () => {
    mockMembers();
    await postToday(MIKKO, ["Queens"]);

    await send(message(AINO, "2026-10-09T15:00:00Z", "/missing"));

    const methods = telegramCalls().map(({ method }) => method);
    expect(methods).not.toContain("sendAnimation");
    expect(replies().at(-1)?.params).not.toHaveProperty("parse_mode");
  });
});

describe("/week", () => {
  const WEEK = "Week is Sat–Fri: Sat 17.10. – Fri 23.10.";

  async function postWeek() {
    // Last week's Friday puzzle, posted before Saturday's came out at 07:00 UTC.
    await send(message(MIKKO, "2026-10-17T06:00:00Z", "Zip #571 | 0:10 🏁\nlnkd.in/zip."));
    // Saturday.
    await send(message(AINO, "2026-10-17T08:00:00Z", "Zip #572 | 0:30 🏁\nlnkd.in/zip.\n\nQueens #894\n1:00 👑\nlnkd.in/queens."));
    await send(message(MIKKO, "2026-10-17T09:00:00Z", "Zip #572 | 0:20 🏁\nlnkd.in/zip.\n\nQueens #894\n0:50 👑\nlnkd.in/queens."));
    await send(message(LIISA, "2026-10-17T10:00:00Z", "Zip #572 | 0:25 🏁\nlnkd.in/zip."));
    // Last week's Friday puzzle posted late: doesn't count this week.
    await send(message(LIISA, "2026-10-17T10:05:00Z", "Zip #571 | 0:05 🏁\nlnkd.in/zip."));
    // Sunday.
    await send(message(AINO, "2026-10-18T08:00:00Z", "Zip #573 | 0:40 🏁\nlnkd.in/zip."));
    await send(message(LIISA, "2026-10-18T09:00:00Z", "Zip #573 | 0:35 🏁\nlnkd.in/zip."));
  }

  it("adds up all games of the week", async () => {
    await postWeek();
    const command = message(MIKKO, "2026-10-19T12:00:00Z", "/week");

    await send(command);

    expect(replies().at(-1)?.params).toEqual({
      chat_id: OUR_GROUP,
      text: `🏆 This week's leaderboard: all games\n${WEEK}\n\n🥇 Aino: 2:10 (3 games)\n🥈 Liisa: 1:00 (2 games)\n🥉 Mikko: 1:10 (2 games)`,
      reply_parameters: { message_id: command.message.message_id },
      link_preview_options: { is_disabled: true },
    });
  });

  it.each(["/week_zip", "/week-zip", "/week_zip@tangokuningatar_bot"])("adds up one game's week with %s", async (text) => {
    await postWeek();

    await send(message(MIKKO, "2026-10-19T12:00:00Z", text));

    expect(replies().at(-1)?.params).toMatchObject({
      text: `🏆 This week's leaderboard: Zip\n${WEEK}\n\n🥇 Liisa: 1:00 (2 games)\n🥈 Aino: 1:10 (2 games)\n🥉 Mikko: 0:20 (1 game)`,
    });
  });

  it("names the game in the header", async () => {
    await postWeek();

    await send(message(MIKKO, "2026-10-19T12:00:00Z", "/week_queens"));
    await send(message(MIKKO, "2026-10-19T12:00:00Z", "/week_mini_sudoku"));

    expect(replies().slice(-2).map(({ params }) => (params as { text: string }).text)).toEqual([
      `🏆 This week's leaderboard: Queens\n${WEEK}\n\n🥇 Mikko: 0:50 (1 game)\n🥈 Aino: 1:00 (1 game)`,
      `🏆 This week's leaderboard: Mini Sudoku\n${WEEK}\n\nNo scores yet. Get puzzling! 🧩`,
    ]);
  });

  it("starts over on Saturday when the new puzzles are out", async () => {
    await postWeek();

    await send(message(MIKKO, "2026-10-24T07:00:00Z", "/week"));

    expect(replies().at(-1)?.params).toMatchObject({
      text: "🏆 This week's leaderboard: all games\nWeek is Sat–Fri: Sat 24.10. – Fri 30.10.\n\nNo scores yet. Get puzzling! 🧩",
    });
  });
});
