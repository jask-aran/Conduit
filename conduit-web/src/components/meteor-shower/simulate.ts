// Pure meteor simulator. Pre-computes a full timeline of meteor events
// for a given duration, using a seedable PRNG so the output is
// deterministic given the same seed + settings + viewport.

import { DEFAULT_SETTINGS, type MeteorEvent, type MeteorSettings } from "./types";

// mulberry32: 6-line seedable PRNG. Same seed → same sequence.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sampleNormal = (rng: () => number): number => {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const concentrationToK = (concentration: number): number =>
  1 + clamp(concentration, 0, 1) * 19;

const logGamma = (x: number): number => {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};

const logBetaFn = (alpha: number, beta: number): number =>
  logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);

const betaPdf = (x: number, mean: number, k: number): number => {
  if (x <= 0 || x >= 1) return 0;
  const alpha = mean * k;
  const beta = (1 - mean) * k;
  const logPdf =
    (alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x) - logBetaFn(alpha, beta);
  return Math.exp(logPdf);
};

const gaussianPdf = (x: number, mu: number, sigma: number): number => {
  if (sigma <= 0) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
};

const sampleFromMode = (
  min: number,
  max: number,
  mode: number,
  concentration: number,
  rng: () => number,
): number => {
  const range = max - min;
  if (range <= 0) return min;
  if (concentration <= 0.001) return min + rng() * range;
  const mean = clamp((mode - min) / range, 0.05, 0.95);
  const k = concentrationToK(concentration);
  const alpha = mean * k;
  const beta = (1 - mean) * k;
  const alphaPlusBeta = alpha + beta;
  const sigma = Math.sqrt(
    (alpha * beta) / (alphaPlusBeta * alphaPlusBeta * (alphaPlusBeta + 1)),
  );
  const sample = clamp(mean + sigma * sampleNormal(rng), 0, 1);
  return min + sample * range;
};

const sampleBaseAndSpike = (
  min: number,
  max: number,
  mode: number,
  concentration: number,
  spikePosition: number,
  spikeVariance: number,
  spikeShare: number,
  rng: () => number,
): number => {
  const range = max - min;
  if (range <= 0) return min;
  if (spikeShare > 0 && rng() < spikeShare) {
    const sample = spikePosition + sampleNormal(rng) * spikeVariance;
    return clamp(sample, min, max);
  }
  return sampleFromMode(min, max, mode, concentration, rng);
};

// Generate the parameters of a single meteor at a given moment. Pure
// function of (settings, viewport, rng, isBurst).
function launchMeteor(
  settings: MeteorSettings,
  viewport: { width: number; height: number },
  rng: () => number,
  isBurst: boolean,
): { angle: number; duration: number; left: number; travel: number } {
  const shortestDuration = Math.min(settings.minDuration, settings.maxDuration);
  const longestDuration = Math.max(settings.minDuration, settings.maxDuration);
  const durationRange = longestDuration - shortestDuration;
  const burstLongestDuration = Math.max(
    shortestDuration,
    Math.min(settings.burstDurationMax, longestDuration),
  );
  const duration = isBurst
    ? shortestDuration + rng() * (burstLongestDuration - shortestDuration)
    : sampleBaseAndSpike(
        shortestDuration,
        longestDuration,
        settings.mode,
        settings.concentration,
        settings.spikePosition,
        settings.spikeVariance,
        settings.spikeShare,
        rng,
      );
  const meteorAngle = settings.angle + (rng() * 2 - 1) * settings.angleVariance;
  const angleRadians = (meteorAngle * Math.PI) / 180;
  const verticalTravel = Math.abs(Math.sin(angleRadians));
  const fullTravel =
    (viewport.height * settings.travelMultiplier) / Math.max(verticalTravel, 0.2);
  const speedFraction = (longestDuration - duration) / Math.max(durationRange, Number.EPSILON);
  const travel = settings.shortenFastMeteors
    ? fullTravel * (1 - speedFraction * (1 - settings.speedLifeCoefficient))
    : fullTravel;
  const horizontalTravel = Math.abs(Math.cos(angleRadians)) * travel;
  return {
    angle: meteorAngle,
    duration,
    left: -horizontalTravel + rng() * (viewport.width + horizontalTravel),
    travel,
  };
}

export interface SimulateOptions {
  durationSeconds: number;
  seed: number;
  viewport: { width: number; height: number };
  settings?: MeteorSettings;
}

// Computes the normalized distribution shape (base beta + Gaussian spike)
// for a histogram preview. Returns bin heights in [0, 1]. The base peak
// is pinned at 0.7 of the chart so it stays visible as the "high shelf";
// the spike renders on top and can rise above (clipped at 1.0).
//
// X-axis is duration in seconds (the launch function's input range);
// Y-axis is the probability density of the base + spike at that
// duration. This is the *theoretical* distribution, not the actual
// sample density of generated meteors.
export function computeDistributionShape(
  settings: MeteorSettings,
  bins: number,
): number[] {
  const heights = new Array<number>(bins).fill(0);
  const min = Math.min(settings.minDuration, settings.maxDuration);
  const max = Math.max(settings.minDuration, settings.maxDuration);
  const range = max - min;
  if (range <= 0) return heights;
  const baseDensities = new Array<number>(bins).fill(0);
  if (settings.concentration <= 0.001) {
    const u = 1 / range;
    for (let i = 0; i < bins; i++) baseDensities[i] = u;
  } else {
    const mean = clamp((settings.mode - min) / range, 0.05, 0.95);
    const k = concentrationToK(settings.concentration);
    for (let i = 0; i < bins; i++) {
      const x = (i + 0.5) / bins;
      baseDensities[i] = betaPdf(x, mean, k) / range;
    }
  }
  const spikeDensities = new Array<number>(bins).fill(0);
  if (settings.spikeShare > 0 && settings.spikeVariance > 0) {
    for (let i = 0; i < bins; i++) {
      const x = min + (i + 0.5) / bins * range;
      spikeDensities[i] = settings.spikeShare * gaussianPdf(x, settings.spikePosition, settings.spikeVariance);
    }
  }
  let basePeak = 0;
  for (const d of baseDensities) if (d > basePeak) basePeak = d;
  const baseTarget = 0.7;
  const normalize = basePeak > 0 ? baseTarget / basePeak : 1;
  for (let i = 0; i < bins; i++) {
    const total = (baseDensities[i] ?? 0) + (spikeDensities[i] ?? 0);
    heights[i] = Math.min(1, total * normalize);
  }
  return heights;
}

// Computes the launch-time density: how many meteors are launched per
// bin of the simulation window. This is the *empirical* density of
// actual launches, not the theoretical distribution. Useful for
// verifying that the cadence and burst settings produce the expected
// pattern of launches over time.
//
// X-axis is simulation time in seconds (0 to durationSeconds);
// Y-axis is the number of launches that fall in each bin, normalized
// to peak = 1.
export function computeLaunchDensity(
  events: readonly MeteorEvent[],
  durationSeconds: number,
  bins: number,
): number[] {
  const heights = new Array<number>(bins).fill(0);
  if (durationSeconds <= 0) return heights;
  for (const event of events) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((event.startTime / durationSeconds) * bins)));
    heights[idx]!++;
  }
  let peak = 0;
  for (const h of heights) if (h > peak) peak = h;
  if (peak > 0) {
    for (let i = 0; i < bins; i++) heights[i] = heights[i]! / peak;
  }
  return heights;
}

export function simulateMeteors(options: SimulateOptions): MeteorEvent[] {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const rng = mulberry32(options.seed);
  const events: MeteorEvent[] = [];
  let nextId = 0;
  let currentTime = 0;
  let burstRemaining = 0;
  let target = Math.floor(
    rng() * (settings.targetMax - settings.targetMin + 1) + settings.targetMin,
  );
  let launchIdx = 0;
  let removalIdx = 0;
  let nextLaunchTime = rng() * settings.firstLaunchDelay;
  let nextRetargetTime = 0;
  const EPS = 1e-6;

  while (currentTime < options.durationSeconds) {
    let nextRemovalTime = Infinity;
    if (removalIdx < launchIdx) {
      const ev = events[removalIdx]!;
      nextRemovalTime = ev.startTime + ev.duration;
    }
    const nextEventTime = Math.min(nextLaunchTime, nextRetargetTime, nextRemovalTime);
    if (nextEventTime > options.durationSeconds) break;

    currentTime = nextEventTime;

    while (
      removalIdx < launchIdx &&
      events[removalIdx]!.startTime + events[removalIdx]!.duration <= currentTime + EPS
    ) {
      removalIdx++;
    }

    if (Math.abs(currentTime - nextRetargetTime) < EPS) {
      target = Math.floor(
        rng() * (settings.targetMax - settings.targetMin + 1) + settings.targetMin,
      );
      if (rng() < settings.burstChance) {
        burstRemaining = Math.floor(
          rng() * (settings.burstCountMax - settings.burstCountMin + 1) +
            settings.burstCountMin,
        );
      }
      nextRetargetTime =
        currentTime +
        settings.retargetIntervalMin +
        rng() * (settings.retargetIntervalMax - settings.retargetIntervalMin);
    }

    if (Math.abs(currentTime - nextLaunchTime) < EPS) {
      const activeCount = launchIdx - removalIdx;
      if (activeCount < settings.maxActive) {
        const isBurst = burstRemaining > 0;
        if (isBurst) burstRemaining -= 1;
        const meteor = launchMeteor(settings, options.viewport, rng, isBurst);
        events.push({
          id: nextId++,
          startTime: currentTime,
          duration: meteor.duration,
          angle: meteor.angle,
          left: meteor.left,
          travel: meteor.travel,
        });
        launchIdx++;
      }
      const active = launchIdx - removalIdx;
      const filling = active < target;
      const gap = burstRemaining > 0
        ? settings.burstGapMin + rng() * (settings.burstGapMax - settings.burstGapMin)
        : filling
        ? settings.refillGapMin + rng() * (settings.refillGapMax - settings.refillGapMin)
        : settings.idleGapMin + rng() * (settings.idleGapMax - settings.idleGapMin);
      nextLaunchTime = currentTime + gap;
    }
  }

  return events;
}
