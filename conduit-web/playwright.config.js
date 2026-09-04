import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1"
  ? true
  : process.env.PLAYWRIGHT_REUSE_SERVER === "0"
    ? false
    : !process.env.CI;

// Setpieces are the motion, geometry, streaming-cadence and virtualization
// tests. They measure timing, so CPU contention makes them lie: they run
// serialized, in their own pass, and never as part of the default run.
const setpieces = process.env.CONDUIT_SETPIECES === "1";
const SETPIECE = /@setpiece/;
const scope = setpieces ? { grep: SETPIECE } : { grepInvert: SETPIECE };

export default defineConfig({
  testDir: "./test/browser",
  // Setpieces render heavy math transcripts back to back; the deadline is the
  // harness's patience, not a measurement, and their own budget assertions are
  // unchanged by it.
  timeout: setpieces ? 120_000 : 45_000,
  fullyParallel: !setpieces,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Each worker is a Chromium; the default (half the cores) over-subscribes
  // memory on a dev box and turns real passes into timeouts.
  workers: setpieces ? 1 : 2,
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
    { name: "desktop-chromium", ...scope, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", ...scope, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer,
  },
});
