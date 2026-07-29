import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import {
  DEFAULT_SEED,
  DEFAULT_SETTINGS,
  MeteorShower,
  computeDistributionShape,
  computeLaunchDensity,
  simulateMeteors,
  type MeteorEvent,
  type MeteorSettings,
} from "@/components/meteor-shower";
import "./main.css";

interface DemoSettings extends MeteorSettings {
  seed: number;
  durationSeconds: number;
}

const INITIAL: DemoSettings = {
  ...DEFAULT_SETTINGS,
  seed: DEFAULT_SEED,
  durationSeconds: 120,
};

interface NumberControlProps {
  keyName?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}

const NumberControl: Component<NumberControlProps> = (props) => {
  const update = (rawValue: string) => {
    const value = Number.parseFloat(rawValue);
    if (!Number.isFinite(value)) return;
    props.onChange(Math.min(props.max, Math.max(props.min, value)));
  };

  // Keep value inside [min, max] whenever the window changes.
  createEffect(() => {
    const clamped = Math.min(props.max, Math.max(props.min, props.value));
    if (clamped !== props.value) {
      props.onChange(clamped);
    }
  });

  return (
    <label class="meteor-control">
      <span class="meteor-control__label">
        <span>{props.label}</span>
        {props.keyName ? <code class="meteor-control__key">{props.keyName}</code> : null}
      </span>
      <div class="meteor-control__inputs">
        <input
          aria-label={`${props.label} slider`}
          max={props.max}
          min={props.min}
          onInput={(event) => update(event.currentTarget.value)}
          step={props.step ?? 1}
          type="range"
          value={props.value}
        />
        <input
          aria-label={props.label}
          max={props.max}
          min={props.min}
          onInput={(event) => update(event.currentTarget.value)}
          step={props.step ?? 1}
          type="number"
          value={props.value}
        />
      </div>
    </label>
  );
};

interface HistogramProps {
  bins?: number;
  caption: string;
  explainer: string;
  height?: number;
  lineColor?: string;
  max: number;
  maxValue: number;
  min: number;
  minValue: number;
}

const Histogram: Component<HistogramProps> = (props) => {
  const bins = () => props.bins ?? 64;
  const heights = () => {
    const out = new Array<number>(bins()).fill(0);
    const range = props.max - props.min;
    if (range <= 0) return out;
    for (let i = 0; i < bins(); i++) {
      const x = props.minValue + (i + 0.5) / bins() * (props.maxValue - props.minValue);
      out[i] = props.lineColor ? 0 : 0; // overridden by parent via slot-like props
    }
    return out;
  };
  // The demo uses two specific histograms; we expose them via two thin wrappers.
  return null;
};

interface DistributionHistogramProps {
  height?: number;
  max: number;
  min: number;
  settings: MeteorSettings;
}

const DistributionHistogram: Component<DistributionHistogramProps> = (props) => {
  const bins = 64;
  const heights = () => computeDistributionShape(props.settings, bins);
  const linePath = () => {
    const h = heights();
    let d = "";
    for (let i = 0; i < h.length; i++) {
      const x = (i / (h.length - 1)) * 100;
      const y = 90 - h[i]! * 85;
      d += (i === 0 ? "M" : "L") + `${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return d;
  };
  const spikePct = () => {
    const range = Math.max(props.min, props.max) - Math.min(props.min, props.max);
    if (range <= 0) return 0;
    return clamp01((props.settings.spikePosition - Math.min(props.min, props.max)) / range) * 100;
  };
  return (
    <div class="meteor-histogram" aria-hidden="true">
      <div class="meteor-histogram__title">Distribution shape</div>
      <svg
        class="meteor-histogram__svg"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        width="100%"
        height={props.height ?? 70}
      >
        <path d={`${linePath()} L 100 100 L 0 100 Z`} fill="currentColor" fill-opacity="0.4" />
        <path d={linePath()} fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" />
        <line
          stroke="currentColor"
          stroke-dasharray="2 2"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
          x1={spikePct()}
          x2={spikePct()}
          y1="0"
          y2="100"
        />
      </svg>
      <div class="meteor-histogram__axis">
        <span>{props.min}s</span>
        <span>{props.max}s</span>
      </div>
      <p class="meteor-histogram__caption">
        The probability of a meteor having a given duration. Flat base = uniform; bump on the left = fast streak.
      </p>
    </div>
  );
};

interface LaunchHistogramProps {
  durationSeconds: number;
  events: readonly MeteorEvent[];
  height?: number;
}

const LaunchHistogram: Component<LaunchHistogramProps> = (props) => {
  const bins = 64;
  const heights = () => computeLaunchDensity(props.events, props.durationSeconds, bins);
  const linePath = () => {
    const h = heights();
    let d = "";
    for (let i = 0; i < h.length; i++) {
      const x = (i / (h.length - 1)) * 100;
      const y = 90 - h[i]! * 85;
      d += (i === 0 ? "M" : "L") + `${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return d;
  };
  return (
    <div class="meteor-histogram" aria-hidden="true">
      <div class="meteor-histogram__title">Launch density</div>
      <svg
        class="meteor-histogram__svg"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        width="100%"
        height={props.height ?? 50}
      >
        <path d={linePath()} fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="meteor-histogram__axis">
        <span>0s</span>
        <span>{props.durationSeconds}s</span>
        <small>{props.events.length} meteors</small>
      </div>
      <p class="meteor-histogram__caption">
        How often the launcher fires over the simulation window. Spikes = bursts, dips = idle gaps.
      </p>
    </div>
  );
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const App: Component = () => {
  let field!: HTMLDivElement;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [settings, setSettings] = createStore<DemoSettings>(INITIAL);
  const [restartToken, setRestartToken] = createSignal(0);
  const [copyLabel, setCopyLabel] = createSignal("Copy configuration");
  const [loadLabel, setLoadLabel] = createSignal("Load from file");

  const configuration = () => {
    const { seed, durationSeconds, ...rest } = settings;
    return JSON.stringify({ seed: settings.seed, durationSeconds: settings.durationSeconds, ...rest }, null, 2);
  };

  const copyConfiguration = async () => {
    try {
      await navigator.clipboard.writeText(configuration());
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Select JSON below");
    }
  };

  const saveConfiguration = () => {
    const blob = new Blob([configuration()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meteors-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadConfiguration = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const loaded = JSON.parse(String(e.target?.result ?? ""));
        if (typeof loaded === "object" && loaded !== null && !Array.isArray(loaded)) {
          setSettings(loaded as Partial<DemoSettings>);
          setLoadLabel("Loaded");
          window.setTimeout(() => setLoadLabel("Load from file"), 1500);
        } else {
          setLoadLabel("Invalid file");
          window.setTimeout(() => setLoadLabel("Load from file"), 1500);
        }
      } catch {
        setLoadLabel("Invalid JSON");
        window.setTimeout(() => setLoadLabel("Load from file"), 1500);
      }
      input.value = "";
    };
    reader.readAsText(file);
  };

  const events = createMemo(() => {
    void restartToken();
    const w = size().width;
    const h = size().height;
    if (w <= 0 || h <= 0) return [];
    const { seed, durationSeconds, ...rest } = settings;
    return simulateMeteors({
      settings: rest as MeteorSettings,
      viewport: { width: w, height: h },
      durationSeconds: settings.durationSeconds,
      seed: settings.seed,
    });
  });

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    });
    observer.observe(field);
    onCleanup(() => observer.disconnect());
  });

  // Auto-loop: when the pre-computed timeline ends, regenerate the events
  // with the same seed and settings. The CSS animations restart from t=0
  // and the shower plays again. There's a brief hard cut at the loop
  // boundary, which is acceptable for a demo.
  createEffect(() => {
    const ms = settings.durationSeconds * 1000;
    const id = window.setInterval(() => {
      setRestartToken((t) => t + 1);
    }, ms);
    onCleanup(() => window.clearInterval(id));
  });

  // Paired-slider cascades.
  const durationMin = (minDuration: number) =>
    setSettings({ minDuration, maxDuration: Math.max(settings.maxDuration, minDuration) });
  const durationMax = (maxDuration: number) =>
    setSettings({ maxDuration, minDuration: Math.min(settings.minDuration, maxDuration) });
  const targetMinUpdate = (targetMin: number) =>
    setSettings({ targetMin, targetMax: Math.max(settings.targetMax, targetMin) });
  const burstCountMinUpdate = (burstCountMin: number) =>
    setSettings({ burstCountMin, burstCountMax: Math.max(settings.burstCountMax, burstCountMin) });
  const burstCountMaxUpdate = (burstCountMax: number) =>
    setSettings({ burstCountMax, burstCountMin: Math.min(settings.burstCountMin, burstCountMax) });
  const burstGapMinUpdate = (burstGapMin: number) =>
    setSettings({ burstGapMin, burstGapMax: Math.max(settings.burstGapMax, burstGapMin) });
  const burstGapMaxUpdate = (burstGapMax: number) =>
    setSettings({ burstGapMax, burstGapMin: Math.min(settings.burstGapMin, burstGapMax) });
  const refillGapMinUpdate = (refillGapMin: number) =>
    setSettings({ refillGapMin, refillGapMax: Math.max(settings.refillGapMax, refillGapMin) });
  const refillGapMaxUpdate = (refillGapMax: number) =>
    setSettings({ refillGapMax, refillGapMin: Math.min(settings.refillGapMin, refillGapMax) });
  const idleGapMinUpdate = (idleGapMin: number) =>
    setSettings({ idleGapMin, idleGapMax: Math.max(settings.idleGapMax, idleGapMin) });
  const idleGapMaxUpdate = (idleGapMax: number) =>
    setSettings({ idleGapMax, idleGapMin: Math.min(settings.idleGapMin, idleGapMax) });
  const retargetIntervalMinUpdate = (retargetIntervalMin: number) =>
    setSettings({ retargetIntervalMin, retargetIntervalMax: Math.max(settings.retargetIntervalMax, retargetIntervalMin) });
  const retargetIntervalMaxUpdate = (retargetIntervalMax: number) =>
    setSettings({ retargetIntervalMax, retargetIntervalMin: Math.min(settings.retargetIntervalMin, retargetIntervalMax) });

  // Histogram props computed from current settings.
  const distributionSettings = (): MeteorSettings => {
    const { seed, durationSeconds, ...rest } = settings;
    return rest as MeteorSettings;
  };

  return (
    <div ref={field} class="meteor-demo">
      <MeteorShower events={events()} entryOffset={settings.entryOffset} />
      <aside class="meteor-controls" aria-label="Meteor controls">
        <header>
          <span>Sky state</span>
          <small>Session only</small>
        </header>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Timeline</h3>
          <NumberControl
            keyName="seed"
            label="Seed"
            min={0}
            max={2147483647}
            step={1}
            value={settings.seed}
            onChange={(seed) => setSettings("seed", seed)}
          />
          <NumberControl
            keyName="durationSeconds"
            label="Duration (s)"
            min={10}
            max={600}
            step={10}
            value={settings.durationSeconds}
            onChange={(durationSeconds) => setSettings("durationSeconds", durationSeconds)}
          />
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Density</h3>
          <div class="meteor-chain" data-chain="density">
            <NumberControl
              keyName="maxActive"
              label="Maximum active"
              min={1}
              max={60}
              value={settings.maxActive}
              onChange={(maxActive) => setSettings({
                maxActive,
                targetMax: Math.min(settings.targetMax, maxActive),
                targetMin: Math.min(settings.targetMin, maxActive),
              })}
            />
            <NumberControl
              keyName="targetMin"
              label="Target floor"
              min={1}
              max={settings.maxActive}
              value={settings.targetMin}
              onChange={targetMinUpdate}
            />
            <NumberControl
              keyName="targetMax"
              label="Target ceiling"
              min={settings.targetMin}
              max={settings.maxActive}
              value={settings.targetMax}
              onChange={(targetMax) => setSettings("targetMax", targetMax)}
            />
          </div>
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Speed distribution</h3>
          <div class="meteor-chain" data-chain="duration">
            <NumberControl
              keyName="minDuration"
              label="Fastest pass (s)"
              min={1}
              max={60}
              step={0.5}
              value={settings.minDuration}
              onChange={durationMin}
            />
            <NumberControl
              keyName="maxDuration"
              label="Slowest pass (s)"
              min={settings.minDuration}
              max={60}
              step={0.5}
              value={settings.maxDuration}
              onChange={durationMax}
            />
          </div>
          <p class="meteor-effective">Effective duration range: {Math.min(settings.minDuration, settings.maxDuration)}–{Math.max(settings.minDuration, settings.maxDuration)} s</p>
          <DistributionHistogram
            max={Math.max(settings.minDuration, settings.maxDuration)}
            min={Math.min(settings.minDuration, settings.maxDuration)}
            settings={distributionSettings()}
          />
          <div class="meteor-chain" data-chain="distribution">
            <NumberControl
              keyName="mode"
              label="Bulk duration (s)"
              min={Math.min(settings.minDuration, settings.maxDuration)}
              max={Math.max(settings.minDuration, settings.maxDuration)}
              step={0.5}
              value={settings.mode}
              onChange={(mode) => setSettings("mode", mode)}
            />
            <NumberControl
              keyName="concentration"
              label="Concentration (0 flat, 1 peaked)"
              min={0}
              max={1}
              step={0.05}
              value={settings.concentration}
              onChange={(concentration) => setSettings("concentration", concentration)}
            />
          </div>
          <NumberControl
            keyName="speedLifeCoefficient"
            label="Speed/life coefficient"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.speedLifeCoefficient}
            onChange={(speedLifeCoefficient) => setSettings("speedLifeCoefficient", speedLifeCoefficient)}
          />
          <label class="meteor-toggle">
            <input
              checked={settings.shortenFastMeteors}
              onInput={(event) => setSettings("shortenFastMeteors", event.currentTarget.checked)}
              type="checkbox"
            />
            <span>Fast meteors burn out early <code class="meteor-control__key">shortenFastMeteors</code></span>
          </label>
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Fast streak</h3>
          <p class="meteor-effective">A small share of launches use a Gaussian streak centered here, on top of the bulk distribution.</p>
          <div class="meteor-chain" data-chain="spike">
            <NumberControl
              keyName="spikePosition"
              label="Streak center (s)"
              min={Math.min(settings.minDuration, settings.maxDuration)}
              max={Math.max(settings.minDuration, settings.maxDuration)}
              step={0.5}
              value={settings.spikePosition}
              onChange={(spikePosition) => setSettings("spikePosition", spikePosition)}
            />
            <NumberControl
              keyName="spikeVariance"
              label="Streak spread (s)"
              min={0.1}
              max={10}
              step={0.1}
              value={settings.spikeVariance}
              onChange={(spikeVariance) => setSettings("spikeVariance", spikeVariance)}
            />
            <NumberControl
              keyName="spikeShare"
              label="Streak share"
              min={0}
              max={1}
              step={0.05}
              value={settings.spikeShare}
              onChange={(spikeShare) => setSettings("spikeShare", spikeShare)}
            />
          </div>
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Bursts</h3>
          <NumberControl
            keyName="burstChance"
            label="Burst chance"
            min={0}
            max={1}
            step={0.05}
            value={settings.burstChance}
            onChange={(burstChance) => setSettings("burstChance", burstChance)}
          />
          <div class="meteor-chain" data-chain="burst-count">
            <NumberControl
              keyName="burstCountMin"
              label="Burst count min"
              min={1}
              max={settings.burstCountMax}
              value={settings.burstCountMin}
              onChange={burstCountMinUpdate}
            />
            <NumberControl
              keyName="burstCountMax"
              label="Burst count max"
              min={settings.burstCountMin}
              max={12}
              value={settings.burstCountMax}
              onChange={burstCountMaxUpdate}
            />
          </div>
          <NumberControl
            keyName="burstDurationMax"
            label="Burst pass max (s)"
            min={1}
            max={60}
            step={0.5}
            value={settings.burstDurationMax}
            onChange={(burstDurationMax) => setSettings("burstDurationMax", burstDurationMax)}
          />
          <div class="meteor-chain" data-chain="burst-gap">
            <NumberControl
              keyName="burstGapMin"
              label="Burst gap min (s)"
              min={0.02}
              max={settings.burstGapMax}
              step={0.02}
              value={settings.burstGapMin}
              onChange={burstGapMinUpdate}
            />
            <NumberControl
              keyName="burstGapMax"
              label="Burst gap max (s)"
              min={settings.burstGapMin}
              max={2}
              step={0.02}
              value={settings.burstGapMax}
              onChange={burstGapMaxUpdate}
            />
          </div>
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Cadence &amp; timing</h3>
          <div class="meteor-chain" data-chain="retarget">
            <NumberControl
              keyName="retargetIntervalMin"
              label="Retarget min (s)"
              min={1}
              max={settings.retargetIntervalMax}
              step={1}
              value={settings.retargetIntervalMin}
              onChange={retargetIntervalMinUpdate}
            />
            <NumberControl
              keyName="retargetIntervalMax"
              label="Retarget max (s)"
              min={settings.retargetIntervalMin}
              max={120}
              step={1}
              value={settings.retargetIntervalMax}
              onChange={retargetIntervalMaxUpdate}
            />
          </div>
          <div class="meteor-chain" data-chain="refill">
            <NumberControl
              keyName="refillGapMin"
              label="Refill gap min (s)"
              min={0.05}
              max={settings.refillGapMax}
              step={0.05}
              value={settings.refillGapMin}
              onChange={refillGapMinUpdate}
            />
            <NumberControl
              keyName="refillGapMax"
              label="Refill gap max (s)"
              min={settings.refillGapMin}
              max={5}
              step={0.05}
              value={settings.refillGapMax}
              onChange={refillGapMaxUpdate}
            />
          </div>
          <div class="meteor-chain" data-chain="idle">
            <NumberControl
              keyName="idleGapMin"
              label="Idle gap min (s)"
              min={0.1}
              max={settings.idleGapMax}
              step={0.1}
              value={settings.idleGapMin}
              onChange={idleGapMinUpdate}
            />
            <NumberControl
              keyName="idleGapMax"
              label="Idle gap max (s)"
              min={settings.idleGapMin}
              max={20}
              step={0.1}
              value={settings.idleGapMax}
              onChange={idleGapMaxUpdate}
            />
          </div>
          <NumberControl
            keyName="firstLaunchDelay"
            label="Initial delay max (s)"
            min={0}
            max={5}
            step={0.05}
            value={settings.firstLaunchDelay}
            onChange={(firstLaunchDelay) => setSettings("firstLaunchDelay", firstLaunchDelay)}
          />
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Trajectory &amp; geometry</h3>
          <NumberControl
            keyName="angle"
            label="Trajectory (°)"
            min={180}
            max={270}
            value={settings.angle}
            onChange={(angle) => setSettings("angle", angle)}
          />
          <NumberControl
            keyName="angleVariance"
            label="Trajectory spread (°)"
            min={0}
            max={30}
            step={0.5}
            value={settings.angleVariance}
            onChange={(angleVariance) => setSettings("angleVariance", angleVariance)}
          />
          <NumberControl
            keyName="travelMultiplier"
            label="Travel × viewport"
            min={0.25}
            max={2}
            step={0.05}
            value={settings.travelMultiplier}
            onChange={(travelMultiplier) => setSettings("travelMultiplier", travelMultiplier)}
          />
          <NumberControl
            keyName="entryOffset"
            label="Top entry offset (px)"
            min={0}
            max={200}
            value={settings.entryOffset}
            onChange={(entryOffset) => setSettings("entryOffset", entryOffset)}
          />
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Launch timing</h3>
          <LaunchHistogram
            durationSeconds={settings.durationSeconds}
            events={events()}
          />
        </section>

        <section class="meteor-section">
          <h3 class="meteor-section__title">Actions</h3>
          <div class="meteor-controls__actions">
            <button type="button" onClick={() => setRestartToken((t) => t + 1)}>Restart shower</button>
            <button type="button" onClick={() => setSettings(INITIAL)}>Reset to defaults</button>
            <button type="button" onClick={() => void copyConfiguration()}>{copyLabel()}</button>
            <button type="button" onClick={saveConfiguration}>Save to file</button>
            <label class="meteor-controls__button">
              {loadLabel()}
              <input accept="application/json,.json" hidden onChange={loadConfiguration} type="file" />
            </label>
          </div>
          <label class="meteor-config">
            <span>Implementation configuration</span>
            <textarea readOnly value={configuration()} />
          </label>
        </section>
      </aside>
    </div>
  );
};

render(() => <App />, document.getElementById("root")!);
