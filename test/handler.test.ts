import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import botAddedToOtherGroup from "./fixtures/bot-added-to-other-group.json";
import botAddedToOurGroup from "./fixtures/bot-added-to-our-group.json";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupMigrated from "./fixtures/group-migrated-to-supergroup.json";
import groupPhoto from "./fixtures/group-photo-with-caption.json";
import groupPinpoint from "./fixtures/group-pinpoint-message.json";
import groupScore from "./fixtures/group-score-message.json";
import otherGroupMessage from "./fixtures/other-group-message.json";
import privateMessage from "./fixtures/private-message.json";
import supergroupMigrated from "./fixtures/supergroup-migrated-from-group.json";
import { allLogOutput, logged, mockTelegramResponses, savedPlayers, savedScores, send, telegramCalls } from "./helpers";

const OUR_GROUP = -5465433776;

const AINO = groupScore.message.from;

/** The fixture score message, with changes. */
function scoreMessage(changes: Record<string, unknown>) {
  return { ...groupScore, message: { ...groupScore.message, entities: [], ...changes } };
}

const reactions = () => telegramCalls().filter(({ method }) => method === "setMessageReaction");
const replies = () => telegramCalls().filter(({ method }) => method === "sendMessage");

describe("messages from our group", () => {
  it("logs sender, date, text, parsed scores and the raw update", async () => {
    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(logged("log")).toContainEqual({
      event: "group_message",
      update_id: 701234501,
      message_id: 901042,
      date: "2026-10-09T05:12:33.000Z",
      from_id: 1234567891,
      from_name: "Aino Virtanen",
      from_username: "ainov",
      text: groupScore.message.text,
      scores: [{ game: "patches", puzzleNumber: 206, timeSeconds: 29, noHints: true, noRedraws: true }],
      shameful_games: [],
      raw: JSON.stringify(groupScore),
    });
  });

  it("logs the bot being added to our group in full", async () => {
    await send(botAddedToOurGroup);

    expect(logged("log")).toEqual([
      expect.objectContaining({
        event: "bot_membership_changed",
        allowed_chat: true,
        old_status: "left",
        new_status: "member",
        raw: JSON.stringify(botAddedToOurGroup),
      }),
    ]);
    expect(telegramCalls()).toEqual([]);
  });
});

describe("saving scores", () => {
  it("saves the score and the player, then reacts with a thumbs up", async () => {
    await send(groupScore);

    expect(await savedScores()).toEqual([
      {
        telegram_user_id: 1234567891,
        game: "patches",
        puzzle_number: 206,
        time_seconds: 29,
        no_hints: 1,
        no_redraws: 1,
        posted_at: groupScore.message.date,
        chat_id: OUR_GROUP,
        message_id: 901042,
        message_text: groupScore.message.text,
      },
    ]);
    expect(await savedPlayers()).toEqual([
      {
        telegram_user_id: 1234567891,
        username: "ainov",
        first_name: "Aino",
        last_name: "Virtanen",
        first_seen_at: groupScore.message.date,
        updated_at: groupScore.message.date,
      },
    ]);
    expect(telegramCalls()).toEqual([
      {
        method: "setMessageReaction",
        params: { chat_id: OUR_GROUP, message_id: 901042, reaction: [{ type: "emoji", emoji: "👍" }] },
      },
    ]);
    expect(logged("log")).toContainEqual({ event: "scores_saved", update_id: 701234501, from_id: 1234567891, saved: 1, duplicates: 0 });
  });

  it("saves every score in a message", async () => {
    const text = "Queens #892\n1:00 👑\nlnkd.in/queens.\n\nZip #571\n0:37 🏁\nlnkd.in/zip.";
    await send(scoreMessage({ text }));

    expect(await savedScores()).toEqual([
      expect.objectContaining({ game: "queens", puzzle_number: 892, time_seconds: 60, no_hints: 0, message_text: text }),
      expect.objectContaining({ game: "zip", puzzle_number: 571, time_seconds: 37, no_hints: 0, message_text: text }),
    ]);
    expect(reactions()).toHaveLength(1);
  });

  it("reads scores from photo captions", async () => {
    await send(groupPhoto);

    expect(await savedScores()).toEqual([
      expect.objectContaining({
        telegram_user_id: 1234567892,
        game: "queens",
        puzzle_number: 892,
        message_text: groupPhoto.message.caption,
      }),
    ]);
    expect(await savedPlayers()).toEqual([expect.objectContaining({ first_name: "Mikko", last_name: null, username: null })]);
  });

  it("keeps the first result when the same puzzle is posted again", async () => {
    await send(groupScore);
    const repost = groupScore.message.text.replace("0:29", "0:11");
    await send({ ...scoreMessage({ message_id: 901060, date: groupScore.message.date + 600, text: repost }), update_id: 701234560 });

    expect(await savedScores()).toEqual([expect.objectContaining({ time_seconds: 29, message_id: 901042 })]);
    expect(logged("log")).toContainEqual(expect.objectContaining({ event: "scores_saved", saved: 0, duplicates: 1 }));
    // Still acknowledged: it's on record.
    expect(reactions()).toHaveLength(2);
  });

  it("doesn't duplicate anything when Telegram redelivers an update", async () => {
    await send(groupScore);
    await send(groupScore);

    expect(await savedScores()).toHaveLength(1);
    expect(await savedPlayers()).toHaveLength(1);
  });

  it("refreshes the player's names from newer messages only", async () => {
    const later = groupScore.message.date + 86_400;
    await send(groupScore);
    await send(
      scoreMessage({
        message_id: 901070,
        date: later,
        from: { ...AINO, username: "aino_v", last_name: "Korhonen" },
        text: "Zip #572\n0:30 🏁",
      }),
    );
    // A late redelivery of the first message must not bring the old names back.
    await send(groupScore);

    expect(await savedPlayers()).toEqual([
      {
        telegram_user_id: 1234567891,
        username: "aino_v",
        first_name: "Aino",
        last_name: "Korhonen",
        first_seen_at: groupScore.message.date,
        updated_at: later,
      },
    ]);
  });

  it("ignores ordinary chat", async () => {
    await send(groupChatMessage);

    expect(logged("log")).toEqual([expect.objectContaining({ event: "group_message", scores: [] })]);
    expect(await savedScores()).toEqual([]);
    expect(telegramCalls()).toEqual([]);
  });

  it.each([
    ["forwarded", { forward_origin: { type: "user", date: 1791500000, sender_user: { id: 42, is_bot: false, first_name: "Joku" } } }, "forwarded, would be credited to the wrong person"],
    ["sent by a bot", { from: { id: 8000000002, is_bot: true, first_name: "Some bot" } }, "sent by a bot"],
    ["posted anonymously", { from: undefined, sender_chat: { id: OUR_GROUP, type: "group" } }, "no sender"],
  ])("doesn't save or react to scores %s", async (_, changes, reason) => {
    await send(scoreMessage(changes));

    expect(await savedScores()).toEqual([]);
    expect(telegramCalls()).toEqual([]);
    expect(logged("log")).toContainEqual({ event: "scores_not_saved", update_id: 701234501, reason });
  });

  it("doesn't react when saving fails, and logs why", async () => {
    await env.DB.exec("DROP TABLE scores");

    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(telegramCalls()).toEqual([]);
    expect(logged("error")).toEqual([
      expect.objectContaining({ event: "db_error", error: expect.stringContaining("no such table: scores") }),
    ]);
  });

  it("logs a rejected reaction, with the score still saved", async () => {
    mockTelegramResponses(
      Response.json({ ok: false, error_code: 400, description: "Bad Request: REACTION_INVALID" }, { status: 400 }),
    );

    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(await savedScores()).toHaveLength(1);
    expect(logged("error")).toEqual([
      {
        event: "telegram_error",
        update_id: 701234501,
        error: "BotApiError: setMessageReaction failed: 400 Bad Request: REACTION_INVALID",
      },
    ]);
  });

  it("logs network failures without failing the request", async () => {
    mockTelegramResponses(new TypeError("Network connection lost"));

    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(logged("error")).toEqual([
      expect.objectContaining({ event: "telegram_error", error: "TypeError: Network connection lost" }),
    ]);
  });

  it("only logs the reaction when TELEGRAM_BOT_TOKEN is not set", async () => {
    await send(groupScore, {}, { TELEGRAM_BOT_TOKEN: "" });

    expect(await savedScores()).toHaveLength(1);
    expect(telegramCalls()).toEqual([]);
    expect(logged("warn")).toEqual([expect.objectContaining({ event: "telegram_dry_run", method: "setMessageReaction" })]);
  });
});

describe("shaming Pinpoint and Crossclimb", () => {
  it("reacts with a thumbs down and shames the poster", async () => {
    await send(groupPinpoint);

    expect(logged("log")).toEqual([expect.objectContaining({ scores: [], shameful_games: ["pinpoint"] })]);
    expect(telegramCalls()).toEqual([
      {
        method: "setMessageReaction",
        params: { chat_id: OUR_GROUP, message_id: 901045, reaction: [{ type: "emoji", emoji: "👎" }] },
      },
      {
        method: "sendMessage",
        params: {
          chat_id: OUR_GROUP,
          // 901045 % 3 picks the "think about what you've done" line.
          text: "Pinpoint? In this group? 👎 Mikko, think about what you've done.",
          reply_parameters: { message_id: 901045 },
          link_preview_options: { is_disabled: true },
        },
      },
    ]);
    expect(await savedScores()).toEqual([]);
  });

  it.each([
    [901044, "🔔 Shame! 🔔 Aino posted a Crossclimb result. We don't do that here."],
    [901045, "Crossclimb? In this group? 👎 Aino, think about what you've done."],
    [901046, "🚨 Crossclimb detected. Aino, this is a Queens, Tango, Zip, Mini Sudoku, Patches and Wend household."],
  ])("varies the shame by message (%i)", async (messageId, expected) => {
    await send(scoreMessage({ message_id: messageId, text: "Crossclimb #377 | 1:23 🪜\nlnkd.in/crossclimb." }));

    expect(replies()[0]?.params).toMatchObject({ text: expected });
  });

  it("shames both games at once", async () => {
    const text = "Pinpoint #512 | 2 guesses\nlnkd.in/pinpoint.\n\nCrossclimb #377 | 1:23\nlnkd.in/crossclimb.";
    await send(scoreMessage({ message_id: 901044, text }));

    expect(replies()[0]?.params).toMatchObject({
      text: "🔔 Shame! 🔔 Aino posted a Pinpoint and Crossclimb result. We don't do that here.",
    });
  });

  it("still saves a real score posted alongside, but the thumbs down wins", async () => {
    const text = `${groupPinpoint.message.text}\n\nQueens #892\n1:00 👑\nlnkd.in/queens.`;
    await send({ ...groupPinpoint, message: { ...groupPinpoint.message, text, entities: [] } });

    expect(await savedScores()).toEqual([expect.objectContaining({ game: "queens", puzzle_number: 892 })]);
    expect(reactions()).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ reaction: [{ type: "emoji", emoji: "👎" }] }) }),
    ]);
    expect(replies()).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ text: "Pinpoint? In this group? 👎 Mikko, think about what you've done." }),
      }),
    ]);
  });

  it("doesn't shame a mere mention", async () => {
    await send(scoreMessage({ text: "Pinpoint #512 oli helppo, en kyllä postaa" }));

    expect(telegramCalls()).toEqual([]);
  });

  it("doesn't shame in other chats", async () => {
    await send({ ...groupPinpoint, message: { ...groupPinpoint.message, chat: otherGroupMessage.message.chat } });

    expect(telegramCalls()).toEqual([]);
  });
});

describe("chat allowlist", () => {
  it.each([
    ["a private chat", privateMessage, "private"],
    ["another group", otherGroupMessage, "group"],
  ])("ignores messages from %s without logging their content", async (_, update, chatType) => {
    const response = await send(update);

    expect(response.status).toBe(200);
    expect(logged("log")).toEqual([
      {
        event: "ignored_update",
        update_id: update.update_id,
        reason: "chat not allowlisted",
        kind: "message",
        chat_id: update.message.chat.id,
        chat_type: chatType,
      },
    ]);
    expect(allLogOutput()).not.toContain(update.message.text);
    // The other group's message is a valid score; it must still not be saved or acknowledged.
    expect(await savedScores()).toEqual([]);
    expect(telegramCalls()).toEqual([]);
  });

  it("ignores the bot being added to another group, but records who did it", async () => {
    const response = await send(botAddedToOtherGroup);

    expect(response.status).toBe(200);
    const [entry] = logged("log");
    expect(entry).toMatchObject({
      event: "bot_membership_changed",
      allowed_chat: false,
      chat_id: -4987654321,
      chat_type: "group",
      from_id: 7766554433,
      from_username: "stranger_danger",
      old_status: "left",
      new_status: "member",
    });
    expect(entry).not.toHaveProperty("raw");
    // Deliberately no leaveChat.
    expect(telegramCalls()).toEqual([]);
  });

  it("ignores everything and logs an error when ALLOWED_CHAT_ID is not configured", async () => {
    const response = await send(groupScore, {}, { ALLOWED_CHAT_ID: "" });

    expect(response.status).toBe(200);
    expect(logged("log")).toEqual([]);
    expect(logged("error")).toEqual([expect.objectContaining({ event: "config_error" })]);
    expect(allLogOutput()).not.toContain(groupScore.message.text);
    expect(telegramCalls()).toEqual([]);
  });

  it("ignores update types it doesn't handle", async () => {
    await send({ update_id: 701234599, edited_message: groupScore.message });

    expect(logged("log")).toEqual([
      expect.objectContaining({ event: "ignored_update", reason: "unsupported update type", fields: ["update_id", "edited_message"] }),
    ]);
    expect(allLogOutput()).not.toContain(groupScore.message.text);
    expect(telegramCalls()).toEqual([]);
  });
});

describe("supergroup migration", () => {
  const expectedWarning = {
    event: "chat_migrated",
    message: expect.stringContaining('Set ALLOWED_CHAT_ID to "-1003141592653"'),
    old_chat_id: "-5465433776",
    new_chat_id: "-1003141592653",
  };

  it("warns when our group says it moved to a supergroup", async () => {
    const response = await send(groupMigrated);

    expect(response.status).toBe(200);
    expect(logged("warn")).toEqual([expect.objectContaining(expectedWarning)]);
    expect(telegramCalls()).toEqual([]);
  });

  it("warns when the new supergroup says it came from our group", async () => {
    const response = await send(supergroupMigrated);

    expect(response.status).toBe(200);
    expect(logged("warn")).toEqual([expect.objectContaining(expectedWarning)]);
    // The new chat isn't allowlisted yet, so the message itself is still ignored.
    expect(logged("log")).toEqual([expect.objectContaining({ event: "ignored_update", chat_id: -1003141592653 })]);
  });
});
