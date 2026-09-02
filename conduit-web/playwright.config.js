import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1"
  ? true
  : process.env.PLAYWRIGHT_REUSE_SERVER === "0"
    ? false
    : !process.env.CI;

export default defineConfig({
  testDir: "./test/browser",
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      // Opt-in for the drag/frame benchmarks. Without it rAF is pinned to the
      // 60Hz compositor, so every stall reads as a flat 33.3ms and per-frame
      // work below one vsync is invisible -- useless for a 144Hz target.
      ...(process.env.CONDUIT_UNTHROTTLE_FRAMES === "1"
        ? { args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"] }
        : {}),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer,
  },
});
