import { isValidSecret } from "./auth";
import { createBotApi } from "./bot-api";
import { handleUpdate } from "./handler";
import type { Update } from "./telegram";

// Only the default export may live here: workerd treats every export of the
// main module as an entrypoint and refuses to start on anything else.
const WEBHOOK_PATH = "/telegram/webhook";
const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (new URL(request.url).pathname !== WEBHOOK_PATH) {
      return new Response(null, { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    if (!(await isValidSecret(request.headers.get(SECRET_HEADER), env.WEBHOOK_SECRET))) {
      if (!env.WEBHOOK_SECRET) {
        console.error({ event: "config_error", message: "WEBHOOK_SECRET is not set; rejecting all requests" });
      }
      return new Response(null, { status: 401 });
    }

    // From here on the request is authentic, so always answer 2xx: any other
    // status makes Telegram redeliver the same update over and over.
    let update: Update;
    try {
      update = await request.json<Update>();
    } catch (error) {
      logProcessingError(error);
      return new Response(null, { status: 200 });
    }

    // Answer Telegram right away and finish (including calls back to Telegram)
    // in the background, so a slow Bot API call can't trigger a redelivery.
    ctx.waitUntil(handleUpdate(update, env, createBotApi(env.TELEGRAM_BOT_TOKEN)).catch(logProcessingError));
    return new Response(null, { status: 200 });
  },
} satisfies ExportedHandler<Env>;

function logProcessingError(error: unknown): void {
  console.error({
    event: "processing_error",
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
