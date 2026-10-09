import { describe, expect, it } from "vitest";
import groupMessage from "./fixtures/group-score-message.json";
import { allLogOutput, logged, send, telegramCalls } from "./helpers";

describe("routing", () => {
  it.each(["/", "/telegram", "/telegram/webhook/", "/webhook"])("returns 404 for %s", async (path) => {
    const response = await send(groupMessage, { path });
    expect(response.status).toBe(404);
  });

  it.each(["GET", "PUT", "DELETE"])("returns 405 for %s on the webhook path", async (method) => {
    const response = await send(groupMessage, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe("secret token check", () => {
  it("accepts the correct secret", async () => {
    const response = await send(groupMessage);
    expect(response.status).toBe(200);
    expect(logged("log")).toHaveLength(1);
  });

  it.each([
    ["is missing", null],
    ["is empty", ""],
    ["is wrong", "not-the-secret"],
    ["is a prefix of the secret", "test-webhook"],
    ["has extra characters", "test-webhook-secret-and-more"],
    ["differs in case", "TEST-WEBHOOK-SECRET"],
  ])("returns 401 and does nothing when the secret %s", async (_, secret) => {
    const response = await send(groupMessage, { secret });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(allLogOutput()).not.toContain(groupMessage.message.text);
    expect(logged("log")).toEqual([]);
    expect(telegramCalls()).toEqual([]);
  });

  it("rejects everything when WEBHOOK_SECRET is not configured", async () => {
    const response = await send(groupMessage, { secret: "" }, { WEBHOOK_SECRET: "" });
    expect(response.status).toBe(401);
    expect(logged("log")).toEqual([]);
    expect(logged("error")).toEqual([expect.objectContaining({ event: "config_error" })]);
    expect(telegramCalls()).toEqual([]);
  });
});

describe("error handling", () => {
  it("returns 200 and logs the error when the body is not JSON", async () => {
    const response = await send(undefined, { body: "{not json" });
    expect(response.status).toBe(200);
    expect(logged("error")).toEqual([expect.objectContaining({ event: "processing_error" })]);
  });

  it("returns 200 and logs the error when processing throws", async () => {
    // `null` parses fine but blows up in the handler.
    const response = await send(null);
    expect(response.status).toBe(200);
    expect(logged("error")).toEqual([
      expect.objectContaining({ event: "processing_error", error: expect.stringContaining("TypeError") }),
    ]);
  });
});
