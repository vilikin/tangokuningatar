import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TEST_BINDINGS = {
  WEBHOOK_SECRET: "test-webhook-secret",
  // Fake token; tests mock fetch, so nothing reaches Telegram.
  TELEGRAM_BOT_TOKEN: "test-bot-token",
};

// Only silences wrangler's "missing required secrets" warning when there's no
// .dev.vars (e.g. in CI). The bindings below are what the tests actually see.
for (const [name, value] of Object.entries(TEST_BINDINGS)) {
  process.env[name] ??= value;
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Fixed values so tests never depend on a developer's .dev.vars.
      miniflare: { bindings: TEST_BINDINGS },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
