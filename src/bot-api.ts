// Minimal Telegram Bot API client: plain fetch, no library.
// Reference: https://core.telegram.org/bots/api#making-requests

import type { ChatMember } from "./telegram";

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
  sendMessage(chatId: number, text: string): Promise<void>;
  /** Whether the user is in the chat right now. */
  isChatMember(chatId: number, userId: number): Promise<boolean>;
  /** Posts a GIF (Telegram file_id or URL) with an HTML caption, or just the caption when there's no GIF. */
  sendShame(chatId: number, gif: string | undefined, htmlCaption: string): Promise<void>;
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
    async sendMessage(chatId, text) {
      await call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
    },
    async isChatMember(chatId, userId) {
      // In dry-run mode there's no answer, so everyone counts as a member and the
      // whole daily shame run can be seen in the logs.
      const member = (await call("getChatMember", { chat_id: chatId, user_id: userId })) as ChatMember | undefined;
      if (!member) {
        return true;
      }
      return (
        member.status === "creator" ||
        member.status === "administrator" ||
        member.status === "member" ||
        (member.status === "restricted" && member.is_member === true)
      );
    },
    async sendShame(chatId, gif, htmlCaption) {
      if (gif) {
        await call("sendAnimation", { chat_id: chatId, animation: gif, caption: htmlCaption, parse_mode: "HTML" });
      } else {
        await call("sendMessage", {
          chat_id: chatId,
          text: htmlCaption,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      }
    },
  };
}

async function callBotApi(token: string, method: string, params: object): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response
    .json<{ ok: boolean; result?: unknown; error_code?: number; description?: string }>()
    .catch(() => null);
  if (!body?.ok) {
    throw new BotApiError(method, body?.error_code ?? response.status, body?.description ?? response.statusText);
  }
  return body.result;
}

async function logDryRun(method: string, params: object): Promise<undefined> {
  console.warn({ event: "telegram_dry_run", message: "TELEGRAM_BOT_TOKEN is not set; not calling Telegram", method, params });
}
