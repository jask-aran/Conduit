import { expect, test } from "@playwright/test";
import { createCadence } from "../helpers/streaming-scenario.js";
import { runBrowserStreamingScenario } from "./helpers/streaming-performance.js";

test("a deterministic stream reports browser delivery and visible rendering cadence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Performance baseline uses one controlled desktop browser.");

  const name = process.env.HARNESS_SCENARIO || "browser-steady-text";
  const text = process.env.HARNESS_TEXT || "One two three";
  const seed = Number(process.env.HARNESS_SEED || 1);
  const cadence = process.env.HARNESS_PROFILE
    ? createCadence(process.env.HARNESS_PROFILE, {
      text,
      seed,
      chunkSize: Number(process.env.HARNESS_CHUNK_SIZE || 3),
      intervalMs: Number(process.env.HARNESS_INTERVAL_MS || 16),
      burstSize: Number(process.env.HARNESS_BURST_SIZE || 8),
      burstIntervalMs: Number(process.env.HARNESS_BURST_INTERVAL_MS || 128),
      minDelayMs: Number(process.env.HARNESS_MIN_DELAY_MS || 5),
      maxDelayMs: Number(process.env.HARNESS_MAX_DELAY_MS || 80),
    })
    : { delaysMs: [0, 20, 20], deltas: ["One", " two", " three"] };
  const report = await runBrowserStreamingScenario(page, {
    name,
    cadence,
    seed,
  });
  await testInfo.attach("harness-report", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });

  expect(report.schemaVersion).toBe(1);
  expect(report.scenario).toBe(name);
  expect(report.mode).toBe("deterministic-browser");
  expect(report.target).toBe("playwright-production-client");
  expect(report.browser.finalText).toBe(text);
  expect(report.outcome).toBe("passed");
  expect(report.browser.webSocketDeltaCount).toBe(cadence.deltas.length);
  expect(report.browser.visibleIncrementCount).toBeGreaterThan(0);
  expect(report.browser.domMutationCount).toBeGreaterThan(0);
  expect(report.browser.frameGapMs.count).toBeGreaterThan(0);
  expect(report.browser.firstVisibleMs).toBeGreaterThanOrEqual(0);
  expect(report.errors).toEqual([]);
});
