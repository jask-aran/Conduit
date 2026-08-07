import { expect, test } from "@playwright/test";
import { createCadence } from "../helpers/streaming-scenario.js";
import {
  hashRedactedText,
  runBrowserReconnectScenario,
  runBrowserStreamingScenario,
} from "./helpers/streaming-performance.js";
import { getBrowserFixture } from "./helpers/streaming-fixtures.js";

function jsonEnv(name) {
  const value = process.env[name];
  if (!value) return null;
  try { return JSON.parse(value); } catch (error) { throw new Error(`${name} must contain valid JSON: ${error.message}`); }
}

function withoutDigests(value) {
  if (Array.isArray(value)) return value.map(withoutDigests);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "digest")
    .map(([key, entry]) => [key, withoutDigests(entry)]));
}

test("a deterministic stream reports browser delivery and visible rendering cadence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Performance baseline uses one controlled desktop browser.");
  test.skip(process.env.HARNESS_FLOW === "reconnect", "Reconnect CLI selected the recovery contract.");

  const name = process.env.HARNESS_SCENARIO || "browser-steady-text";
  const fixture = process.env.HARNESS_FIXTURE ? getBrowserFixture(process.env.HARNESS_FIXTURE) : null;
  const text = process.env.HARNESS_TEXT || fixture?.text || "One two three";
  const expectedSemanticText = process.env.HARNESS_EXPECTED_SEMANTIC_TEXT === undefined
    ? (fixture ? fixture.expectedSemanticText : text)
    : process.env.HARNESS_EXPECTED_SEMANTIC_TEXT;
  const expectedSemanticFingerprint = jsonEnv("HARNESS_EXPECTED_SEMANTIC_FINGERPRINT") ?? fixture?.expectedSemanticFingerprint ?? null;
  const renderer = process.env.HARNESS_RENDERER || "marked";
  const typewriter = process.env.HARNESS_TYPEWRITER === "1";
  const selectedRenderer = typewriter && renderer === "incremark" ? "incremark-typewriter" : renderer;
  const rendererContract = fixture?.rendererContracts?.[selectedRenderer] || {};
  const expectedAssertions = jsonEnv("HARNESS_EXPECTED_ASSERTIONS") ?? rendererContract.expectedAssertions ?? fixture?.expectedAssertions ?? {};
  const expectedInteractions = jsonEnv("HARNESS_EXPECTED_INTERACTIONS") ?? fixture?.expectedInteractions ?? {};
  const streamingAssertion = jsonEnv("HARNESS_EXPECTED_STREAMING") ?? rendererContract.streamingAssertion ?? fixture?.streamingAssertion ?? null;
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
  const scenario = {
    name,
    profile: process.env.HARNESS_PROFILE || "fixed",
    cadence,
    prompt: fixture?.prompt || null,
    expectedSemanticText,
    expectedSemanticFingerprint,
    expectedAssertions,
    expectedInteractions,
    maxKaTeXCalls: fixture?.maxKaTeXCalls ?? null,
    maxLayoutShiftCount: fixture?.maxLayoutShiftCount ?? null,
    maxLayoutShiftValue: rendererContract.maxLayoutShiftValue ?? fixture?.maxLayoutShiftValue ?? null,
    maxLongestTaskMs: fixture?.maxLongestTaskMs ?? null,
    maxRemovedMathNodes: fixture?.maxRemovedMathNodes ?? null,
    maxIncrementalResets: fixture?.maxIncrementalResets ?? null,
    expectedTableLayout: rendererContract.expectedTableLayout ?? fixture?.expectedTableLayout ?? null,
    expectedTableMathCellCount: rendererContract.expectedTableMathCellCount ?? null,
    requireNoRawMathDelimiters: rendererContract.requireNoRawMathDelimiters ?? false,
    maxMathCellOverflowCount: rendererContract.maxMathCellOverflowCount ?? null,
    maxTableLayoutTransitions: fixture?.maxTableLayoutTransitions ?? null,
    maxMathGeometryTransitions: fixture?.maxMathGeometryTransitions ?? null,
    maxBlockGeometryTransitions: fixture?.maxBlockGeometryTransitions ?? null,
    maxBlockHeightDirectionReversals: fixture?.maxBlockHeightDirectionReversals ?? null,
    maxBlockTopDirectionReversals: fixture?.maxBlockTopDirectionReversals ?? null,
    streamingAssertion,
    fixture: fixture?.id || null,
    requiresStructuralContract: fixture?.requiresStructuralContract || false,
    skipStructuralFingerprint: fixture?.skipStructuralFingerprint || false,
    scrollProbe: fixture?.scrollProbe || false,
    instrumentation: process.env.HARNESS_INSTRUMENTATION !== "off",
    seed,
    renderer,
    typewriter,
  };
  let report = await runBrowserStreamingScenario(page, scenario);
  if (process.env.HARNESS_PAIRED_INSTRUMENTATION === "1") {
    const uninstrumentedPage = await page.context().newPage();
    const uninstrumented = await runBrowserStreamingScenario(uninstrumentedPage, { ...scenario, instrumentation: false });
    await uninstrumentedPage.close();
    report = {
      ...report,
      observerEffect: {
        instrumented: {
          completionMs: report.browser.completionMs,
          firstVisibleMs: report.browser.firstVisibleMs,
          domMutationCount: report.browser.domMutationCount,
          metricCount: report.browser.instrumentation.metricCount,
          frameGapMs: report.browser.frameGapMs,
          longTaskCount: report.browser.longTaskCount,
          scroll: report.browser.scroll,
          structuralFingerprint: report.browser.structuralFingerprint,
        },
        uninstrumented: {
          completionMs: uninstrumented.browser.completionMs,
          firstVisibleMs: uninstrumented.browser.firstVisibleMs,
          domMutationCount: uninstrumented.browser.domMutationCount,
          metricCount: uninstrumented.browser.instrumentation.metricCount,
          frameGapMs: uninstrumented.browser.frameGapMs,
          longTaskCount: uninstrumented.browser.longTaskCount,
          scroll: uninstrumented.browser.scroll,
          structuralFingerprint: uninstrumented.browser.structuralFingerprint,
        },
        completionDeltaMs: report.browser.completionMs - uninstrumented.browser.completionMs,
        firstVisibleDeltaMs: report.browser.firstVisibleMs == null || uninstrumented.browser.firstVisibleMs == null
          ? null
          : report.browser.firstVisibleMs - uninstrumented.browser.firstVisibleMs,
        structuralFingerprintEqual: JSON.stringify(withoutDigests(report.browser.structuralFingerprint))
          === JSON.stringify(withoutDigests(uninstrumented.browser.structuralFingerprint)),
      },
    };
    if (uninstrumented.outcome !== "passed") {
      report.outcome = "failed";
      report.errors = [...report.errors, "Uninstrumented paired run failed", ...uninstrumented.errors];
    }
  }
  await testInfo.attach("harness-report", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });

  expect(report.schemaVersion).toBe(1);
  expect(report.scenario).toBe(name);
  expect(report.mode).toBe("deterministic-browser");
  expect(report.target).toBe("playwright-production-client");
  expect(report.browser.renderer).toBe(renderer);
  expect(report.browser.typewriter).toBe(typewriter);
  if (expectedSemanticText != null) expect(report.browser.finalSemanticTextEvidence).toMatchObject(hashRedactedText(expectedSemanticText));
  if (typewriter && process.env.HARNESS_REQUIRE_TYPEWRITER_METRICS === "1") {
    expect(report.browser.clientWork.typewriter.sampleCount).toBeGreaterThan(0);
    expect(report.browser.clientWork.typewriter.terminalSampleCount).toBeGreaterThan(0);
  }
  if (typewriter && report.browser.clientWork.typewriter.sampleCount > 0) {
    expect(report.browser.clientWork.typewriter.terminal?.backlogCharacters).toBe(0);
    expect(report.browser.clientWork.typewriter.terminal?.displayedVisibleCharacters)
      .toBe(report.browser.clientWork.typewriter.terminal?.sourceVisibleCharacters);
  }
  expect(report.outcome).toBe("passed");
  expect(report.browser.webSocketDeltaCount).toBe(cadence.deltas.length);
  if (scenario.instrumentation) {
    expect(report.browser.visibleIncrementCount).toBeGreaterThan(0);
    expect(report.browser.domMutationCount).toBeGreaterThan(0);
    expect(report.browser.frameGapMs.count).toBeGreaterThan(0);
    expect(report.browser.firstVisibleMs).toBeGreaterThanOrEqual(0);
  }
  expect(report.errors).toEqual([]);
});

test("a dropped stream reports reconnect recovery without duplicated output", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Recovery baseline uses one controlled desktop browser.");
  test.skip(Boolean(process.env.HARNESS_FLOW) && process.env.HARNESS_FLOW !== "reconnect", "Stream CLI selected the cadence contract.");

  const initialText = process.env.HARNESS_INITIAL_TEXT || "Answer survives";
  const recoveredDelta = process.env.HARNESS_RECOVERED_DELTA || " reconnect";
  const fixture = process.env.HARNESS_FIXTURE ? getBrowserFixture(process.env.HARNESS_FIXTURE) : null;
  const expectedSemanticFingerprint = jsonEnv("HARNESS_EXPECTED_SEMANTIC_FINGERPRINT") ?? fixture?.expectedSemanticFingerprint ?? null;
  const expectedAssertions = jsonEnv("HARNESS_EXPECTED_ASSERTIONS") ?? fixture?.expectedAssertions ?? {};
  const expectedInteractions = jsonEnv("HARNESS_EXPECTED_INTERACTIONS") ?? fixture?.expectedInteractions ?? {};
  const renderer = process.env.HARNESS_RENDERER || "marked";
  const typewriter = process.env.HARNESS_TYPEWRITER === "1";
  const report = await runBrowserReconnectScenario(page, {
    name: process.env.HARNESS_SCENARIO || "browser-reconnect-answer",
    initialText,
    recoveredDelta,
    expectedSemanticFingerprint,
    expectedAssertions,
    expectedInteractions,
    fixture: fixture?.id || null,
    requiresStructuralContract: fixture?.requiresStructuralContract || false,
    instrumentation: process.env.HARNESS_INSTRUMENTATION !== "off",
    renderer,
    typewriter,
  });
  await testInfo.attach("harness-report", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });

  expect(report.schemaVersion).toBe(1);
  expect(report.mode).toBe("deterministic-browser-reconnect");
  expect(report.browser.renderer).toBe(renderer);
  expect(report.browser.typewriter).toBe(typewriter);
  expect(report.browser.socketCount).toBe(2);
  expect(report.browser.resumeCount).toBe(1);
  expect(report.browser.recoveryMs).toBeGreaterThanOrEqual(0);
  expect(report.browser.finalSemanticTextEvidence).toMatchObject(hashRedactedText(initialText + recoveredDelta));
  expect(report.browser.duplicateCharacters).toBe(0);
  if (typewriter && process.env.HARNESS_REQUIRE_TYPEWRITER_METRICS === "1") {
    expect(report.browser.clientWork.typewriter.sampleCount).toBeGreaterThan(0);
    expect(report.browser.clientWork.typewriter.terminalSampleCount).toBeGreaterThan(0);
  }
  if (typewriter && report.browser.clientWork.typewriter.sampleCount > 0) {
    expect(report.browser.clientWork.typewriter.terminal?.backlogCharacters).toBe(0);
  }
  expect(report.outcome).toBe("passed");
  expect(report.errors).toEqual([]);
});
