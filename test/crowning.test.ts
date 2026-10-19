import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import { logged, mockTelegramResponses, runScheduled, send, telegramCalls } from "./helpers";

const OUR_GROUP = -5465433776;

const AINO = groupScore.message.from;
const MIKKO = groupChatMessage.message.from;
const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };

let nextId = 0;

/** A message in our group from `from`, posted at `iso`. */
function message(from: object, iso: string, text: string) {
  nextId++;
  return {
    update_id: 703000000 + nextId,
    message: { message_id: 903000 + nextId, from, chat: groupScore.message.chat, date: Date.parse(iso) / 1000, text },
  };
}

const sentTexts = () =>
  telegramCalls()
    .filter(({ method }) => method === "sendMessage")
    .map(({ params }) => (params as { text: string }).text);

/** Messages posted on their own, not as a reply (posting scores can also get a record reply). */
const postedTexts = () =>
  telegramCalls()
    .filter(({ method, params }) => method === "sendMessage" && !(params as object).hasOwnProperty("reply_parameters"))
    .map(({ params }) => (params as { text: string }).text);

const WEEK = "Week is Sat–Fri: Sat 17.10. – Fri 23.10.";

/**
 * Week totals: Liisa 1:30, Aino 3:40, Mikko 3:50, three games each.
 * Aino's Queens is the slowest time (1.25× Mikko's), but Mikko's Tango is the
 * slowest compared with the fastest (3.0× Liisa's).
 */
async function postWeek() {
  // Last week's Friday puzzle, before Saturday's came out: doesn't count.
  await send(message(MIKKO, "2026-10-17T06:00:00Z", "Tango #599 | 9:00\nlnkd.in/tango."));
  // Saturday.
  await send(message(AINO, "2026-10-17T08:00:00Z", "Zip #572 | 0:30 🏁\nlnkd.in/zip.\n\nQueens #894\n2:30 👑\nlnkd.in/queens."));
  await send(
    message(MIKKO, "2026-10-17T09:00:00Z", "Zip #572 | 0:20 🏁\nlnkd.in/zip.\n\nQueens #894\n2:00 👑\nlnkd.in/queens.\n\nTango #600 | 1:30\nlnkd.in/tango."),
  );
  await send(message(LIISA, "2026-10-17T10:00:00Z", "Zip #572 | 0:25 🏁\nlnkd.in/zip.\n\nTango #600 | 0:30\nlnkd.in/tango."));
  // Sunday.
  await send(message(AINO, "2026-10-18T08:00:00Z", "Zip #573 | 0:40 🏁\nlnkd.in/zip."));
  await send(message(LIISA, "2026-10-18T09:00:00Z", "Zip #573 | 0:35 🏁\nlnkd.in/zip."));
}

describe("weekly crowning", () => {
  it("posts the Tangokuningatar and the turtle on Friday at 16:00 in Finland", async () => {
    await postWeek();

    // Finland is on summer time until 2026-10-25: 16:00 is 13:00 UTC.
    await runScheduled("2026-10-23T13:00:00Z");

    expect(telegramCalls().at(-1)).toEqual({
      method: "sendMessage",
      params: {
        chat_id: OUR_GROUP,
        text:
          "👑 Tangokuningatar of the week: Liisa!\n1:30 over 3 games.\n\n" +
          "🐢 Turtle of the week: Mikko\nTango #600 in 1:30, 3.0× the fastest 0:30 (Liisa).\n\n" +
          `${WEEK}\nFull standings: /week`,
        link_preview_options: { is_disabled: true },
      },
    });
    expect(logged("log")).toContainEqual({ event: "weekly_crowning_posted", chat_id: String(OUR_GROUP) });
  });

  it.each([
    // Summer time: 14:00 UTC is 17:00 in Finland.
    ["2026-10-23T14:00:00Z", "0 14 * * fri", 17],
    // Winter time: 13:00 UTC is 15:00 in Finland.
    ["2026-10-30T13:00:00Z", "0 13 * * fri", 15],
  ])("skips the other run at %s", async (iso, cron, hour) => {
    await postWeek();

    await runScheduled(iso, cron);

    expect(postedTexts()).toEqual([]);
    expect(logged("log")).toContainEqual({ event: "weekly_crowning_skipped", reason: `it's ${hour}:00 in Finland, not 16:00` });
  });

  it("posts at 14:00 UTC in winter time", async () => {
    await send(message(AINO, "2026-10-24T08:00:00Z", "Zip #579 | 0:30 🏁\nlnkd.in/zip."));

    await runScheduled("2026-10-30T14:00:00Z", "0 14 * * fri");

    expect(postedTexts()).toEqual([
      "👑 Tangokuningatar of the week: Aino!\n0:30 over 1 game.\n\n" +
        "🐢 No turtle this week: nobody was slower than anyone else on the same puzzle!\n\n" +
        "Week is Sat–Fri: Sat 24.10. – Fri 30.10.\nFull standings: /week",
    ]);
  });

  it("shares the crown on an exact tie", async () => {
    await send(message(AINO, "2026-10-17T08:00:00Z", "Zip #572 | 0:30 🏁\nlnkd.in/zip."));
    await send(message(LIISA, "2026-10-17T09:00:00Z", "Zip #572 | 0:30 🏁\nlnkd.in/zip."));

    await runScheduled("2026-10-23T13:00:00Z");

    expect(postedTexts()[0]).toMatch(/^👑 Tangokuningatar of the week: Aino and Liisa!\n0:30 over 1 game each\.\n\n🐢 No turtle/);
  });

  it("only counts a puzzle for the turtle when someone else played it too", async () => {
    await send(message(AINO, "2026-10-17T08:00:00Z", "Wend #100 | 9:59\nlnkd.in/wend.\n\nZip #572 | 0:30 🏁\nlnkd.in/zip."));
    await send(message(LIISA, "2026-10-17T09:00:00Z", "Zip #572 | 0:20 🏁\nlnkd.in/zip."));

    await runScheduled("2026-10-23T13:00:00Z");

    expect(postedTexts()[0]).toContain("🐢 Turtle of the week: Aino\nZip #572 in 0:30, 1.5× the fastest 0:20 (Liisa).");
  });

  it("posts nothing in a week without scores", async () => {
    await runScheduled("2026-10-23T13:00:00Z");

    expect(telegramCalls()).toEqual([]);
    expect(logged("log")).toContainEqual({ event: "weekly_crowning_skipped", reason: "no scores this week" });
  });

  it("logs a failed post", async () => {
    await postWeek();
    const before = telegramCalls().length;
    mockTelegramResponses(Response.json({ ok: false, error_code: 403, description: "Forbidden: bot was kicked" }, { status: 403 }));

    await runScheduled("2026-10-23T13:00:00Z");

    expect(telegramCalls()).toHaveLength(before + 1);
    expect(logged("error")).toEqual([
      expect.objectContaining({ event: "processing_error", error: expect.stringContaining("sendMessage failed: 403 Forbidden: bot was kicked") }),
    ]);
  });

  it("logs an error when ALLOWED_CHAT_ID is not configured", async () => {
    await postWeek();

    await runScheduled("2026-10-23T13:00:00Z", undefined, { ALLOWED_CHAT_ID: "" });

    expect(logged("error")).toEqual([expect.objectContaining({ event: "config_error" })]);
  });
});

describe("/kuningatar and /turtle", () => {
  it("show who leads the week so far", async () => {
    await postWeek();

    await send(message(AINO, "2026-10-19T12:00:00Z", "/kuningatar"));
    await send(message(AINO, "2026-10-19T12:00:00Z", "/turtle@tangokuningatar_bot"));

    expect(sentTexts().slice(-2)).toEqual([
      `👑 Tangokuningatar so far this week: Liisa\n1:30 over 3 games.\n\n${WEEK}\nCrowned on Friday at 16:00.`,
      "🐢 Turtle so far this week: Mikko\nTango #600 in 1:30, 3.0× the fastest 0:30 (Liisa).\n\n" +
        `${WEEK}\nThe turtle is the slowest result compared with the fastest time on the same puzzle. Announced on Friday at 16:00.`,
    ]);
  });

  it("say so before anyone has played", async () => {
    await send(message(AINO, "2026-10-19T12:00:00Z", "/kuningatar"));
    await send(message(AINO, "2026-10-19T12:00:00Z", "/turtle"));

    expect(sentTexts()).toEqual([
      `👑 Nobody has played this week yet. The crown is up for grabs!\n\n${WEEK}\nCrowned on Friday at 16:00.`,
      `🐢 No turtle this week yet.\n\n${WEEK}\nThe turtle is the slowest result compared with the fastest time on the same puzzle. Announced on Friday at 16:00.`,
    ]);
  });

  it("logs a database failure without replying", async () => {
    await env.DB.exec("DROP TABLE scores");

    await send(message(AINO, "2026-10-19T12:00:00Z", "/turtle"));

    expect(telegramCalls()).toEqual([]);
    expect(logged("error")).toEqual([expect.objectContaining({ event: "db_error", command: "turtle" })]);
  });
});
