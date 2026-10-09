import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TEST_WEBHOOK_SECRET = "test-webhook-secret";

// Only silences wrangler's "missing required secrets" warning when there's no
// .dev.vars (e.g. in CI). The binding below is what the tests actually see.
process.env.WEBHOOK_SECRET ??= TEST_WEBHOOK_SECRET;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Fixed secret so tests never depend on a developer's .dev.vars.
      miniflare: { bindings: { WEBHOOK_SECRET: TEST_WEBHOOK_SECRET } },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
