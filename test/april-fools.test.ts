import { afterEach, describe, expect, it, vi } from "vitest";
import { crowned, isAprilFools } from "../src/april-fools";
import type { PlayerTotal } from "../src/db";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import { get, runScheduled, send, signInitData, telegramCalls } from "./helpers";

const AINO = groupScore.message.from;
const MIKKO = groupChatMessage.message.from;
const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };

const at = (iso: string) => Date.parse(iso) / 1000;

let nextId = 0;

/** A message in our group from `from`, posted at `iso`. */
function message(from: object, iso: string, text: string) {
  nextId++;
  return {
    update_id: 704000000 + nextId,
    message: { message_id: 904000 + nextId, from, chat: groupScore.message.chat, date: at(iso), text },
  };
}

const sentTexts = () =>
  telegramCalls()
    .filter(({ method }) => method === "sendMessage")
    .map(({ params }) => (params as { text: string }).text);

/**
 * Saturday's puzzles of the week starting `saturday`. Mikko leads with 3:50
 * over 3 games, then Liisa 2:10 and Aino 3:00 over 2. Liisa is the turtle: her
 * Zip is 5.0× Mikko's.
 */
async function postWeek(saturday: string) {
  await send(message(MIKKO, `${saturday}T10:00:00Z`, "Zip #900 | 0:20 🏁\nlnkd.in/zip.\n\nQueens #800\n2:00 👑\nlnkd.in/queens.\n\nTango #700 | 1:30\nlnkd.in/tango."));
  await send(message(LIISA, `${saturday}T10:05:00Z`, "Zip #900 | 1:40 🏁\nlnkd.in/zip.\n\nTango #700 | 0:30\nlnkd.in/tango."));
  await send(message(AINO, `${saturday}T10:10:00Z`, "Zip #900 | 0:30 🏁\nlnkd.in/zip.\n\nQueens #800\n2:30 👑\nlnkd.in/queens."));
}

describe("isAprilFools", () => {
  it.each([
    // Finland is on UTC+3 from 2027-03-28.
    ["2027-03-31T20:59:59Z", false],
    ["2027-03-31T21:00:00Z", true],
    ["2027-04-01T20:59:59Z", true],
    ["2027-04-01T21:00:00Z", false],
  ])("at %s is %s", (iso, expected) => {
    expect(isAprilFools(at(iso))).toBe(expected);
  });
});

describe("crowned", () => {
  const total = (telegramUserId: number, games: number, totalSeconds: number): PlayerTotal => ({
    telegramUserId,
    firstName: String(telegramUserId),
    lastName: null,
    games,
    totalSeconds,
  });

  it("crowns whoever is last on April 1st when there's no turtle", () => {
    const totals = [total(1, 2, 60), total(2, 1, 30), total(3, 1, 30)];

    expect(crowned(totals, null, at("2027-04-01T12:00:00Z")).map((t) => t.telegramUserId)).toEqual([2, 3]);
    expect(crowned(totals, null, at("2027-03-31T12:00:00Z")).map((t) => t.telegramUserId)).toEqual([1]);
  });
});

describe("commands on April 1st", () => {
  const WEEK = "Week is Sat–Fri: Sat 27.3. – Fri 2.4.";

  it("sort /week backwards, and /kuningatar crowns the turtle", async () => {
    await postWeek("2027-03-27");

    await send(message(AINO, "2027-04-01T12:00:00Z", "/week"));
    await send(message(AINO, "2027-04-01T12:00:00Z", "/kuningatar"));

    expect(sentTexts()).toEqual([
      `🏆 This week's leaderboard: all games\n${WEEK}\n\n🥇 Aino: 3:00 (2 games)\n🥈 Liisa: 2:10 (2 games)\n🥉 Mikko: 3:50 (3 games)`,
      `👑 Tangokuningatar so far this week: Liisa\n2:10 over 2 games.\n\n${WEEK}\nCrowned on Friday at 16:00.`,
    ]);
  });

  it("sort /week_<game> backwards too", async () => {
    await postWeek("2027-03-27");

    await send(message(AINO, "2027-04-01T12:00:00Z", "/week_zip"));

    expect(sentTexts()).toEqual([
      `🏆 This week's leaderboard: Zip\n${WEEK}\n\n🥇 Liisa: 1:40 (1 game)\n🥈 Aino: 0:30 (1 game)\n🥉 Mikko: 0:20 (1 game)`,
    ]);
  });

  it("are back to normal on March 31st", async () => {
    await postWeek("2027-03-27");

    await send(message(AINO, "2027-03-31T12:00:00Z", "/week"));
    await send(message(AINO, "2027-03-31T12:00:00Z", "/kuningatar"));

    expect(sentTexts()).toEqual([
      `🏆 This week's leaderboard: all games\n${WEEK}\n\n🥇 Mikko: 3:50 (3 games)\n🥈 Liisa: 2:10 (2 games)\n🥉 Aino: 3:00 (2 games)`,
      `👑 Tangokuningatar so far this week: Mikko\n3:50 over 3 games.\n\n${WEEK}\nCrowned on Friday at 16:00.`,
    ]);
  });
});

describe("the weekly crowning on a Friday April 1st", () => {
  it("crowns the turtle", async () => {
    await postWeek("2033-03-26");

    await runScheduled("2033-04-01T13:00:00Z");

    expect(sentTexts()).toEqual([
      "👑 Tangokuningatar of the week: Liisa!\n2:10 over 2 games.\n\n" +
        "🐢 Turtle of the week: Liisa\nZip #900 in 1:40, 5.0× the fastest 0:20 (Mikko).\n\n" +
        "Week is Sat–Fri: Sat 26.3. – Fri 1.4.\nFull standings: /week",
    ]);
  });
});

describe("the Mini App on April 1st", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the standings backwards", async () => {
    await postWeek("2027-03-27");
    const now = "2027-04-01T12:00:00Z";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const initData = await signInitData({
      auth_date: String(at(now) - 60),
      chat_instance: "-4818412012345678901",
      chat_type: "group",
      user: JSON.stringify(LIISA),
    });

    const response = await get("/api/week", { Authorization: `tma ${initData}` });

    const body = await response.json<{ boards: { id: string; standings: { rank: number; name: string }[] }[] }>();
    expect(body.boards[0]!.standings.map(({ rank, name }) => [rank, name])).toEqual([
      [1, "Aino"],
      [2, "Liisa"],
      [3, "Mikko"],
    ]);
  });
});
