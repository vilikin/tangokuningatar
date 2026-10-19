import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../src/index";

export const WEBHOOK_PATH = "/telegram/webhook";
export const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
export const TEST_SECRET = "test-webhook-secret";
const ORIGIN = "https://tangokuningatar.example.workers.dev";

interface RequestOptions {
  method?: string;
  path?: string;
  /** Value of the secret header; `null` leaves the header out. */
  secret?: string | null;
  /** Raw request body; defaults to the JSON-encoded update. */
  body?: string;
}

/**
 * Sends a request to the Worker, as Telegram would by default, and waits for
 * the background work (ctx.waitUntil) to finish too.
 */
export async function send(update: unknown, options: RequestOptions = {}, envOverrides: Partial<Env> = {}): Promise<Response> {
  const { method = "POST", path = WEBHOOK_PATH, secret = TEST_SECRET, body = JSON.stringify(update) } = options;
  const headers = new Headers({ "Content-Type": "application/json" });
  if (secret !== null) {
    headers.set(SECRET_HEADER, secret);
  }
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
  const ctx = createExecutionContext();
  // Real incoming requests carry Cloudflare's `cf` metadata; the Worker doesn't read it.
  const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], { ...env, ...envOverrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

type ConsoleMethod = "log" | "warn" | "error";

/** Objects passed to console.<method>, in call order. */
export function logged(method: ConsoleMethod): Record<string, unknown>[] {
  return vi.mocked(console[method]).mock.calls.map(([entry]) => entry as Record<string, unknown>);
}

/** Every console call serialized into one string, for "this never appears anywhere" checks. */
export function allLogOutput(): string {
  return JSON.stringify((["log", "warn", "error"] as const).map((method) => vi.mocked(console[method]).mock.calls));
}

/** Bot API calls the Worker made, as { method, params }, in call order. */
export function telegramCalls(): { method: string; params: unknown }[] {
  return vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({
    method: String(input).split("/").pop()!,
    params: JSON.parse(String(init?.body)),
  }));
}

/** Makes the next Bot API calls answer with these responses (or throw these errors), in order. */
export function mockTelegramResponses(...responses: (Response | Error)[]): void {
  const mock = vi.mocked(globalThis.fetch);
  for (const response of responses) {
    mock.mockImplementationOnce(async () => {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    });
  }
}

/** All rows in the scores table, oldest first, without the autoincrement ID. */
export async function savedScores(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM scores ORDER BY id").all();
  return results.map(({ id: _, ...row }) => row);
}

export async function savedPlayers(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM players ORDER BY telegram_user_id").all();
  return results;
}

export const TEST_BOT_TOKEN = "test-bot-token";

/** Mini App initData signed the way Telegram signs it, with `token` (the test bot token by default). */
export async function signInitData(fields: Record<string, string>, token = TEST_BOT_TOKEN): Promise<string> {
  const encoder = new TextEncoder();
  const hmac = async (key: BufferSource, data: string) =>
    crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      encoder.encode(data),
    );
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const hash = await hmac(await hmac(encoder.encode("WebAppData"), token), dataCheckString);
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ ...fields, hash: hex }).toString();
}

/** A GET to the Worker, e.g. the Mini App page or its API. */
export async function get(path: string, headers: HeadersInit = {}, envOverrides: Partial<Env> = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, { headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], { ...env, ...envOverrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
