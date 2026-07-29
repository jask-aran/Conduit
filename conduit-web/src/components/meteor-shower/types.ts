// Public types and defaults for the MeteorShower component.

export interface MeteorEvent {
  id: number;
  startTime: number; // seconds from t=0 when the meteor appears
  duration: number;  // seconds the animation runs
  angle: number;     // degrees
  left: number;      // px
  travel: number;    // px
}

export interface MeteorSettings {
  // Duration range
  minDuration: number;
  maxDuration: number;
  // Base distribution
  mode: number;
  concentration: number;
  // Spike
  spikePosition: number;
  spikeVariance: number;
  spikeShare: number;
  // Cadence
  maxActive: number;
  targetMin: number;
  targetMax: number;
  refillGapMin: number;
  refillGapMax: number;
  idleGapMin: number;
  idleGapMax: number;
  retargetIntervalMin: number;
  retargetIntervalMax: number;
  firstLaunchDelay: number;
  // Bursts
  burstChance: number;
  burstCountMin: number;
  burstCountMax: number;
  burstDurationMax: number;
  burstGapMin: number;
  burstGapMax: number;
  // Geometry
  angle: number;
  angleVariance: number;
  travelMultiplier: number;
  entryOffset: number;
  // Speed-life coupling
  speedLifeCoefficient: number;
  shortenFastMeteors: boolean;
}

export const DEFAULT_SETTINGS: MeteorSettings = {
  angle: 225,
  angleVariance: 0,
  burstChance: 0,
  burstCountMax: 3,
  burstCountMin: 1,
  burstDurationMax: 8,
  burstGapMax: 0.3,
  burstGapMin: 0.08,
  concentration: 0.05,
  entryOffset: 12,
  firstLaunchDelay: 0.75,
  idleGapMax: 5,
  idleGapMin: 1.4,
  maxActive: 30,
  maxDuration: 34,
  minDuration: 2,
  mode: 20.5,
  refillGapMax: 0.8,
  refillGapMin: 0.18,
  retargetIntervalMax: 28,
  retargetIntervalMin: 12,
  shortenFastMeteors: true,
  speedLifeCoefficient: 0.4,
  spikePosition: 4,
  spikeShare: 0.45,
  spikeVariance: 0.1,
  targetMax: 30,
  targetMin: 20,
  travelMultiplier: 1.25,
};

// The seed that, combined with DEFAULT_SETTINGS, produces the canonical
// shower the integration agent should use for the chat background. Any
// 32-bit integer works; this one is stable across builds.
export const DEFAULT_SEED = 0xC0FFEE;
