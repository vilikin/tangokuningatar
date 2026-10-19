import { describe, expect, it } from "vitest";
import groupScore from "./fixtures/group-score-message.json";
import { get, logged, send, signInitData, telegramCalls } from "./helpers";

const AINO = groupScore.message.from;
const EERO = { id: 1234567892, is_bot: false, first_name: "Eero" };
const NOW = Math.floor(Date.now() / 1000);
// Margin around the 24h limit: NOW is read once, and the clock keeps ticking while tests run.
const ONE_DAY = 24 * 60 * 60;
const MARGIN = 60;

/** initData for `user`, launched `ageSeconds` ago, as Telegram would hand it to the page. */
function launchFields(user: object, ageSeconds = 60): Record<string, string> {
  return {
    auth_date: String(NOW - ageSeconds),
    chat_instance: "-4818412012345678901",
    chat_type: "group",
    user: JSON.stringify(user),
  };
}

const myScores = (initData: string | null, envOverrides: Partial<Env> = {}) =>
  get("/api/my-scores", initData === null ? {} : { Authorization: `tma ${initData}` }, envOverrides);

async function seedScores(): Promise<void> {
  await send(groupScore);
  await send({
    update_id: 701234502,
    message: {
      ...groupScore.message,
      message_id: 901043,
      from: EERO,
      text: "Queens #892\n1:00 👑\nlnkd.in/queens.",
    },
  });
}

describe("Mini App page", () => {
  it("serves the page without any data in it", async () => {
    const response = await get("/app");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("telegram-web-app.js");
    expect(html).toContain("/api/my-scores");
  });

  it.each(["/app", "/api/my-scores"])("returns 405 for POST to %s", async (path) => {
    const response = await send({}, { path });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});

describe("my scores API", () => {
  it("returns only the viewer's own scores", async () => {
    await seedScores();

    const response = await myScores(await signInitData(launchFields(AINO)));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      first_name: "Aino",
      scores: [
        {
          game: "patches",
          game_name: "Patches",
          puzzle_number: 206,
          time_seconds: 29,
          no_hints: 1,
          no_redraws: 1,
          posted_at: groupScore.message.date,
        },
      ],
    });
    expect(telegramCalls().filter(({ method }) => method !== "setMessageReaction")).toEqual([]);
  });

  it("returns 403 to someone Telegram vouches for who has never posted in our group", async () => {
    await seedScores();
    const stranger = { id: 999, is_bot: false, first_name: "Stranger" };

    const response = await myScores(await signInitData(launchFields(stranger)));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(logged("log")).toContainEqual({ event: "mini_app_scores", from_id: 999, player: false, scores: 0 });
  });

  it("accepts initData that is almost a day old", async () => {
    await seedScores();
    const response = await myScores(await signInitData(launchFields(AINO, ONE_DAY - MARGIN)));
    expect(response.status).toBe(200);
  });

  describe("returns 401 without revealing anything", () => {
    it.each<[string, () => Promise<string | null>]>([
      ["there is no Authorization header", async () => null],
      ["the initData is empty", async () => ""],
      ["there is no hash", async () => new URLSearchParams(launchFields(AINO)).toString()],
      ["the hash is not hex", async () => new URLSearchParams({ ...launchFields(AINO), hash: "zz" }).toString()],
      ["it was signed with another bot's token", async () => signInitData(launchFields(AINO), "other-bot-token")],
      ["it is more than a day old", async () => signInitData(launchFields(AINO, ONE_DAY + MARGIN))],
      [
        "the user was swapped after signing",
        async () => {
          const params = new URLSearchParams(await signInitData(launchFields(EERO)));
          params.set("user", JSON.stringify(AINO));
          return params.toString();
        },
      ],
      [
        "a field was added after signing",
        async () => (await signInitData(launchFields(AINO))) + "&start_param=queens",
      ],
      ["the user is missing", async () => signInitData({ auth_date: String(NOW) })],
      ["the user is not JSON", async () => signInitData({ auth_date: String(NOW), user: "aino" })],
    ])("when %s", async (_, initData) => {
      await seedScores();

      const response = await myScores(await initData());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Open this page from Telegram." });
      expect(logged("log")).not.toContainEqual(expect.objectContaining({ event: "mini_app_scores" }));
    });

    it("when the Authorization scheme is not tma", async () => {
      const response = await get("/api/my-scores", { Authorization: `Bearer ${await signInitData(launchFields(AINO))}` });
      expect(response.status).toBe(401);
    });

    it("when TELEGRAM_BOT_TOKEN is not configured, even for initData signed with an empty token", async () => {
      await seedScores();

      const response = await myScores(await signInitData(launchFields(AINO), ""), { TELEGRAM_BOT_TOKEN: "" });

      expect(response.status).toBe(401);
      expect(logged("error")).toContainEqual(expect.objectContaining({ event: "config_error" }));
    });
  });
});
