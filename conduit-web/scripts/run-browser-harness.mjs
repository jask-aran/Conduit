#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { getBrowserFixture, listBrowserFixtures } from "../test/browser/helpers/streaming-fixtures.js";

const HELP = `Usage: node scripts/run-browser-harness.mjs [options]

Drive the production client with a deterministic stream and emit versioned JSON.

Options:
  --flow <stream|reconnect>         Browser flow to exercise (default: stream)
  --scenario <name>                 Reported scenario name (default: browser-streaming-baseline)
  --profile <steady|burst|jitter>   Source cadence profile (default: steady)
  --renderer <marked|incremark|incremark-typewriter|incremark-synthetic>  Markdown renderer (default: marked)
  --typewriter                     Legacy alias for --renderer incremark-typewriter
  --require-typewriter-metrics     Require scheduled typewriter metric samples
  --text <value>                    Scripted assistant output
  --fixture <name>                  Named deterministic fixture (use --list-fixtures)
  --list-fixtures                   List named fixtures and exit
  --expected-semantic-text <value>  Expected rendered semantic text (default: source text)
  --expected-semantic-fingerprint <json>  Expected structural fingerprint JSON
  --expected-assertions <json>       Required security assertions JSON
  --expected-interactions <json>     Required interaction assertions JSON
  --instrumentation <on|off>        Opt-in client metric instrumentation (default: on)
  --paired-instrumentation          Run instrumented and uninstrumented browser probes
  --chunk-size <number>             Characters per source delta (default: 3)
  --interval-ms <number>            Steady inter-delta delay (default: 16)
  --burst-size <number>             Deltas per burst (default: 8)
  --burst-interval-ms <number>      Delay between bursts (default: 128)
  --min-delay-ms <number>           Minimum seeded jitter delay (default: 5)
  --max-delay-ms <number>           Maximum seeded jitter delay (default: 80)
  --seed <number>                   Reproducible jitter seed (default: 1)
  --initial-text <value>            Text visible before a reconnect
  --recovered-delta <value>         Delta delivered after generation resume
  --help                            Show this help
`;

function valueAfter(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} requires a value`);
  return args[index + 1];
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (args.includes("--list-fixtures")) {
  process.stdout.write(`${listBrowserFixtures().join("\n")}\n`);
  process.exit(0);
}

const fixtureId = valueAfter(args, "--fixture", null);
const fixture = fixtureId ? getBrowserFixture(fixtureId) : null;
const expectedSemanticText = valueAfter(args, "--expected-semantic-text", null);
const expectedSemanticFingerprint = valueAfter(args, "--expected-semantic-fingerprint", null);
const expectedAssertions = valueAfter(args, "--expected-assertions", null);
const expectedInteractions = valueAfter(args, "--expected-interactions", null);
const instrumentation = valueAfter(args, "--instrumentation", "on");
if (!["on", "off"].includes(instrumentation)) throw new Error("--instrumentation must be on or off");
const renderer = valueAfter(args, "--renderer", "marked");
if (!["marked", "incremark", "incremark-typewriter", "incremark-synthetic"].includes(renderer)) throw new Error("--renderer must be marked, incremark, incremark-typewriter, or incremark-synthetic");
if (args.includes("--typewriter") && !["incremark", "incremark-typewriter"].includes(renderer)) throw new Error("--typewriter requires an Incremark renderer");

const environment = {
  ...process.env,
  VITE_CONDUIT_HARNESS: "1",
  HARNESS_FLOW: valueAfter(args, "--flow", fixture?.initialText ? "reconnect" : "stream"),
  HARNESS_SCENARIO: valueAfter(args, "--scenario", fixture?.id || "browser-streaming-baseline"),
  ...(fixture ? { HARNESS_FIXTURE: fixture.id } : {}),
  HARNESS_PROFILE: valueAfter(args, "--profile", "steady"),
  HARNESS_RENDERER: renderer,
  ...(args.includes("--typewriter") || renderer === "incremark-typewriter" ? { HARNESS_TYPEWRITER: "1" } : {}),
  ...(args.includes("--require-typewriter-metrics") ? { HARNESS_REQUIRE_TYPEWRITER_METRICS: "1" } : {}),
  HARNESS_TEXT: valueAfter(
    args,
    "--text",
    fixture?.text || "Conduit measures WebSocket delivery, visible text, DOM mutations, long tasks, and animation frames.",
  ),
  ...((expectedSemanticText ?? fixture?.expectedSemanticText) == null ? {} : { HARNESS_EXPECTED_SEMANTIC_TEXT: expectedSemanticText ?? fixture.expectedSemanticText }),
  ...((expectedSemanticFingerprint ?? fixture?.expectedSemanticFingerprint) == null ? {} : { HARNESS_EXPECTED_SEMANTIC_FINGERPRINT: JSON.stringify(expectedSemanticFingerprint ? JSON.parse(expectedSemanticFingerprint) : fixture.expectedSemanticFingerprint) }),
  ...((expectedAssertions ?? fixture?.expectedAssertions) == null ? {} : { HARNESS_EXPECTED_ASSERTIONS: JSON.stringify(expectedAssertions ? JSON.parse(expectedAssertions) : fixture.expectedAssertions) }),
  ...((expectedInteractions ?? fixture?.expectedInteractions) == null ? {} : { HARNESS_EXPECTED_INTERACTIONS: JSON.stringify(expectedInteractions ? JSON.parse(expectedInteractions) : fixture.expectedInteractions) }),
  ...(fixture?.scrollProbe ? { HARNESS_SCROLL_PROBE: "1" } : {}),
  HARNESS_INSTRUMENTATION: instrumentation,
  ...(args.includes("--paired-instrumentation") ? { HARNESS_PAIRED_INSTRUMENTATION: "1" } : {}),
  HARNESS_CHUNK_SIZE: valueAfter(args, "--chunk-size", "3"),
  HARNESS_INTERVAL_MS: valueAfter(args, "--interval-ms", "16"),
  HARNESS_BURST_SIZE: valueAfter(args, "--burst-size", "8"),
  HARNESS_BURST_INTERVAL_MS: valueAfter(args, "--burst-interval-ms", "128"),
  HARNESS_MIN_DELAY_MS: valueAfter(args, "--min-delay-ms", "5"),
  HARNESS_MAX_DELAY_MS: valueAfter(args, "--max-delay-ms", "80"),
  HARNESS_SEED: valueAfter(args, "--seed", "1"),
  HARNESS_INITIAL_TEXT: valueAfter(args, "--initial-text", fixture?.initialText || "Answer survives"),
  HARNESS_RECOVERED_DELTA: valueAfter(args, "--recovered-delta", fixture?.recoveredDelta || " reconnect"),
};

const cli = path.resolve("node_modules/@playwright/test/cli.js");
const child = spawn(process.execPath, [
  cli,
  "test",
  "test/browser/harness-streaming.spec.js",
  "--project=desktop-chromium",
  "--workers=1",
  "--reporter=./scripts/harness-json-reporter.mjs",
], { cwd: path.resolve("."), env: environment, stdio: "inherit" });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
