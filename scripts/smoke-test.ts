// Starts the Worker with `wrangler dev` and checks it answers real HTTP requests.
// Catches problems unit tests can't, such as the runtime refusing to load the module.
//
//   node scripts/smoke-test.ts

import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const PORT = 8788;
const SECRET = "smoke-test-secret";
const WEBHOOK_URL = `http://localhost:${PORT}/telegram/webhook`;
const STARTUP_TIMEOUT_MS = 30_000;

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], { stdio: "inherit" });

// --var beats .dev.vars. The empty token puts the Worker in dry-run mode, so the
// fixture's score can't be answered in the real group whatever .dev.vars holds.
const wrangler = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    String(PORT),
    "--show-interactive-dev-session=false",
    "--var",
    `WEBHOOK_SECRET:${SECRET}`,
    "--var",
    "TELEGRAM_BOT_TOKEN:",
  ],
  {
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  },
);
let exited = false;
wrangler.on("exit", () => (exited = true));

function post(secret: string, body: string): Promise<Response> {
  return fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body,
  });
}

async function waitForWorker(): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && !exited) {
    try {
      await fetch(WEBHOOK_URL, { method: "GET" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Worker did not start (see wrangler output above)");
}

function expectStatus(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected HTTP ${expected}, got ${actual}`);
  }
  console.log(`✔ ${name}: ${actual}`);
}

try {
  await waitForWorker();
  const update = await readFile(new URL("../test/fixtures/group-score-message.json", import.meta.url), "utf8");
  expectStatus("valid secret", (await post(SECRET, update)).status, 200);
  expectStatus("wrong secret", (await post("wrong", update)).status, 401);
  expectStatus("GET", (await fetch(WEBHOOK_URL)).status, 405);
} catch (error) {
  console.error(`✘ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  // Kill npx and the wrangler/workerd processes it started.
  if (wrangler.pid && !exited) {
    process.kill(-wrangler.pid, "SIGTERM");
  }
}
