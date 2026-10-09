// Manage the bot's Telegram webhook.
//
//   node scripts/telegram.ts set-webhook <worker-url>   (run by the deploy job in CI)
//   node scripts/telegram.ts webhook-info
//   node scripts/telegram.ts delete-webhook
//
// Reads TELEGRAM_BOT_TOKEN (all commands) and WEBHOOK_SECRET (set-webhook) from
// the environment. Never prints either of them.

const WEBHOOK_PATH = "/telegram/webhook";
const ALLOWED_UPDATES = ["message", "my_chat_member"];

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
}

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_synchronization_error_date?: number;
  [key: string]: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function callTelegram(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await response.json()) as TelegramResponse;
  if (!body.ok) {
    throw new Error(`${method} failed: ${body.error_code ?? response.status} ${body.description ?? ""}`.trim());
  }
  return body.result;
}

async function printWebhookInfo(): Promise<void> {
  const info = (await callTelegram("getWebhookInfo")) as WebhookInfo;
  const formatted: Record<string, unknown> = { ...info };
  for (const key of ["last_error_date", "last_synchronization_error_date"] as const) {
    if (info[key]) {
      formatted[key] = new Date(info[key] * 1000).toISOString();
    }
  }
  console.log(JSON.stringify(formatted, null, 2));
}

async function setWebhook(workerUrl: string | undefined): Promise<void> {
  if (!workerUrl) {
    throw new Error("Usage: set-webhook <worker-url>, e.g. https://tangokuningatar.example.workers.dev");
  }
  const url = new URL(WEBHOOK_PATH, workerUrl);
  if (url.protocol !== "https:") {
    throw new Error(`Telegram requires an https:// webhook URL, got ${url.href}`);
  }
  // drop_pending_updates is deliberately left out (it defaults to false):
  // queued updates may contain scores we want to keep.
  await callTelegram("setWebhook", {
    url: url.href,
    secret_token: requireEnv("WEBHOOK_SECRET"),
    allowed_updates: ALLOWED_UPDATES,
  });
  console.log(`Webhook set to ${url.href}`);
  await printWebhookInfo();
}

async function deleteWebhook(): Promise<void> {
  await callTelegram("deleteWebhook", { drop_pending_updates: false });
  console.log("Webhook deleted. Pending updates were kept (Telegram holds them for up to 24 hours).");
}

const [command, ...args] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  "set-webhook": () => setWebhook(args[0]),
  "webhook-info": printWebhookInfo,
  "delete-webhook": deleteWebhook,
};

const run = command ? commands[command] : undefined;
if (!run) {
  console.error(`Usage: node scripts/telegram.ts <${Object.keys(commands).join(" | ")}> [args]`);
  process.exit(1);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
