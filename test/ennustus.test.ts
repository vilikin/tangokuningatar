import { describe, expect, it } from "vitest";
import { ennustus } from "../src/ennustus";
import groupScore from "./fixtures/group-score-message.json";
import { send, telegramCalls } from "./helpers";

const at = (iso: string) => Date.parse(iso) / 1000;
const MONDAY = at("2026-10-19T12:00:00Z");

describe("ennustus", () => {
  it("reads as a horoscope for the sender and the puzzle day", () => {
    expect(ennustus(MONDAY, 1234567891, "Aino")).toMatch(
      /^🔮 Aino's ennustus for Mon 19\.10\.\n\nLucky game: (Queens|Tango|Zip|Mini Sudoku|Patches|Wend) ★{2,5}☆{0,3}\nBeware of: (Queens|Tango|Zip|Mini Sudoku|Patches|Wend)\nLucky time: [01]:\d\d\n\n.+$/,
    );
  });

  it("stays the same all puzzle day, so asking again doesn't reroll it", () => {
    expect(ennustus(at("2026-10-19T07:00:00Z"), 1234567891, "Aino")).toBe(ennustus(at("2026-10-20T06:59:59Z"), 1234567891, "Aino"));
  });

  it("is still yesterday's before the new puzzles are out", () => {
    expect(ennustus(at("2026-10-19T06:00:00Z"), 1234567891, "Aino")).toMatch(/for Sun 18\.10\./);
  });

  it("differs between people and between days", () => {
    const people = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((id) => ennustus(MONDAY, id, "X")));
    const days = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((day) => ennustus(MONDAY + day * 86_400, 1, "X").split("\n").slice(2).join("\n")));
    expect(people.size).toBeGreaterThan(4);
    expect(days.size).toBeGreaterThan(4);
  });

  it("never tells you to beware of your lucky game, and keeps the numbers in range", () => {
    for (let id = 0; id < 300; id++) {
      const text = ennustus(MONDAY, id, "X");
      const lucky = /Lucky game: (.+?) [★☆]+\n/.exec(text)![1];
      const beware = /Beware of: (.+)\n/.exec(text)![1];
      const [, minutes, seconds] = /Lucky time: (\d):(\d\d)/.exec(text)!.map(Number);
      expect(beware).not.toBe(lucky);
      expect(minutes! * 60 + seconds!).toBeGreaterThanOrEqual(15);
      expect(minutes! * 60 + seconds!).toBeLessThanOrEqual(90);
    }
  });

  it("answers /ennustus in the group", async () => {
    const command = {
      update_id: 706000001,
      message: { message_id: 906001, from: groupScore.message.from, chat: groupScore.message.chat, date: MONDAY, text: "/ennustus" },
    };

    await send(command);

    expect(telegramCalls()).toEqual([
      {
        method: "sendMessage",
        params: {
          chat_id: groupScore.message.chat.id,
          text: ennustus(MONDAY, groupScore.message.from.id, "Aino"),
          reply_parameters: { message_id: 906001 },
          link_preview_options: { is_disabled: true },
        },
      },
    ]);
  });
});
