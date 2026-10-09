// Minimal Telegram Bot API client: plain fetch, no library.
// Reference: https://core.telegram.org/bots/api#making-requests

const REQUEST_TIMEOUT_MS = 10_000;

export class BotApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | undefined,
    description: string,
  ) {
    super(`${method} failed: ${errorCode ?? "?"} ${description}`);
    this.name = "BotApiError";
  }
}

export interface BotApi {
  setMessageReaction(chatId: number, messageId: number, emoji: string): Promise<void>;
  replyTo(chatId: number, messageId: number, text: string): Promise<void>;
}

/**
 * Without a token every call is only logged. That keeps `wrangler dev` and the
 * smoke test from posting into the real group.
 */
export function createBotApi(token: string | undefined): BotApi {
  const call = token ? (method: string, params: object) => callBotApi(token, method, params) : logDryRun;
  return {
    async setMessageReaction(chatId, messageId, emoji) {
      await call("setMessageReaction", {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
      });
    },
    async replyTo(chatId, messageId, text) {
      // Without allow_sending_without_reply, Telegram refuses (rather than posts
      // a loose message) if the original message is gone.
      await call("sendMessage", {
        chat_id: chatId,
        text,
        reply_parameters: { message_id: messageId },
        link_preview_options: { is_disabled: true },
      });
    },
  };
}

async function callBotApi(token: string, method: string, params: object): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json<{ ok: boolean; error_code?: number; description?: string }>().catch(() => null);
  if (!body?.ok) {
    throw new BotApiError(method, body?.error_code ?? response.status, body?.description ?? response.statusText);
  }
}

async function logDryRun(method: string, params: object): Promise<void> {
  console.warn({ event: "telegram_dry_run", message: "TELEGRAM_BOT_TOKEN is not set; not calling Telegram", method, params });
}
