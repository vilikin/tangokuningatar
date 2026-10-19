import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import { get, logged, send, signInitData } from "./helpers";

const AINO = groupScore.message.from;
const MIKKO = groupChatMessage.message.from;
const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };

const at = (iso: string) => Date.parse(iso) / 1000;

// Monday of the week Sat 17.10. – Fri 23.10.
const MONDAY = "2026-10-19T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MONDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

let nextId = 0;

/** A message in our group from `from`, posted at `iso`. */
function message(from: object, iso: string, text: string) {
  nextId++;
  return {
    update_id: 703000000 + nextId,
    message: { message_id: 903000 + nextId, from, chat: groupScore.message.chat, date: at(iso), text },
  };
}

/** The same week as the /week tests, so the page and the command agree. */
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

/** initData for `user`, launched `ageSeconds` ago, as Telegram would hand it to the page. */
function launchFields(user: object, ageSeconds = 60): Record<string, string> {
  return {
    auth_date: String(at(MONDAY) - ageSeconds),
    chat_instance: "-4818412012345678901",
    chat_type: "group",
    user: JSON.stringify(user),
  };
}

const week = (initData: string | null, envOverrides: Partial<Env> = {}) =>
  get("/api/week", initData === null ? {} : { Authorization: `tma ${initData}` }, envOverrides);

const weekAs = async (user: object) => week(await signInitData(launchFields(user)));

describe("Mini App page", () => {
  it("serves the page without any data in it", async () => {
    const response = await get("/app");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("telegram-web-app.js");
    expect(html).toContain("/api/week");
  });

  it.each(["/app", "/api/week"])("returns 405 for POST to %s", async (path) => {
    const response = await send({}, { path });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});

describe("week API", () => {
  it("returns the week's standings, all games and each game, like /week", async () => {
    await postWeek();

    const response = await weekAs(LIISA);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<{ week: unknown; boards: { id: string; name: string; standings: unknown[] }[] }>();
    expect(body.week).toEqual({ saturday: "17.10.", friday: "23.10.", day: 3 });
    expect(body.boards.map(({ id, name }) => [id, name])).toEqual([
      ["all", "All games"],
      ["queens", "Queens"],
      ["tango", "Tango"],
      ["zip", "Zip"],
      ["mini-sudoku", "Mini Sudoku"],
      ["patches", "Patches"],
      ["wend", "Wend"],
    ]);
    const board = (id: string) => body.boards.find((b) => b.id === id)!.standings;
    expect(board("all")).toEqual([
      { rank: 1, name: "Aino", games: 3, time: "2:10", you: false },
      { rank: 2, name: "Liisa", games: 2, time: "1:00", you: true },
      { rank: 3, name: "Mikko", games: 2, time: "1:10", you: false },
    ]);
    expect(board("zip")).toEqual([
      { rank: 1, name: "Liisa", games: 2, time: "1:00", you: true },
      { rank: 2, name: "Aino", games: 2, time: "1:10", you: false },
      { rank: 3, name: "Mikko", games: 1, time: "0:20", you: false },
    ]);
    expect(board("queens")).toEqual([
      { rank: 1, name: "Mikko", games: 1, time: "0:50", you: false },
      { rank: 2, name: "Aino", games: 1, time: "1:00", you: false },
    ]);
    expect(board("wend")).toEqual([]);
    expect(logged("log")).toContainEqual({ event: "mini_app_week", from_id: LIISA.id, player: true });
  });

  it("gives tied players the same rank", async () => {
    await send(message(AINO, "2026-10-19T08:00:00Z", "Zip #574 | 0:30 🏁\nlnkd.in/zip."));
    await send(message(LIISA, "2026-10-19T09:00:00Z", "Zip #574 | 0:30 🏁\nlnkd.in/zip."));
    await send(message(MIKKO, "2026-10-19T10:00:00Z", "Zip #574 | 0:45 🏁\nlnkd.in/zip."));

    const body = await (await weekAs(AINO)).json<{ boards: { standings: { rank: number }[] }[] }>();

    expect(body.boards[0]!.standings.map(({ rank }) => rank)).toEqual([1, 1, 3]);
  });

  it.each([
    ["Saturday, once its puzzles are out,", 1, "17.10.", "2026-10-17T07:00:00Z"],
    ["Friday", 7, "17.10.", "2026-10-23T20:00:00Z"],
    ["the next Saturday", 1, "24.10.", "2026-10-24T07:00:00Z"],
  ])("%s is day %i of the week of %s", async (_, day, saturday, now) => {
    await postWeek();
    vi.setSystemTime(now);
    const fields = { ...launchFields(LIISA), auth_date: String(at(now) - 60) };

    const body = await (await week(await signInitData(fields))).json<{ week: { saturday: string; day: number } }>();

    expect(body.week).toMatchObject({ saturday, day });
  });

  it("starts the standings over on Saturday", async () => {
    await postWeek();
    vi.setSystemTime("2026-10-24T07:00:00Z");
    const fields = { ...launchFields(LIISA), auth_date: String(at("2026-10-24T07:00:00Z")) };

    const body = await (await week(await signInitData(fields))).json<{ boards: { standings: unknown[] }[] }>();

    expect(body.boards.every(({ standings }) => standings.length === 0)).toBe(true);
  });

  it("returns 403 to someone Telegram vouches for who has never posted in our group", async () => {
    await postWeek();
    const stranger = { id: 999, is_bot: false, first_name: "Stranger" };

    const response = await weekAs(stranger);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(logged("log")).toContainEqual({ event: "mini_app_week", from_id: 999, player: false });
  });

  it("accepts initData that is a day old", async () => {
    await postWeek();
    const response = await week(await signInitData(launchFields(AINO, 24 * 60 * 60)));
    expect(response.status).toBe(200);
  });

  describe("returns 401 without revealing anything", () => {
    it.each<[string, () => Promise<string | null>]>([
      ["there is no Authorization header", async () => null],
      ["the initData is empty", async () => ""],
      ["there is no hash", async () => new URLSearchParams(launchFields(AINO)).toString()],
      ["the hash is not hex", async () => new URLSearchParams({ ...launchFields(AINO), hash: "zz" }).toString()],
      ["it was signed with another bot's token", async () => signInitData(launchFields(AINO), "other-bot-token")],
      ["it is more than a day old", async () => signInitData(launchFields(AINO, 24 * 60 * 60 + 1))],
      [
        "the user was swapped after signing",
        async () => {
          const params = new URLSearchParams(await signInitData(launchFields(MIKKO)));
          params.set("user", JSON.stringify(AINO));
          return params.toString();
        },
      ],
      ["a field was added after signing", async () => (await signInitData(launchFields(AINO))) + "&start_param=zip"],
      ["the user is missing", async () => signInitData({ auth_date: String(at(MONDAY)) })],
      ["the user is not JSON", async () => signInitData({ auth_date: String(at(MONDAY)), user: "aino" })],
    ])("when %s", async (_, initData) => {
      await postWeek();

      const response = await week(await initData());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Open this page from Telegram." });
      expect(logged("log")).not.toContainEqual(expect.objectContaining({ event: "mini_app_week" }));
    });

    it("when the Authorization scheme is not tma", async () => {
      const response = await get("/api/week", { Authorization: `Bearer ${await signInitData(launchFields(AINO))}` });
      expect(response.status).toBe(401);
    });

    it("when TELEGRAM_BOT_TOKEN is not configured, even for initData signed with an empty token", async () => {
      await postWeek();

      const response = await week(await signInitData(launchFields(AINO), ""), { TELEGRAM_BOT_TOKEN: "" });

      expect(response.status).toBe(401);
      expect(logged("error")).toContainEqual(expect.objectContaining({ event: "config_error" }));
    });
  });
});
