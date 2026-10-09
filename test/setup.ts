import { applyD1Migrations, type D1Migration, env, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, vi } from "vitest";

beforeEach(async () => {
  // Fresh schema for every test; reset() below wipes all data again.
  await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);

  // Silence and record everything the Worker logs. The test runner's console
  // ignores spyOn/assignment, so swap the whole global for one with mocks.
  vi.stubGlobal(
    "console",
    Object.assign(Object.create(console), { log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  );
  // Every outgoing request gets a successful Bot API response unless a test says otherwise.
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, result: true }));
});

afterEach(() => {
  // The only thing the Worker may ever call is the Bot API, with the configured token.
  for (const [input] of vi.mocked(globalThis.fetch).mock.calls) {
    expect(String(input)).toMatch(/^https:\/\/api\.telegram\.org\/bottest-bot-token\/\w+$/);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterEach(async () => {
  await reset();
});
