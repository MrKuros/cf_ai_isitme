import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't boot the Cloudflare/agents plugins.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] }
});
