import { describe, expect, it } from "vitest";
import type { Player } from "../src/db";
import { ennustus } from "../src/ennustus";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import { send, telegramCalls } from "./helpers";

const at = (iso: string) => Date.parse(iso) / 1000;
const MONDAY = at("2026-10-19T12:00:00Z");

const player = (id: number, first_name: string, last_name: string | null = null): Player => ({
  telegram_user_id: id,
  username: null,
  first_name,
  last_name,
});
const GROUP = [player(1, "Aino"), player(2, "Liisa"), player(3, "Mikko")];

describe("ennustus", () => {
  it("reads as a horoscope for the sender and the puzzle day", () => {
    expect(ennustus(MONDAY, 1, "Aino", GROUP)).toMatch(
      /^🔮 Aino's ennustus for Mon 19\.10\.\n\nLucky game: (Queens|Tango|Zip|Mini Sudoku|Patches|Wend) ★{2,5}☆{0,3}\nBeware of: (Queens|Tango|Zip|Mini Sudoku|Patches|Wend)\nLucky time: [01]:\d\d\nRival today: (Liisa|Mikko)\n\n.+$/,
    );
  });

  it("stays the same all puzzle day, so asking again doesn't reroll it", () => {
    expect(ennustus(at("2026-10-19T07:00:00Z"), 1, "Aino", GROUP)).toBe(ennustus(at("2026-10-20T06:59:59Z"), 1, "Aino", GROUP));
  });

  it("is still yesterday's before the new puzzles are out", () => {
    expect(ennustus(at("2026-10-19T06:00:00Z"), 1, "Aino", GROUP)).toMatch(/for Sun 18\.10\./);
  });

  it("differs between people and between days", () => {
    const people = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((id) => ennustus(MONDAY, id, "X", []).split("\n").slice(2).join("\n")));
    const days = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((day) => ennustus(MONDAY + day * 86_400, 1, "X", []).split("\n").slice(2).join("\n")));
    expect(people.size).toBeGreaterThan(4);
    expect(days.size).toBeGreaterThan(4);
  });

  it("never tells you to beware of your lucky game, never makes you your own rival, and keeps the numbers in range", () => {
    for (let id = 1; id <= 300; id++) {
      const text = ennustus(MONDAY, id % 3 || 3, "X", GROUP);
      const lucky = /Lucky game: (.+?) [★☆]+\n/.exec(text)![1];
      const beware = /Beware of: (.+)\n/.exec(text)![1];
      const [, minutes, seconds] = /Lucky time: (\d):(\d\d)/.exec(text)!.map(Number);
      const rival = /Rival today: (.+)\n/.exec(text)![1];
      expect(beware).not.toBe(lucky);
      expect(rival).not.toBe(GROUP[(id % 3 || 3) - 1]!.first_name);
      expect(minutes! * 60 + seconds!).toBeGreaterThanOrEqual(15);
      expect(minutes! * 60 + seconds!).toBeLessThanOrEqual(90);
    }
  });

  it("leaves the rival out when there's nobody else", () => {
    expect(ennustus(MONDAY, 1, "Aino", [player(1, "Aino")])).not.toContain("Rival today");
  });

  it("tells rivals with the same first name apart", () => {
    const text = ennustus(MONDAY, 1, "Aino", [player(1, "Aino", "Virtanen"), player(2, "Aino", "Korhonen")]);
    expect(text).toContain("Rival today: Aino Korhonen");
  });
});

describe("/ennustus", () => {
  let nextId = 0;
  function message(from: object, iso: string, text: string) {
    nextId++;
    return {
      update_id: 706000000 + nextId,
      message: { message_id: 906000 + nextId, from, chat: groupScore.message.chat, date: at(iso), text },
    };
  }
  const MIKKO = groupChatMessage.message.from;
  const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };

  it("answers in the group, picking the rival from who posted in the 4 weeks before today", async () => {
    // Too long ago, and today: neither can be the rival.
    await send(message(LIISA, "2026-09-01T09:00:00Z", "Zip #500 | 0:20 🏁\nlnkd.in/zip."));
    await send(message(groupScore.message.from, "2026-10-19T08:00:00Z", "Zip #572 | 0:30 🏁\nlnkd.in/zip."));
    // Last week: the only possible rival.
    await send(message(MIKKO, "2026-10-12T09:00:00Z", "Zip #565 | 0:25 🏁\nlnkd.in/zip."));
    const command = message(groupScore.message.from, "2026-10-19T12:00:00Z", "/ennustus");

    await send(command);

    expect(telegramCalls().at(-1)).toEqual({
      method: "sendMessage",
      params: {
        chat_id: groupScore.message.chat.id,
        text: ennustus(MONDAY, groupScore.message.from.id, "Aino", [player(MIKKO.id, "Mikko")]),
        reply_parameters: { message_id: command.message.message_id },
        link_preview_options: { is_disabled: true },
      },
    });
    expect((telegramCalls().at(-1)!.params as { text: string }).text).toContain("Rival today: Mikko");
  });
});
