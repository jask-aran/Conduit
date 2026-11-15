import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const directory = path.join(root, "conduit-web/.cptr/perf");
export async function prepareHarness() {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "harness.html"), '<!doctype html><html lang="en" class="dark" data-library><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conduit rendering benchmark</title></head><body><script type="module">import "/src/client/styles.css";import "/src/components/ui/styles/index.ts";import {render} from "solid-js/web";window.renderBenchmark=render;window.harnessReady=true;</script></body></html>');
}

export function runHeadedBenchmark(run, cpu) {
  const cli = (...args) => execFileSync(process.execPath, [path.join(root, "scripts/run-windows-chrome-devtools.mjs"), "cli", ...args], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const restore = cli("list_pages").match(/^(\d+):.*\[selected\]/m)?.[1];
  const opened = cli("new_page", "http://127.0.0.1:5181/.cptr/perf/harness.html");
  const page = opened.match(/^(\d+):.*\[selected\]/m)?.[1];
  if (!page) throw new Error(opened);
  try {
    cli("select_page", page, "--bringToFront");
    cli("emulate", "--viewport", "1440x900x1", "--cpuThrottlingRate", String(cpu));
    cli("evaluate_script", `() => window.benchmarkCpu = ${cpu}`);
    // Started in the page and polled: a throttled run outlasts one call's daemon timeout.
    cli("evaluate_script", `() => { window.benchmarkResult = null; (${run})().then((result) => { window.benchmarkResult = { result }; }, (error) => { window.benchmarkResult = { error: String(error?.stack ?? error) }; }); return true; }`);
    for (const started = Date.now(); Date.now() - started < 30 * 60_000;) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      const output = cli("evaluate_script", "() => window.benchmarkResult");
      const json = output.match(/```json\s*([\s\S]*?)```/)?.[1];
      const done = json && JSON.parse(json);
      if (!done) continue;
      if (done.error) throw new Error(done.error);
      return done.result;
    }
    throw new Error("Benchmark did not finish in 30 minutes");
  } finally {
    cli("close_page", page);
    if (restore) cli("select_page", restore, "--bringToFront");
  }
}
