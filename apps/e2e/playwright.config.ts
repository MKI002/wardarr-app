import { defineConfig, devices } from '@playwright/test';

const WARDARR = 'http://127.0.0.1:18484';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: WARDARR, trace: 'off', screenshot: 'off' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node mocks/services.mjs',
      url: 'http://127.0.0.1:19000/__control/state',
      reuseExistingServer: false,
    },
    {
      command: 'node start-wardarr.mjs',
      url: `${WARDARR}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
