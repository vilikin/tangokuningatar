import { describe, expect, it } from "vitest";
import type { MoodResult } from "../src/db";
import { formatMood } from "../src/mood";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import { send, telegramCalls } from "./helpers";

const AINO = groupScore.message.from;
const MIKKO = groupChatMessage.message.from;
const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };
const PEKKA = { id: 1234567894, is_bot: false, first_name: "Pekka" };

let nextId = 0;

function message(from: object, iso: string, text: string) {
  nextId++;
  return {
    update_id: 705000000 + nextId,
    message: { message_id: 905000 + nextId, from, chat: groupScore.message.chat, date: Date.parse(iso) / 1000, text },
  };
}

const zip = (number: number, time: string) => `Zip #${number} | ${time} 🏁\nlnkd.in/zip.`;
const tango = (number: number, time: string) => `Tango #${number} | ${time}\nlnkd.in/tango.`;

const lastReply = () =>
  (telegramCalls()
    .filter(({ method }) => method === "sendMessage")
    .at(-1)?.params as { text: string } | undefined)?.text;

/** Three days of history before Monday 2026-10-19, whose puzzles came out at 07:00 UTC. */
async function postHistory() {
  for (const [i, day] of ["2026-10-15", "2026-10-16", "2026-10-17"].entries()) {
    await send(message(AINO, `${day}T09:00:00Z`, zip(568 + i, "0:30")));
    await send(message(LIISA, `${day}T09:00:00Z`, zip(568 + i, "0:20")));
    await send(message(MIKKO, `${day}T09:00:00Z`, tango(596 + i, "1:00")));
  }
}

describe("/mood", () => {
  it("compares today's results with each player's own average", async () => {
    await postHistory();
    // Today: Aino 0.8×, Liisa 1.1×, Mikko 1.5× their usual. Pekka has no history.
    await send(message(AINO, "2026-10-19T08:00:00Z", zip(572, "0:24")));
    await send(message(LIISA, "2026-10-19T08:00:00Z", zip(572, "0:22")));
    await send(message(MIKKO, "2026-10-19T08:00:00Z", tango(600, "1:30")));
    await send(message(PEKKA, "2026-10-19T08:00:00Z", zip(572, "0:05")));

    await send(message(AINO, "2026-10-19T12:00:00Z", "/mood"));

    expect(lastReply()).toBe(
      "😒 Today's mood: disappointed\n" +
        "The group is 13% slower than usual today (3 results, compared with each player's own average from the last 4 weeks).\n" +
        "I'm not angry, just disappointed.\n\n" +
        "Best: Aino on Zip, 20% faster than usual.\n" +
        "Worst: Mikko on Tango, 50% slower than usual.",
    );
  });

  it("leaves out players with too little history, and history older than 4 weeks", async () => {
    // Two results last week, and plenty from two months ago.
    for (const day of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-10-15", "2026-10-16"]) {
      // Zip #572 is Monday 2026-10-19's puzzle, and the numbers go up by one a day.
      const number = 572 + (Date.parse(day) - Date.parse("2026-10-19")) / 86_400_000;
      await send(message(AINO, `${day}T09:00:00Z`, zip(number, "0:30")));
    }
    await send(message(AINO, "2026-10-19T08:00:00Z", zip(572, "0:15")));

    await send(message(AINO, "2026-10-19T12:00:00Z", "/mood"));

    expect(lastReply()).toMatch(/^😶 No mood yet\./);
  });

  it("doesn't count yesterday's puzzle posted late", async () => {
    await postHistory();
    // Sunday's puzzle, posted on time by Liisa and late by Aino.
    await send(message(LIISA, "2026-10-18T09:00:00Z", zip(571, "0:20")));
    await send(message(AINO, "2026-10-19T08:00:00Z", zip(571, "0:15")));
    await send(message(AINO, "2026-10-19T08:05:00Z", zip(572, "0:30")));

    await send(message(AINO, "2026-10-19T12:00:00Z", "/mood"));

    expect(lastReply()).toMatch(/^😐 Today's mood: meh\nThe group is right on the usual pace today \(1 result,/);
  });
});

describe("formatMood", () => {
  const result = (name: string, timeSeconds: number, usualSeconds: number, game: MoodResult["game"] = "zip"): MoodResult => ({
    telegramUserId: name.length,
    firstName: name,
    lastName: null,
    game,
    timeSeconds,
    usualSeconds,
  });

  it.each([
    [80, "🤩 Today's mood: ecstatic", "20% faster", "I'm so proud I could cry."],
    [90, "😊 Today's mood: happy", "10% faster", "Look at you all go."],
    [104, "😐 Today's mood: meh", "4% slower", "Business as usual."],
    [119, "😒 Today's mood: disappointed", "19% slower", "I'm not angry, just disappointed."],
    [150, "😭 Today's mood: devastated", "50% slower", "Was everyone playing with their eyes closed?"],
  ])("at %i% of usual is %s", (percent, title, pace, line) => {
    expect(formatMood([result("Aino", percent, 100)])).toBe(
      `${title}\nThe group is ${pace} than usual today (1 result, compared with each player's own average from the last 4 weeks).\n${line}`,
    );
  });

  it("names the best and the worst once there are several results", () => {
    expect(formatMood([result("Aino", 50, 100), result("Liisa", 100, 100, "tango"), result("Mikko", 300, 100, "queens")])).toContain(
      "\n\nBest: Aino on Zip, 50% faster than usual.\nWorst: Mikko on Queens, 200% slower than usual.",
    );
  });

  it("explains itself when there's nothing to compare", () => {
    expect(formatMood([])).toBe(
      "😶 No mood yet. I compare today's results with each player's own average, so I need someone who has played the same game at least 3 times in the last 4 weeks.",
    );
  });
});
