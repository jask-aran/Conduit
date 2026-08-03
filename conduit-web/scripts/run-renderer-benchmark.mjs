#!/usr/bin/env node
import { spawn } from "node:child_process";
import { listBrowserFixtures } from "../test/browser/helpers/streaming-fixtures.js";

const HELP = `Usage: npm run test:harness:renderer -- [options]

Run the deterministic browser fixtures against both Markdown renderers and
emit one comparable JSON report.

Options:
  --runs <number>                  Repetitions per renderer and fixture (default: 2)
  --fixtures <a,b,c>              Fixture subset (default: all named fixtures)
  --help                           Show this help
`;

function valueAfter(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} requires a value`);
  return args[index + 1];
}

function numericValue(args, flag, fallback) {
  const value = Number(valueAfter(args, flag, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} requires a positive integer`);
  return value;
}

function extractReport(stdout) {
  const start = stdout.indexOf('{\n  "schemaVersion"');
  if (start < 0) return null;
  const end = stdout.lastIndexOf("}") + 1;
  if (end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end));
  } catch {
    return null;
  }
}

function runHarness({ renderer, fixture, run }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      "scripts/run-browser-harness.mjs",
      "--renderer", renderer,
      "--fixture", fixture,
      "--profile", "steady",
      "--chunk-size", "3",
      "--seed", "1",
      "--scenario", `renderer-ab-${renderer}-${fixture}-${run}`,
    ], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 1, signal: null, stdout, stderr: `${stderr}${error.message}\n` }));
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }));
  });
}

function reportMetric(report, key) {
  const value = report?.browser?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reportRendererTiming(report, renderer, stage, key, percentile = "p95") {
  const value = report?.browser?.clientWork?.rendererTimingMs?.[`${renderer}.${stage}.${key}`]?.[percentile];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reportRendererCounter(report, renderer, key, percentile = "p95") {
  const value = report?.browser?.clientWork?.rendererCounters?.[`${renderer}.${key}`]?.[percentile];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function runSummary({ renderer, fixture, run, processResult }) {
  const report = extractReport(processResult.stdout);
  const browser = report?.browser;
  const scroll = browser?.scroll;
  return {
    renderer,
    fixture,
    run,
    processExitCode: processResult.code,
    processSignal: processResult.signal,
    outcome: report?.outcome || "harness-error",
    errors: report?.errors || (processResult.stderr.trim() ? [processResult.stderr.trim()] : ["Harness produced no JSON report"]),
    sourceCharacters: reportMetric(report, "sourceCharacters"),
    sourceDeltaCount: reportMetric(report, "sourceDeltaCount"),
    firstVisibleMs: reportMetric(report, "firstVisibleMs"),
    completionMs: reportMetric(report, "completionMs"),
    visibleIncrementCount: reportMetric(report, "visibleIncrementCount"),
    domMutationCount: reportMetric(report, "domMutationCount"),
    frameGapsOver32Ms: reportMetric(report, "frameGapsOver32Ms"),
    frameGapsOver50Ms: reportMetric(report, "frameGapsOver50Ms"),
    longTaskCount: reportMetric(report, "longTaskCount"),
    recoveryMs: reportMetric(report, "recoveryMs"),
    socketCount: reportMetric(report, "socketCount"),
    resumeCount: reportMetric(report, "resumeCount"),
    duplicateCharacters: reportMetric(report, "duplicateCharacters"),
    finalDistanceFromBottom: typeof scroll?.finalDistanceFromBottom === "number" ? scroll.finalDistanceFromBottom : null,
    structuralMatch: browser?.structuralMatch ?? null,
    finalSemanticTextLength: reportMetric(report, "finalSemanticTextLength"),
    outerIdentityPreserved: browser?.identity?.outer?.persistent ?? null,
    parseP50Ms: reportRendererTiming(report, renderer, "markdown-render", "parseMs", "p50"),
    parseP95Ms: reportRendererTiming(report, renderer, "markdown-render", "parseMs", "p95"),
    reconcileP50Ms: reportRendererTiming(report, renderer, "markdown-reconcile", "reconcileMs", "p50"),
    reconcileP95Ms: reportRendererTiming(report, renderer, "markdown-reconcile", "reconcileMs", "p95"),
    katexP50Ms: renderer === "marked"
      ? reportRendererTiming(report, renderer, "markdown-render", "katexMs", "p50")
      : reportRendererTiming(report, renderer, "markdown-katex", "katexMs", "p50"),
    katexP95Ms: renderer === "marked"
      ? reportRendererTiming(report, renderer, "markdown-render", "katexMs", "p95")
      : reportRendererTiming(report, renderer, "markdown-katex", "katexMs", "p95"),
    katexCallCountP95: reportRendererCounter(report, renderer, "katexCallCount"),
    pendingBlockCountP95: reportRendererCounter(report, renderer, "pendingBlockCount"),
    completedBlockCountP95: reportRendererCounter(report, renderer, "completedBlockCount"),
    updatedBlockCountP95: reportRendererCounter(report, renderer, "updatedBlockCount"),
    parserModes: report?.browser?.clientWork?.rendererParserModes?.[renderer] || {},
  };
}

function stats(records, key) {
  const values = records.map((record) => record[key]).filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return {
    count: values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function delta(marked, incremark) {
  if (!marked || !incremark) return { absoluteP50: null, percentP50: null };
  const absoluteP50 = incremark.p50 - marked.p50;
  return {
    absoluteP50,
    percentP50: marked.p50 === 0 ? (incremark.p50 === 0 ? 0 : null) : (absoluteP50 / marked.p50) * 100,
  };
}

function compareFixture(records, fixture) {
  const marked = records.filter((record) => record.fixture === fixture && record.renderer === "marked");
  const incremark = records.filter((record) => record.fixture === fixture && record.renderer === "incremark");
  const keys = [
    "firstVisibleMs",
    "completionMs",
    "visibleIncrementCount",
    "domMutationCount",
    "frameGapsOver32Ms",
    "frameGapsOver50Ms",
    "longTaskCount",
    "recoveryMs",
    "duplicateCharacters",
    "finalDistanceFromBottom",
    "parseP50Ms",
    "parseP95Ms",
    "reconcileP50Ms",
    "reconcileP95Ms",
    "katexP50Ms",
    "katexP95Ms",
    "katexCallCountP95",
    "pendingBlockCountP95",
    "completedBlockCountP95",
    "updatedBlockCountP95",
  ];
  return {
    fixture,
    passedRuns: {
      marked: marked.filter((record) => record.outcome === "passed").length,
      incremark: incremark.filter((record) => record.outcome === "passed").length,
    },
    parity: {
      marked: marked.map((record) => ({ run: record.run, structuralMatch: record.structuralMatch, finalSemanticTextLength: record.finalSemanticTextLength, outerIdentityPreserved: record.outerIdentityPreserved })),
      incremark: incremark.map((record) => ({ run: record.run, structuralMatch: record.structuralMatch, finalSemanticTextLength: record.finalSemanticTextLength, outerIdentityPreserved: record.outerIdentityPreserved })),
    },
    metrics: Object.fromEntries(keys.map((key) => {
      const markedStats = stats(marked, key);
      const incremarkStats = stats(incremark, key);
      return [key, {
        marked: markedStats,
        incremark: incremarkStats,
        delta: delta(markedStats, incremarkStats),
      }];
    })),
  };
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}

try {
  const runs = numericValue(args, "--runs", 2);
  const allFixtures = listBrowserFixtures();
  const fixtures = valueAfter(args, "--fixtures", allFixtures.join(","))
    .split(",")
    .map((fixture) => fixture.trim())
    .filter(Boolean);
  const unknown = fixtures.filter((fixture) => !allFixtures.includes(fixture));
  if (unknown.length) throw new Error(`Unknown fixture(s): ${unknown.join(", ")}. Available: ${allFixtures.join(", ")}`);

  const records = [];
  for (const renderer of ["marked", "incremark"]) {
    for (const fixture of fixtures) {
      for (let run = 1; run <= runs; run += 1) {
        const processResult = await runHarness({ renderer, fixture, run });
        records.push(runSummary({ renderer, fixture, run, processResult }));
      }
    }
  }

  const failedRuns = records.filter((record) => record.outcome !== "passed");
  const report = {
    schemaVersion: 1,
    benchmark: "markdown-renderer-ab",
    generatedAt: new Date().toISOString(),
    command: "npm run test:harness:renderer",
    renderers: ["marked", "incremark"],
    fixtures,
    runsPerRendererFixture: runs,
    cadence: { profile: "steady", chunkSize: 3, seed: 1 },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    outcome: failedRuns.length ? "failed" : "passed",
    failedRuns,
    comparisons: fixtures.map((fixture) => compareFixture(records, fixture)),
    runs: records,
    limitations: [
      "Marked parseMs includes marked parsing plus DOMPurify sanitisation; Incremark parseMs covers core append/render/finalize plus AST snapshot, while Solid DOM work is represented by reconcileMs and browser-level metrics.",
      "The browser-level completion, visible cadence, DOM, frame, Long Task, scroll, and parity metrics are the primary cross-renderer comparison.",
      "Bundle and parser-only cost are reported separately in the issue specification.",
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.outcome === "passed" ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
