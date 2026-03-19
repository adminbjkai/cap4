import { defineConfig } from "vitest/config";

/**
 * Vitest config for integration tests.
 *
 * Run with:
 *   pnpm --filter @cap/web-api test:integration
 *
 * Prerequisites:
 *   - `docker compose up -d` must be running and healthy
 *   - All env vars in .env must be set (Deepgram + Groq keys in particular)
 *   - ffmpeg must be installed on the host (for test fixture generation)
 *
 * Optional env overrides:
 *   INTEGRATION_API_URL  — default http://localhost:3000
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    environment: "node",

    // Full pipeline (media encode + Deepgram + Groq) can take 60-120s for a
    // short video. 3 minutes gives a comfortable margin.
    testTimeout: 180_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,

    // Run integration test files sequentially — they share Docker services and
    // need a predictable execution order.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },

    reporters: ["verbose"],
  },
});
