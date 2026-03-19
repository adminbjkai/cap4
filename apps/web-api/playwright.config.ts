import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root (ES module compatible)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../.env') });

/**
 * Playwright E2E test configuration for CAP4 API endpoints.
 *
 * Run with:
 *   pnpm --filter @cap/web-api test:e2e
 *
 * Prerequisites:
 *   - `docker compose up -d` must be running and healthy (postgres + minio + migrate at minimum)
 *   - All env vars in .env must be set (Deepgram + Groq keys in particular)
 *   - Database should be migrated and ready
 *
 * Optional env overrides:
 *   E2E_API_URL  — default http://localhost:3000
 */

export default defineConfig({
  testDir: './tests/e2e',

  // API tests can take time for full pipeline operations
  timeout: 120_000,

  // Run tests sequentially to avoid conflicts with shared resources
  fullyParallel: false,
  workers: 1,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],

  use: {
    // Base URL for API requests
    baseURL: process.env.E2E_API_URL || 'http://localhost:3000',

    // Collect trace on failure
    trace: 'on-first-retry',

    // Extra HTTP headers to be sent with every request
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
  },

  // Configure projects for different test scenarios
  projects: [
    {
      name: 'api-tests',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Boot the API automatically for e2e runs to avoid ECONNREFUSED.
  // Note: external dependencies (DB, S3/MinIO) still must be running.
  webServer: {
    // Use the compiled output to avoid tsx's IPC pipe (can fail under sandboxing).
    command: 'pnpm run build && node --enable-source-maps dist/index.js',
    port: 3000,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
