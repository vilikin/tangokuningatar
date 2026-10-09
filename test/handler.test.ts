import { describe, expect, it } from "vitest";
import botAddedToOtherGroup from "./fixtures/bot-added-to-other-group.json";
import botAddedToOurGroup from "./fixtures/bot-added-to-our-group.json";
import groupMigrated from "./fixtures/group-migrated-to-supergroup.json";
import groupPhoto from "./fixtures/group-photo-with-caption.json";
import groupMessage from "./fixtures/group-text-message.json";
import otherGroupMessage from "./fixtures/other-group-message.json";
import privateMessage from "./fixtures/private-message.json";
import supergroupMigrated from "./fixtures/supergroup-migrated-from-group.json";
import { allLogOutput, logged, send } from "./helpers";

describe("messages from our group", () => {
  it("logs sender, date, text and the raw update", async () => {
    const response = await send(groupMessage);

    expect(response.status).toBe(200);
    expect(logged("log")).toEqual([
      {
        event: "group_message",
        update_id: 701234501,
        message_id: 1042,
        date: "2026-10-09T05:12:33.000Z",
        from_id: 1234567891,
        from_name: "Aino Virtanen",
        from_username: "ainov",
        text: groupMessage.message.text,
        raw: JSON.stringify(groupMessage),
      },
    ]);
  });

  it("logs the caption when the message has no text", async () => {
    await send(groupPhoto);

    expect(logged("log")).toEqual([
      expect.objectContaining({
        event: "group_message",
        from_name: "Mikko",
        from_username: null,
        text: groupPhoto.message.caption,
      }),
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
    // No leaveChat: the afterEach hook asserts that nothing was fetched.
  });

  it("ignores everything and logs an error when ALLOWED_CHAT_ID is not configured", async () => {
    const response = await send(groupMessage, {}, { ALLOWED_CHAT_ID: "" });

    expect(response.status).toBe(200);
    expect(logged("log")).toEqual([]);
    expect(logged("error")).toEqual([expect.objectContaining({ event: "config_error" })]);
    expect(allLogOutput()).not.toContain(groupMessage.message.text);
  });

  it("ignores update types it doesn't handle", async () => {
    await send({ update_id: 701234599, edited_message: groupMessage.message });

    expect(logged("log")).toEqual([
      expect.objectContaining({ event: "ignored_update", reason: "unsupported update type", fields: ["update_id", "edited_message"] }),
    ]);
    expect(allLogOutput()).not.toContain(groupMessage.message.text);
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
  });

  it("warns when the new supergroup says it came from our group", async () => {
    const response = await send(supergroupMigrated);

    expect(response.status).toBe(200);
    expect(logged("warn")).toEqual([expect.objectContaining(expectedWarning)]);
    // The new chat isn't allowlisted yet, so the message itself is still ignored.
    expect(logged("log")).toEqual([expect.objectContaining({ event: "ignored_update", chat_id: -1003141592653 })]);
  });
});
