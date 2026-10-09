import { afterEach, beforeEach, expect, vi } from "vitest";

beforeEach(() => {
  // Silence and record everything the Worker logs. The test runner's console
  // ignores spyOn/assignment, so swap the whole global for one with mocks.
  vi.stubGlobal(
    "console",
    Object.assign(Object.create(console), { log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  );
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  // The Worker only listens: it must never call Telegram (or anything else).
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
