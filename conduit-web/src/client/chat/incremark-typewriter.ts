import {
  createBlockTransformer,
  mathPlugin,
  type DisplayBlock,
  type ParsedBlock,
} from "@incremark/core";

export const TYPEWRITER_LAG_FRACTION = 0.10;
export const TYPEWRITER_BACKLOG_WINDOW_MS = 250;
export const TYPEWRITER_EMA_ALPHA = 0.25;
export const TYPEWRITER_FRAME_WORK_BUDGET_MS = 8;
export const TYPEWRITER_DEFAULT_TICK_INTERVAL_MS = 16;
export const TYPEWRITER_RELAXED_TICK_INTERVAL_MS = 33;
export const TYPEWRITER_MIN_FRAME_INTERVAL_MS = 4;
export const TYPEWRITER_MAX_FRAME_INTERVAL_MS = TYPEWRITER_RELAXED_TICK_INTERVAL_MS;
export const TYPEWRITER_FRAME_INTERVAL_EMA_ALPHA = 0.25;
export const TYPEWRITER_LAG_CORRECTION_WINDOW_MS = 100;
export type TypewriterFallbackMode = "normal" | "safe-step" | "safe-block";
const TYPEWRITER_MATH_SOURCE = "__conduitMathSource";

export type TypewriterMetrics = {
  sourceVisibleCharacters: number;
  displayedVisibleCharacters: number;
  backlogCharacters: number;
  backlogAgeMs: number;
  observedRate: number | null;
  targetRate: number;
  controlRate: number;
  displayRate: number | null;
  relativeLag: number | null;
  charsPerTick: number;
  frameIntervalMs: number;
  tickInterval: number;
  frameWorkMs: number;
  frameWorkEmaMs: number;
  fallbackMode: TypewriterFallbackMode;
  lagTargetMet: boolean;
};

export type AdaptiveRate = {
  leadRate: number;
  catchUpRate: number;
  targetRate: number;
};

export function updateRateEma(previous: number | null, sample: number, alpha = TYPEWRITER_EMA_ALPHA) {
  if (!Number.isFinite(sample) || sample < 0) return previous;
  if (previous == null) return sample;
  return previous + alpha * (sample - previous);
}

export function calculateAdaptiveRate(
  observedRate: number | null,
  backlogCharacters: number,
  lagFraction = TYPEWRITER_LAG_FRACTION,
  backlogWindowMs = TYPEWRITER_BACKLOG_WINDOW_MS,
): AdaptiveRate {
  const leadRate = observedRate != null && observedRate > 0
    ? observedRate / Math.max(0.001, 1 - lagFraction)
    : 0;
  const catchUpRate = Math.max(0, backlogCharacters) / Math.max(1, backlogWindowMs) * 1000;
  return {
    leadRate,
    catchUpRate,
    targetRate: Math.max(leadRate, catchUpRate),
  };
}

/** Keep pace with new output while draining the existing backlog. */
export function calculateControlRate(
  observedRate: number | null,
  backlogCharacters: number,
  lagFraction = TYPEWRITER_LAG_FRACTION,
  backlogWindowMs = TYPEWRITER_BACKLOG_WINDOW_MS,
  sourceVisibleCharacters: number | null = null,
) {
  const adaptive = calculateAdaptiveRate(observedRate, backlogCharacters, lagFraction, backlogWindowMs);
  const sustainableRate = Math.max(0, observedRate || 0) + adaptive.catchUpRate;
  const lagBudget = sourceVisibleCharacters != null
    ? Math.max(0, sourceVisibleCharacters) * lagFraction
    : 0;
  const excessBacklog = sourceVisibleCharacters != null
    ? Math.max(0, backlogCharacters - lagBudget)
    : 0;
  const lagCorrectionRate = excessBacklog / TYPEWRITER_LAG_CORRECTION_WINDOW_MS * 1000;
  const correctionRate = Math.max(0, observedRate || 0) + lagCorrectionRate;
  return Math.max(adaptive.targetRate, sustainableRate, correctionRate);
}

export function calculateBacklogAgeMs(backlogCharacters: number, observedRate: number | null) {
  if (backlogCharacters <= 0 || observedRate == null || observedRate <= 0) return 0;
  return Math.max(0, backlogCharacters) / observedRate * 1000;
}

export function normalizeFrameInterval(sample: number, fallback = TYPEWRITER_DEFAULT_TICK_INTERVAL_MS) {
  if (!Number.isFinite(sample) || sample < TYPEWRITER_MIN_FRAME_INTERVAL_MS || sample > 100) {
    return fallback;
  }
  return Math.min(TYPEWRITER_MAX_FRAME_INTERVAL_MS, Math.max(TYPEWRITER_MIN_FRAME_INTERVAL_MS, sample));
}

export function updateFrameInterval(
  previous: number | null,
  sample: number,
  alpha = TYPEWRITER_FRAME_INTERVAL_EMA_ALPHA,
) {
  const normalized = normalizeFrameInterval(sample, previous ?? TYPEWRITER_DEFAULT_TICK_INTERVAL_MS);
  if (previous == null) return normalized;
  return normalizeFrameInterval(updateRateEma(previous, normalized, alpha) || normalized, normalized);
}

export function chooseTickInterval(
  frameWorkEmaMs: number,
  frameIntervalMs = TYPEWRITER_DEFAULT_TICK_INTERVAL_MS,
) {
  const frameInterval = normalizeFrameInterval(frameIntervalMs);
  const workMultiplier = frameWorkEmaMs > TYPEWRITER_FRAME_WORK_BUDGET_MS ? 2 : 1;
  return Math.min(TYPEWRITER_MAX_FRAME_INTERVAL_MS, frameInterval * workMultiplier);
}

export function chooseCharsPerTick(
  targetRate: number,
  tickInterval: number,
  previousStep: number,
  frameWorkMs: number,
  frameWorkBudgetMs = TYPEWRITER_FRAME_WORK_BUDGET_MS,
  allowGrowth = true,
) {
  const desiredStep = Math.max(1, Math.ceil(Math.max(0, targetRate) * tickInterval / 1000));
  const currentStep = Math.max(1, Math.trunc(previousStep) || 1);
  if (!allowGrowth) return Math.min(desiredStep, currentStep);
  if (!Number.isFinite(frameWorkMs) || frameWorkMs <= 0) {
    return Math.min(desiredStep, Math.max(currentStep, currentStep * 4));
  }
  if (frameWorkMs > frameWorkBudgetMs) {
    return Math.max(1, Math.min(desiredStep, Math.floor(currentStep * frameWorkBudgetMs / frameWorkMs)));
  }
  return Math.min(desiredStep, Math.max(currentStep, currentStep * 4));
}

export function chooseFallbackMode(
  frameWorkEmaMs: number,
  charsPerTick: number,
  blockFallbackActive = false,
): TypewriterFallbackMode {
  if (blockFallbackActive) return "safe-block";
  if (frameWorkEmaMs > TYPEWRITER_FRAME_WORK_BUDGET_MS && charsPerTick <= 1) return "safe-step";
  return "normal";
}

export function visibleAstCharacters(node: any): number {
  if (!node) return 0;
  if (node.type === "math" || node.type === "inlineMath") return 1;
  if (node.type === "image" || node.type === "imageReference") return 0;
  if (typeof node.value === "string") return node.value.length;
  if (!Array.isArray(node.children)) return 0;
  return node.children.reduce((total: number, child: any) => total + visibleAstCharacters(child), 0);
}

/**
 * The core math plugin handles a math block only when math is the block root.
 * Markdown paragraphs and table cells are sliced by the generic AST path, so
 * nested math would otherwise be exposed one source character at a time.
 * Store its source outside `value`; the core then treats the node as a leaf.
 */
export function prepareTypewriterNode(node: any): any {
  if (!node || typeof node !== "object") return node;
  if (node.type === "math" || node.type === "inlineMath") {
    if (Object.prototype.hasOwnProperty.call(node, TYPEWRITER_MATH_SOURCE)) return node;
    const { value, ...rest } = node;
    return { ...rest, [TYPEWRITER_MATH_SOURCE]: String(value || "") };
  }
  if (!Array.isArray(node.children)) return node;
  let changed = false;
  const children = node.children.map((child: any) => {
    const prepared = prepareTypewriterNode(child);
    changed ||= prepared !== child;
    return prepared;
  });
  return changed ? { ...node, children } : node;
}

export function prepareTypewriterBlocks<T extends { node: any }>(blocks: T[]): T[] {
  return blocks.map((block) => {
    const node = prepareTypewriterNode(block.node);
    return node === block.node ? block : { ...block, node };
  });
}

function mathSource(node: any) {
  return String(node?.[TYPEWRITER_MATH_SOURCE] ?? node?.value ?? "");
}

function visibleBlockCharacters(blocks: Array<{ node?: any; displayNode?: any }>, display = false) {
  return blocks.reduce((total, block) => total + visibleAstCharacters(display ? block.displayNode : block.node), 0);
}

export type AdaptiveIncremarkTypewriterOptions = {
  onChange: (blocks: DisplayBlock[]) => void;
  onDisplayBusyChange?: (busy: boolean) => void;
  onMetrics?: (metrics: TypewriterMetrics) => void;
};

/**
 * Adaptive pacing around Incremark's native block transformer.
 *
 * The transformer remains the owner of rAF scheduling, block queues, AST
 * slicing, cached display nodes, and hidden-tab pausing. This class only
 * supplies source-rate feedback and frame-work limits.
 */
export class AdaptiveIncremarkTypewriter {
  readonly transformer;
  private readonly callbacks: AdaptiveIncremarkTypewriterOptions;
  private baselineCharacters = 0;
  private sourceVisibleCharacters = 0;
  private observedRate: number | null = null;
  private lastSourceCharacters = 0;
  private lastSourceAt: number | null = null;
  private lastDisplayedCharacters = 0;
  private lastDisplayedAt: number | null = null;
  private currentStep = 1;
  private frameWorkMs = 0;
  private frameWorkEmaMs = 0;
  private overBudgetFrames = 0;
  private fallbackInProgress = false;
  private lastFallbackMode: TypewriterFallbackMode = "normal";
  private busy = false;
  private enabled = false;
  private frameProbeId: number | null = null;
  private lastFrameAt: number | null = null;
  private frameIntervalMs = TYPEWRITER_DEFAULT_TICK_INTERVAL_MS;
  private frameIntervalEmaMs = TYPEWRITER_DEFAULT_TICK_INTERVAL_MS;
  private metrics: TypewriterMetrics = {
    sourceVisibleCharacters: 0,
    displayedVisibleCharacters: 0,
    backlogCharacters: 0,
    backlogAgeMs: 0,
    observedRate: null,
    targetRate: 0,
    controlRate: 0,
    displayRate: null,
    relativeLag: null,
    charsPerTick: 1,
    frameIntervalMs: TYPEWRITER_DEFAULT_TICK_INTERVAL_MS,
    tickInterval: TYPEWRITER_DEFAULT_TICK_INTERVAL_MS,
    frameWorkMs: 0,
    frameWorkEmaMs: 0,
    fallbackMode: "normal",
    lagTargetMet: true,
  };

  constructor(callbacks: AdaptiveIncremarkTypewriterOptions) {
    this.callbacks = callbacks;
    this.transformer = createBlockTransformer({
      charsPerTick: 1,
      tickInterval: TYPEWRITER_DEFAULT_TICK_INTERVAL_MS,
      effect: "none",
      pauseOnHidden: true,
      plugins: [mathPlugin],
      onChange: (blocks) => {
        if (this.fallbackInProgress && blocks.length === 0) return;
        const startedAt = performance.now();
        callbacks.onChange(blocks);
        this.recordDisplay(blocks, performance.now() - startedAt);
      },
      onAllComplete: () => {
        this.setBusy(false);
        this.emitMetrics(performance.now());
      },
    });
  }

  setBaselineCharacters(characters: number) {
    this.baselineCharacters = Math.max(0, Math.trunc(characters));
    this.recalculate(performance.now());
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.scheduleFrameProbe();
    else this.stopFrameProbe();
  }

  observeSource(blocks: ParsedBlock[], now = performance.now()) {
    const sourceCharacters = this.baselineCharacters + visibleBlockCharacters(blocks);
    const elapsed = this.lastSourceAt == null ? 0 : now - this.lastSourceAt;
    const delta = sourceCharacters - this.lastSourceCharacters;
    if (elapsed > 0 && delta > 0) {
      this.observedRate = updateRateEma(this.observedRate, delta / elapsed * 1000);
    }
    this.lastSourceAt = now;
    this.lastSourceCharacters = sourceCharacters;
    this.sourceVisibleCharacters = sourceCharacters;
    this.recalculate(now, this.lastDisplayedCharacters, this.metrics.displayRate, true);
  }

  push(blocks: ParsedBlock[]) {
    this.transformer.push(prepareTypewriterBlocks(blocks));
    this.recalculate(performance.now());
  }

  reset() {
    this.transformer.reset();
    this.sourceVisibleCharacters = this.baselineCharacters;
    this.lastSourceCharacters = this.baselineCharacters;
    this.lastSourceAt = null;
    this.observedRate = null;
    this.lastDisplayedCharacters = this.baselineCharacters;
    this.lastDisplayedAt = null;
    this.setBusy(false);
    this.recalculate(performance.now());
  }

  seed(blocks: ParsedBlock[]) {
    this.reset();
    this.baselineCharacters = visibleBlockCharacters(blocks);
    this.sourceVisibleCharacters = this.baselineCharacters;
    this.lastSourceCharacters = this.baselineCharacters;
    this.lastDisplayedCharacters = this.baselineCharacters;
    this.setBusy(false);
    this.recalculate(performance.now());
  }

  flush() {
    this.transformer.skip();
    this.setBusy(false);
    this.recalculate(performance.now());
  }

  getDisplayBlocks() {
    return this.transformer.getDisplayBlocks();
  }

  getMetrics() {
    return this.metrics;
  }

  destroy() {
    this.stopFrameProbe();
    this.transformer.destroy();
  }

  private scheduleFrameProbe() {
    if (!this.enabled || this.frameProbeId != null || typeof requestAnimationFrame !== "function") return;
    this.frameProbeId = requestAnimationFrame((timestamp) => {
      this.frameProbeId = null;
      if (!this.enabled) return;
      if (this.lastFrameAt != null) {
        const gap = timestamp - this.lastFrameAt;
        if (gap >= TYPEWRITER_MIN_FRAME_INTERVAL_MS && gap <= 100) {
          const next = updateFrameInterval(this.frameIntervalEmaMs, gap);
          if (Math.abs(next - this.frameIntervalMs) >= 0.1) {
            this.frameIntervalMs = next;
            this.frameIntervalEmaMs = next;
            this.recalculate(timestamp);
          } else {
            this.frameIntervalEmaMs = next;
          }
        }
      }
      this.lastFrameAt = timestamp;
      this.scheduleFrameProbe();
    });
  }

  private stopFrameProbe() {
    if (this.frameProbeId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameProbeId);
    }
    this.frameProbeId = null;
    this.lastFrameAt = null;
  }

  private recordDisplay(blocks: DisplayBlock[], frameWorkMs: number) {
    const now = performance.now();
    const displayedCharacters = this.baselineCharacters + visibleBlockCharacters(blocks, true);
    const elapsed = this.lastDisplayedAt == null ? 0 : now - this.lastDisplayedAt;
    const delta = displayedCharacters - this.lastDisplayedCharacters;
    const displayRate = elapsed > 0 && delta > 0 ? delta / elapsed * 1000 : this.metrics.displayRate;
    this.lastDisplayedAt = now;
    this.lastDisplayedCharacters = displayedCharacters;
    this.frameWorkMs = Math.max(0, frameWorkMs);
    this.frameWorkEmaMs = this.frameWorkEmaMs === 0
      ? this.frameWorkMs
      : updateRateEma(this.frameWorkEmaMs, this.frameWorkMs) || this.frameWorkMs;
    this.overBudgetFrames = this.frameWorkEmaMs > TYPEWRITER_FRAME_WORK_BUDGET_MS
      ? this.overBudgetFrames + 1
      : 0;
    if (this.overBudgetFrames === 0) this.lastFallbackMode = "normal";
    this.setBusy(this.sourceVisibleCharacters > displayedCharacters || this.transformer.isProcessing());
    if (this.overBudgetFrames >= 3 && this.sourceVisibleCharacters > displayedCharacters) {
      this.completeCurrentBlockSafely();
    }
    this.recalculate(now, displayedCharacters, displayRate, true);
  }

  private setBusy(next: boolean) {
    if (next === this.busy) return;
    this.busy = next;
    this.callbacks.onDisplayBusyChange?.(next);
  }

  private recalculate(
    now: number,
    displayedCharacters = this.lastDisplayedCharacters,
    displayRate = this.metrics.displayRate,
    allowStepGrowth = false,
  ) {
    const backlogCharacters = Math.max(0, this.sourceVisibleCharacters - displayedCharacters);
    const adaptive = calculateAdaptiveRate(this.observedRate, backlogCharacters);
    const controlRate = calculateControlRate(this.observedRate, backlogCharacters, undefined, undefined, this.sourceVisibleCharacters);
    const tickInterval = chooseTickInterval(this.frameWorkEmaMs, this.frameIntervalMs);
    const nextStep = chooseCharsPerTick(
      controlRate,
      tickInterval,
      this.currentStep,
      this.frameWorkMs,
      TYPEWRITER_FRAME_WORK_BUDGET_MS,
      allowStepGrowth,
    );
    this.currentStep = nextStep;
    this.transformer.setOptions({ charsPerTick: nextStep, tickInterval });
    const backlogAgeMs = calculateBacklogAgeMs(backlogCharacters, this.observedRate);
    const relativeLag = this.sourceVisibleCharacters > 0
      ? backlogCharacters / this.sourceVisibleCharacters
      : 0;
    const fallbackMode = chooseFallbackMode(this.frameWorkEmaMs, nextStep, this.lastFallbackMode === "safe-block");
    this.metrics = {
      sourceVisibleCharacters: this.sourceVisibleCharacters,
      displayedVisibleCharacters: displayedCharacters,
      backlogCharacters,
      backlogAgeMs,
      observedRate: this.observedRate,
      targetRate: adaptive.targetRate,
      controlRate,
      displayRate,
      relativeLag,
      charsPerTick: nextStep,
      frameIntervalMs: this.frameIntervalMs,
      tickInterval,
      frameWorkMs: this.frameWorkMs,
      frameWorkEmaMs: this.frameWorkEmaMs,
      fallbackMode,
      lagTargetMet: backlogCharacters === 0 || (relativeLag <= TYPEWRITER_LAG_FRACTION && backlogAgeMs <= TYPEWRITER_BACKLOG_WINDOW_MS),
    };
    this.callbacks.onMetrics?.(this.metrics);
  }

  /**
   * Complete only the active native block, then return the remaining blocks
   * to the native queue. BlockTransformer exposes skip() for the whole queue,
   * so preserve the completed and pending slices around a temporary reset.
   */
  private completeCurrentBlockSafely() {
    if (this.fallbackInProgress) return;
    const state = this.transformer.getState();
    if (!state.currentBlock) return;
    this.fallbackInProgress = true;
    this.lastFallbackMode = "safe-block";
    const completed = [...state.completedBlocks, state.currentBlock];
    const pending = [...state.pendingBlocks];
    this.transformer.reset();
    this.transformer.push(completed);
    this.transformer.skip();
    if (pending.length) this.transformer.push(pending);
    this.fallbackInProgress = false;
    this.overBudgetFrames = 0;
  }

  private emitMetrics(now: number) {
    this.recalculate(now);
  }
}
