import { describe, expect, it } from "vitest";
import botAddedToOtherGroup from "./fixtures/bot-added-to-other-group.json";
import botAddedToOurGroup from "./fixtures/bot-added-to-our-group.json";
import groupChatMessage from "./fixtures/group-chat-message.json";
import groupMigrated from "./fixtures/group-migrated-to-supergroup.json";
import groupPhoto from "./fixtures/group-photo-with-caption.json";
import groupScore from "./fixtures/group-score-message.json";
import otherGroupMessage from "./fixtures/other-group-message.json";
import privateMessage from "./fixtures/private-message.json";
import supergroupMigrated from "./fixtures/supergroup-migrated-from-group.json";
import { allLogOutput, logged, mockTelegramResponses, send, telegramCalls } from "./helpers";

const OUR_GROUP = -5465433776;

describe("messages from our group", () => {
  it("logs sender, date, text, parsed scores and the raw update", async () => {
    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(logged("log")).toEqual([
      {
        event: "group_message",
        update_id: 701234501,
        message_id: 901042,
        date: "2026-10-09T05:12:33.000Z",
        from_id: 1234567891,
        from_name: "Aino Virtanen",
        from_username: "ainov",
        text: groupScore.message.text,
        scores: [{ game: "patches", puzzleNumber: 206, timeSeconds: 29, noHints: true, noRedraws: true }],
        raw: JSON.stringify(groupScore),
      },
    ]);
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

describe("acknowledging scores", () => {
  it("reacts to the score and replies with what was parsed", async () => {
    await send(groupScore);

    expect(telegramCalls()).toEqual([
      {
        method: "setMessageReaction",
        params: { chat_id: OUR_GROUP, message_id: 901042, reaction: [{ type: "emoji", emoji: "👍" }] },
      },
      {
        method: "sendMessage",
        params: {
          chat_id: OUR_GROUP,
          text: "Parsed Patches #206\nTime: 0:29 (29 s)\nNo hints: yes\nNo redraws: yes",
          reply_parameters: { message_id: 901042 },
          link_preview_options: { is_disabled: true },
        },
      },
    ]);
    expect(logged("error")).toEqual([]);
  });

  it("reads scores from photo captions", async () => {
    await send(groupPhoto);

    expect(logged("log")).toEqual([
      expect.objectContaining({
        from_name: "Mikko",
        from_username: null,
        text: groupPhoto.message.caption,
        scores: [{ game: "queens", puzzleNumber: 892, timeSeconds: 60, noHints: false, noRedraws: false }],
      }),
    ]);
    expect(telegramCalls().map(({ method }) => method)).toEqual(["setMessageReaction", "sendMessage"]);
  });

  it("lists every score when one message has several", async () => {
    const text = "Queens #892\n1:00 👑\nlnkd.in/queens.\n\nZip #571\n0:37 🏁\nlnkd.in/zip.";
    await send({ ...groupScore, message: { ...groupScore.message, text, entities: [] } });

    const reply = telegramCalls().find(({ method }) => method === "sendMessage");
    expect(reply?.params).toMatchObject({
      text: [
        "Parsed Queens #892\nTime: 1:00 (60 s)\nNo hints: no\nNo redraws: no",
        "Parsed Zip #571\nTime: 0:37 (37 s)\nNo hints: no\nNo redraws: no",
      ].join("\n\n"),
    });
  });

  it("stays quiet about ordinary chat", async () => {
    await send(groupChatMessage);

    expect(logged("log")).toEqual([expect.objectContaining({ event: "group_message", scores: [] })]);
    expect(telegramCalls()).toEqual([]);
  });

  it("still replies when the reaction is rejected, and logs why", async () => {
    mockTelegramResponses(
      Response.json({ ok: false, error_code: 400, description: "Bad Request: REACTION_INVALID" }, { status: 400 }),
    );

    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(telegramCalls().map(({ method }) => method)).toEqual(["setMessageReaction", "sendMessage"]);
    expect(logged("error")).toEqual([
      {
        event: "telegram_error",
        update_id: 701234501,
        error: "BotApiError: setMessageReaction failed: 400 Bad Request: REACTION_INVALID",
      },
    ]);
  });

  it("logs network failures without failing the request", async () => {
    mockTelegramResponses(new TypeError("Network connection lost"), new TypeError("Network connection lost"));

    const response = await send(groupScore);

    expect(response.status).toBe(200);
    expect(logged("error")).toEqual([
      expect.objectContaining({ event: "telegram_error", error: "TypeError: Network connection lost" }),
      expect.objectContaining({ event: "telegram_error", error: "TypeError: Network connection lost" }),
    ]);
  });

  it("only logs what it would send when TELEGRAM_BOT_TOKEN is not set", async () => {
    await send(groupScore, {}, { TELEGRAM_BOT_TOKEN: "" });

    expect(telegramCalls()).toEqual([]);
    expect(logged("warn")).toEqual([
      expect.objectContaining({ event: "telegram_dry_run", method: "setMessageReaction" }),
      expect.objectContaining({ event: "telegram_dry_run", method: "sendMessage" }),
    ]);
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
    // The other group's message is a valid score; it must still get no reaction or reply.
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
