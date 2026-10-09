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
