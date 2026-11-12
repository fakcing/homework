import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./client/test",
  testMatch: "**/playwright.spec.ts",
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "HOST=127.0.0.1 PORT=3000 LOG_STDOUT=0 npm run dev:server",
      url: "http://127.0.0.1:3000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npx vite --host 127.0.0.1 --port 4173",
      cwd: "client",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
