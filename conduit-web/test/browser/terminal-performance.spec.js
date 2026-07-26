import { expect, test } from "@playwright/test";

test.skip(!process.env.PERF, "Run explicitly with npm run test:terminal-performance; timing thresholds are machine-specific.");
test.describe.configure({ mode: "serial" });
const cpuRate = Number(process.env.PERF_CPU_RATE || 1);

for (const renderer of ["ghostty", "xterm"]) {
  test(`${renderer} terminal performance fixture`, async ({ page }) => {
    if (cpuRate > 1) {
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    }
    await page.goto("/test/fixtures/terminal-performance.html");
    await page.waitForFunction(() => Boolean(window.__terminalPerf));
    await page.evaluate((rendererId) => window.__terminalPerf.prepare(rendererId), renderer);
    const echoSamples = [];
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press("Backspace");
      echoSamples.push(await page.evaluate(() => window.__terminalPerf.takeEcho()));
    }
    const bursts = {};
    for (const batchSize of [1, 4, 16]) bursts[batchSize] = await page.evaluate((size) => window.__terminalPerf.burst(size), batchSize);
    const paced = await page.evaluate(() => window.__terminalPerf.pacedUpdates());
    const input = {
      medianMs: echoSamples.sort((a, b) => a - b)[Math.floor(echoSamples.length / 2)],
      p95Ms: echoSamples.sort((a, b) => a - b)[Math.floor((echoSamples.length - 1) * 0.95)],
      maxMs: Math.max(...echoSamples),
    };
    console.log(JSON.stringify({ renderer, cpuRate, input, bursts, paced }));
    expect(input.maxMs).toBeLessThan(250);
    for (const burst of Object.values(bursts)) expect(burst.maxFrameMs).toBeLessThan(1_000);
    expect(paced.maxFrameMs).toBeLessThan(1_000);
  });
}
