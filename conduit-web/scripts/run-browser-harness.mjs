#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";

const HELP = `Usage: node scripts/run-browser-harness.mjs [options]

Drive the production client with a deterministic stream and emit versioned JSON.

Options:
  --flow <stream|reconnect>         Browser flow to exercise (default: stream)
  --scenario <name>                 Reported scenario name (default: browser-streaming-baseline)
  --profile <steady|burst|jitter>   Source cadence profile (default: steady)
  --text <value>                    Scripted assistant output
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

const environment = {
  ...process.env,
  HARNESS_FLOW: valueAfter(args, "--flow", "stream"),
  HARNESS_SCENARIO: valueAfter(args, "--scenario", "browser-streaming-baseline"),
  HARNESS_PROFILE: valueAfter(args, "--profile", "steady"),
  HARNESS_TEXT: valueAfter(
    args,
    "--text",
    "Conduit measures WebSocket delivery, visible text, DOM mutations, long tasks, and animation frames.",
  ),
  HARNESS_CHUNK_SIZE: valueAfter(args, "--chunk-size", "3"),
  HARNESS_INTERVAL_MS: valueAfter(args, "--interval-ms", "16"),
  HARNESS_BURST_SIZE: valueAfter(args, "--burst-size", "8"),
  HARNESS_BURST_INTERVAL_MS: valueAfter(args, "--burst-interval-ms", "128"),
  HARNESS_MIN_DELAY_MS: valueAfter(args, "--min-delay-ms", "5"),
  HARNESS_MAX_DELAY_MS: valueAfter(args, "--max-delay-ms", "80"),
  HARNESS_SEED: valueAfter(args, "--seed", "1"),
  HARNESS_INITIAL_TEXT: valueAfter(args, "--initial-text", "Answer survives"),
  HARNESS_RECOVERED_DELTA: valueAfter(args, "--recovered-delta", " reconnect"),
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
