import { defineConfig } from "vitest/config";

/**
 * Default vitest config — unit tests only.
 * Integration tests live in tests/integration/ and are run separately via
 * `pnpm test:integration` (uses vitest.integration.config.ts).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "tests/integration/**", "node_modules/**"],
    environment: "node",
  },
});
