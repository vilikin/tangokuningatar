import { describe, expect, it } from "vitest";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupScore from "./fixtures/group-score-message.json";
import { logged, send, telegramCalls } from "./helpers";

const AINO = groupScore.message.from;
const MIKKO = groupChatMessage.message.from;
const LIISA = { id: 1234567893, is_bot: false, first_name: "Liisa" };

let nextId = 0;

/** A message in our group from `from`. Each one is posted a minute after the previous. */
function message(from: object, text: string) {
  nextId++;
  return {
    update_id: 704000000 + nextId,
    message: { message_id: 904000 + nextId, from, chat: groupScore.message.chat, date: 1791522753 + nextId * 60, text },
  };
}

const zip = (number: number, time: string) => `Zip #${number} | ${time} 🏁\nlnkd.in/zip.`;

/** The reaction to the last message, and the texts of any replies to it. */
function answerTo(update: ReturnType<typeof message>) {
  const calls = telegramCalls().filter(
    ({ params }) =>
      (params as { message_id?: number }).message_id === update.message.message_id ||
      (params as { reply_parameters?: { message_id: number } }).reply_parameters?.message_id === update.message.message_id,
  );
  return {
    reaction: calls
      .filter(({ method }) => method === "setMessageReaction")
      .map(({ params }) => (params as { reaction: { emoji: string }[] }).reaction[0]!.emoji)
      .at(-1),
    replies: calls.filter(({ method }) => method === "sendMessage").map(({ params }) => (params as { text: string }).text),
  };
}

async function post(from: object, text: string) {
  const update = message(from, text);
  await send(update);
  return answerTo(update);
}

describe("personal bests", () => {
  it("doesn't count anyone's first result as a personal best or a record", async () => {
    expect(await post(AINO, zip(570, "0:40"))).toEqual({ reaction: "👍", replies: [] });
  });

  it("reacts with 🔥 when someone beats their own best", async () => {
    await post(LIISA, zip(570, "0:20"));
    await post(AINO, zip(570, "0:40"));
    expect(await post(AINO, zip(571, "0:45"))).toEqual({ reaction: "👍", replies: [] });

    // Faster than Aino's 0:40, but not Liisa's record.
    expect(await post(AINO, zip(572, "0:30"))).toEqual({ reaction: "🔥", replies: [] });
    expect(logged("log")).toContainEqual(
      expect.objectContaining({ event: "score_highlights", from_id: AINO.id, personal_bests: ["zip"], records: [] }),
    );
  });

  it("doesn't count a tie", async () => {
    await post(LIISA, zip(570, "0:20"));
    await post(AINO, zip(570, "0:30"));

    expect(await post(AINO, zip(571, "0:30"))).toEqual({ reaction: "👍", replies: [] });
    expect(await post(AINO, zip(572, "0:20"))).toEqual({ reaction: "🔥", replies: [] });
  });

  it("only compares the same game", async () => {
    await post(AINO, zip(570, "0:40"));

    expect(await post(AINO, "Queens #892\n0:30 👑\nlnkd.in/queens.")).toEqual({ reaction: "👍", replies: [] });
  });

  it("doesn't count a repost of an earlier puzzle, even a faster one", async () => {
    await post(AINO, zip(570, "0:40"));

    expect(await post(AINO, zip(570, "0:05"))).toEqual({ reaction: "🤨", replies: [] });
  });

  it("gives the same 🔥 when Telegram redelivers the update", async () => {
    await post(AINO, zip(570, "0:40"));
    const best = message(AINO, zip(571, "0:30"));

    await send(best);
    await send(best);

    const reactions = telegramCalls().filter(
      ({ method, params }) => method === "setMessageReaction" && (params as { message_id: number }).message_id === best.message.message_id,
    );
    expect(reactions.map(({ params }) => (params as { reaction: { emoji: string }[] }).reaction[0]!.emoji)).toEqual(["🔥", "🔥"]);
  });
});

describe("group records", () => {
  it("replies when someone beats the group record", async () => {
    await post(LIISA, zip(570, "0:20"));
    await post(AINO, zip(570, "0:30"));

    expect(await post(AINO, zip(571, "0:15"))).toEqual({
      reaction: "🔥",
      replies: ["🏆 New group record!\nAino did Zip #571 in 0:15, beating Liisa's old record of 0:20."],
    });
    expect(logged("log")).toContainEqual(expect.objectContaining({ event: "score_highlights", records: ["zip"] }));
  });

  it("can be someone's first result, which isn't a personal best", async () => {
    await post(LIISA, zip(570, "0:20"));

    expect(await post(MIKKO, zip(570, "0:10"))).toEqual({
      reaction: "👍",
      replies: ["🏆 New group record!\nMikko did Zip #570 in 0:10, beating Liisa's old record of 0:20."],
    });
  });

  it("says so when someone beats their own record", async () => {
    await post(LIISA, zip(570, "0:20"));

    expect((await post(LIISA, zip(571, "0:18"))).replies).toEqual([
      "🏆 New group record!\nLiisa did Zip #571 in 0:18, beating their own old record of 0:20.",
    ]);
  });

  it("lists several records from one message in one reply", async () => {
    await post(LIISA, `${zip(570, "0:20")}\n\nQueens #892\n1:00 👑\nlnkd.in/queens.`);

    expect(await post(AINO, `Queens #893\n0:50 👑\nlnkd.in/queens.\n\n${zip(571, "0:19")}`)).toEqual({
      reaction: "👍",
      replies: [
        "🏆 New group records!\n" +
          "Aino did Queens #893 in 0:50, beating Liisa's old record of 1:00.\n" +
          "Aino did Zip #571 in 0:19, beating Liisa's old record of 0:20.",
      ],
    });
  });

  it("still announces a record posted next to a Pinpoint result, but the 👎 wins", async () => {
    await post(LIISA, zip(570, "0:20"));

    const answer = await post(AINO, `Pinpoint #512 | 2 guesses\nlnkd.in/pinpoint.\n\n${zip(571, "0:15")}`);

    expect(answer.reaction).toBe("👎");
    expect(answer.replies).toContainEqual("🏆 New group record!\nAino did Zip #571 in 0:15, beating Liisa's old record of 0:20.");
    expect(answer.replies).toHaveLength(2);
  });
});
