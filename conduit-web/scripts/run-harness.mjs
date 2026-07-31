#!/usr/bin/env node
import { createCadence, runDeterministicStreamingScenario } from "../test/helpers/streaming-scenario.js";

const HELP = `Usage: node scripts/run-harness.mjs [options]

Run one deterministic Conduit transport scenario and emit versioned JSON.

Options:
  --scenario <name>                 Reported scenario name (default: streaming-baseline)
  --profile <steady|burst|stall|high-tps|jitter> Source cadence profile (default: steady)
  --text <value>                    Scripted assistant output
  --chunk-size <number>             Characters per source delta (default: 3)
  --interval-ms <number>            Steady inter-delta delay (default: 16)
  --burst-size <number>             Deltas per burst (default: 8)
  --burst-interval-ms <number>      Delay between bursts (default: 128)
  --stall-after <number>            Deltas before the intentional stall (default: 4)
  --stall-ms <number>               Intentional stall duration (default: 300)
  --client-pause-after <number>     Pause the WebSocket reader after this delta
  --client-pause-ms <number>        Pause duration for the slow-reader probe
  --min-delay-ms <number>           Minimum seeded jitter delay (default: 5)
  --max-delay-ms <number>           Maximum seeded jitter delay (default: 80)
  --seed <number>                   Reproducible jitter seed (default: 1)
  --help                            Show this help
`;

function valueAfter(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} requires a value`);
  return args[index + 1];
}

function numeric(args, flag, fallback) {
  const value = Number(valueAfter(args, flag, fallback));
  if (!Number.isFinite(value)) throw new Error(`${flag} requires a number`);
  return value;
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}

try {
  const name = valueAfter(args, "--scenario", "streaming-baseline");
  const profile = valueAfter(args, "--profile", "steady");
  const text = valueAfter(
    args,
    "--text",
    "Conduit measures the complete streaming path from scripted Pi events through the production WebSocket contract.",
  );
  const seed = numeric(args, "--seed", 1);
  const cadence = createCadence(profile, {
    text,
    seed,
    chunkSize: numeric(args, "--chunk-size", 3),
    intervalMs: numeric(args, "--interval-ms", 16),
    burstSize: numeric(args, "--burst-size", 8),
    burstIntervalMs: numeric(args, "--burst-interval-ms", 128),
    stallAfter: numeric(args, "--stall-after", 4),
    stallMs: numeric(args, "--stall-ms", 300),
    clientPauseAfterDelta: args.includes("--client-pause-after")
      ? numeric(args, "--client-pause-after", 1)
      : null,
    clientPauseMs: numeric(args, "--client-pause-ms", 0),
    minDelayMs: numeric(args, "--min-delay-ms", 5),
    maxDelayMs: numeric(args, "--max-delay-ms", 80),
  });
  const report = await runDeterministicStreamingScenario({ name, cadence, seed });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.outcome === "passed" ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
