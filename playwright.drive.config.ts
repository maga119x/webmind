import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results-drive",
  testMatch: /(cloud|sync)\.spec\.ts/,
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx tests/e2e-drive-server.ts",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
