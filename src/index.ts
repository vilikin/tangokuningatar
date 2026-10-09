import { isValidSecret } from "./auth";
import { handleUpdate } from "./handler";
import type { Update } from "./telegram";

// Only the default export may live here: workerd treats every export of the
// main module as an entrypoint and refuses to start on anything else.
const WEBHOOK_PATH = "/telegram/webhook";
const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export default {
  async fetch(request, env): Promise<Response> {
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
    try {
      handleUpdate(await request.json<Update>(), env);
    } catch (error) {
      console.error({
        event: "processing_error",
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    }
    return new Response(null, { status: 200 });
  },
} satisfies ExportedHandler<Env>;
