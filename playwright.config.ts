import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173";
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests",
  // Las pruebas comparten la cuenta demo del backend: se ejecutan de a una.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  webServer: [
    {
      // Backend Flask en modo demostración y con una base SQLite temporal.
      command: "python -m flask --app wsgi run -p 8000",
      cwd: "backend",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        DEMO_MODE: "1",
        JWT_SECRET: "clave-solo-para-pruebas-e2e-0123456789",
        DATA_DIR: join(tmpdir(), "consigna-e2e"),
        SYNC_INTERVAL_HOURS: "0",
        ALERT_INTERVAL_MINUTES: "0",
      },
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

