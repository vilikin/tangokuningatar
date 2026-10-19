import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createBotApi } from "../src/bot-api";
import { puzzleNumbersFor, runDailyShame } from "../src/daily-shame";
import worker from "../src/index";
import { logged, telegramCalls } from "./helpers";

const OUR_GROUP = -5465433776;
// 00:05 Pacific (summer time) on 20 October: the 19 October puzzles just closed.
const AFTER_RESET = new Date("2026-10-20T07:05:00Z");
// Noon Pacific on 19 October.
const ON_THE_DAY = Date.parse("2026-10-19T19:00:00Z") / 1000;
const DAY = 86_400;

// The 19 October puzzle numbers.
const PUZZLES = { queens: 900, tango: 700, zip: 500, "mini-sudoku": 300, patches: 210, wend: 40 };

const AINO = 1001; // posts everything
const BERTTA = 1002; // posts Queens and Zip
const CECILIA = 1003; // played before, nothing on the day
const DORA = 1004; // left the group

async function addPlayer(id: number, firstName: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO players (telegram_user_id, first_name, first_seen_at, updated_at) VALUES (?, ?, 0, 0)",
  )
    .bind(id, firstName)
    .run();
}

let messageId = 1;
async function addScore(userId: number, game: string, puzzleNumber: number, postedAt: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO scores (telegram_user_id, game, puzzle_number, time_seconds, no_hints, no_redraws,
                         posted_at, chat_id, message_id, message_text)
     VALUES (?, ?, ?, 60, 0, 0, ?, ?, ?, '')`,
  )
    .bind(userId, game, puzzleNumber, postedAt, OUR_GROUP, messageId++)
    .run();
}

async function seedGroup(): Promise<void> {
  await addPlayer(AINO, "Aino");
  await addPlayer(BERTTA, "Bertta");
  await addPlayer(CECILIA, "Cecilia");
  await addPlayer(DORA, "Dora");
  for (const [game, number] of Object.entries(PUZZLES)) {
    await addScore(AINO, game, number, ON_THE_DAY);
  }
  await addScore(BERTTA, "queens", PUZZLES.queens, ON_THE_DAY);
  await addScore(BERTTA, "zip", PUZZLES.zip, ON_THE_DAY);
  await addScore(CECILIA, "queens", PUZZLES.queens - 3, ON_THE_DAY - 3 * DAY);
}

/** Answers getChatMember with these statuses (default "member"); everything else succeeds. */
function mockMembers(statuses: Record<number, string> = {}): void {
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/getChatMember")) {
      const { user_id } = JSON.parse(String(init?.body)) as { user_id: number };
      return Response.json({ ok: true, result: { status: statuses[user_id] ?? "member", user: { id: user_id } } });
    }
    return Response.json({ ok: true, result: true });
  });
}

const shamePosts = () => telegramCalls().filter(({ method }) => method === "sendAnimation" || method === "sendMessage");
const bot = createBotApi("test-bot-token");
const withGif = { ...env, SHAME_GIF: "shame-gif-file-id" };

describe("daily shame", () => {
  it("sends one GIF per group member who missed a game, mentioning them", async () => {
    await seedGroup();
    mockMembers({ [DORA]: "left" });

    await runDailyShame(AFTER_RESET, withGif, bot);

    expect(shamePosts()).toEqual([
      {
        method: "sendAnimation",
        params: {
          chat_id: OUR_GROUP,
          animation: "shame-gif-file-id",
          caption: expect.stringContaining(`<a href="tg://user?id=${BERTTA}">Bertta</a>`),
          parse_mode: "HTML",
        },
      },
      {
        method: "sendAnimation",
        params: {
          chat_id: OUR_GROUP,
          animation: "shame-gif-file-id",
          caption: `🔔 Shame! 🔔 <a href="tg://user?id=${CECILIA}">Cecilia</a> didn't post a single result yesterday. Not one.`,
          parse_mode: "HTML",
        },
      },
    ]);
    expect((shamePosts()[0]!.params as { caption: string }).caption).toContain("Tango, Mini Sudoku, Patches or Wend");
    expect(logged("log")).toContainEqual(
      expect.objectContaining({ event: "shame_skipped", user_id: DORA, reason: "not in the group" }),
    );
    expect(logged("log")).toContainEqual({
      event: "daily_shame_done",
      puzzle_day: "2026-10-19",
      puzzle_numbers: PUZZLES,
      shamed: [BERTTA, CECILIA],
    });
  });

  it("records the shames and never shames twice for the same day", async () => {
    await seedGroup();
    mockMembers({ [DORA]: "kicked" });

    await runDailyShame(AFTER_RESET, withGif, bot);
    await runDailyShame(AFTER_RESET, withGif, bot);

    expect(shamePosts()).toHaveLength(2);
    const { results } = await env.DB.prepare("SELECT * FROM shames ORDER BY telegram_user_id").all();
    expect(results).toEqual([
      {
        telegram_user_id: BERTTA,
        puzzle_day: "2026-10-19",
        missed_games: "tango,mini-sudoku,patches,wend",
        shamed_at: AFTER_RESET.getTime() / 1000,
      },
      {
        telegram_user_id: CECILIA,
        puzzle_day: "2026-10-19",
        missed_games: "queens,tango,zip,mini-sudoku,patches,wend",
        shamed_at: AFTER_RESET.getTime() / 1000,
      },
    ]);
  });

  it("posts nothing at all when everyone posted every game", async () => {
    await addPlayer(AINO, "Aino");
    await addPlayer(BERTTA, "Bertta");
    for (const [game, number] of Object.entries(PUZZLES)) {
      await addScore(AINO, game, number, ON_THE_DAY);
      await addScore(BERTTA, game, number, ON_THE_DAY + 60);
    }
    mockMembers();

    await runDailyShame(AFTER_RESET, withGif, bot);

    expect(telegramCalls()).toEqual([]);
    expect(logged("log")).toContainEqual(expect.objectContaining({ event: "daily_shame_done", shamed: [] }));
  });

  it("shames for a game nobody posted", async () => {
    await addPlayer(AINO, "Aino");
    for (const [game, number] of Object.entries(PUZZLES)) {
      if (game !== "wend") {
        await addScore(AINO, game, number, ON_THE_DAY);
      }
    }
    mockMembers();

    await runDailyShame(AFTER_RESET, withGif, bot);

    expect(shamePosts()).toHaveLength(1);
    expect((shamePosts()[0]!.params as { caption: string }).caption).toContain("Wend");
  });

  it("counts restricted users who are still in the group as members", async () => {
    await addPlayer(CECILIA, "Cecilia");
    vi.mocked(globalThis.fetch).mockImplementation(async (input) =>
      String(input).endsWith("/getChatMember")
        ? Response.json({ ok: true, result: { status: "restricted", is_member: true, user: { id: CECILIA } } })
        : Response.json({ ok: true, result: true }),
    );

    await runDailyShame(AFTER_RESET, withGif, bot);

    expect(shamePosts()).toHaveLength(1);
  });

  it("skips people whose membership can't be checked", async () => {
    await addPlayer(CECILIA, "Cecilia");
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({ ok: false, error_code: 400, description: "Bad Request: user not found" }),
    );

    await runDailyShame(AFTER_RESET, withGif, bot);

    expect(shamePosts()).toEqual([]);
    expect(logged("warn")).toContainEqual(
      expect.objectContaining({ event: "shame_skipped", user_id: CECILIA, reason: "membership check failed" }),
    );
  });

  it("sends just the text when no GIF is configured, escaping names", async () => {
    await addPlayer(CECILIA, "<Ceci & co>");
    mockMembers();

    await runDailyShame(AFTER_RESET, env, bot);

    expect(shamePosts()).toEqual([
      {
        method: "sendMessage",
        params: {
          chat_id: OUR_GROUP,
          text: `🔔 Shame! 🔔 <a href="tg://user?id=${CECILIA}">&lt;Ceci &amp; co&gt;</a> didn't post a single result yesterday. Not one.`,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        },
      },
    ]);
  });

  // The cron fires at 07:05 and 08:05 UTC. Finland is UTC+3 in summer time and UTC+2 in winter.
  describe("timing in Finland", () => {
    async function shamedDayAt(utc: string): Promise<unknown> {
      await addPlayer(CECILIA, "Cecilia");
      mockMembers();
      await runDailyShame(new Date(utc), withGif, bot);
      return logged("log").find(({ event }) => event === "daily_shame_done")?.puzzle_day ?? null;
    }

    it.each([
      ["summer time in both", "2026-10-20T07:05:00Z", "10:05", "2026-10-19"],
      ["winter time in both", "2026-12-10T08:05:00Z", "10:05", "2026-12-09"],
    ])("shames at 10:05 with %s", async (_, utc, _helsinki, puzzleDay) => {
      expect(await shamedDayAt(utc)).toBe(puzzleDay);
    });

    it.each([
      ["summer time in both", "2026-10-20T08:05:00Z", "11:05"],
      ["winter time in both", "2026-12-10T07:05:00Z", "09:05, before the reset"],
    ])("stays quiet on the other run with %s (%s)", async (_, utc) => {
      expect(await shamedDayAt(utc)).toBeNull();
      expect(telegramCalls()).toEqual([]);
      expect(logged("log")).toContainEqual(expect.objectContaining({ event: "daily_shame_skipped" }));
    });

    // Finland changes its clocks on the last Sunday of March and October, the US on
    // the second Sunday of March and the first Sunday of November. In between, the
    // puzzles reset at 09:00 in Finland, so that's when the shame goes out.
    it.each([
      ["late October (Finland already on winter time)", "2026-10-28T07:05:00Z", "2026-10-27"],
      ["March (US already on summer time)", "2027-03-20T07:05:00Z", "2027-03-19"],
    ])("shames at 09:05 in %s, right after that day's earlier reset", async (_, utc, puzzleDay) => {
      expect(await shamedDayAt(utc)).toBe(puzzleDay);
    });

    it.each([
      ["late October", "2026-10-28T08:05:00Z"],
      ["March", "2027-03-20T08:05:00Z"],
    ])("doesn't shame again at 10:05 in %s", async (_, utc) => {
      expect(await shamedDayAt(utc)).toBeNull();
    });
  });

  it("is what the Worker's cron trigger runs", async () => {
    await addPlayer(CECILIA, "Cecilia");
    mockMembers();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: AFTER_RESET, cron: "5 7,8 * * *" }), withGif, ctx);
    await waitOnExecutionContext(ctx);

    expect(shamePosts()).toHaveLength(1);
  });
});

describe("puzzleNumbersFor", () => {
  it("works out each game's number for a day, ignoring late posts", () => {
    expect(
      puzzleNumbersFor("2026-10-19", [
        { game: "queens", puzzle_number: 897, first_posted_at: ON_THE_DAY - 3 * DAY },
        // Yesterday's Tango first posted after the reset: would point one too low.
        { game: "tango", puzzle_number: 699, first_posted_at: ON_THE_DAY },
        { game: "tango", puzzle_number: 698, first_posted_at: ON_THE_DAY - 2 * DAY },
      ]),
    ).toEqual({ queens: 900, tango: 700 });
  });
});
