import {
  countChars,
  sliceAst,
  type DisplayBlock,
  type ParsedBlock,
} from "@incremark/core";
import type { IncremarkPacingMode } from "./incremark-pacing";

export const TYPEWRITER_FRAME_WORK_BUDGET_MS = 8;
export const TYPEWRITER_MIN_FRAME_BUDGET_MS = 2;
export const TYPEWRITER_DEFAULT_FRAME_INTERVAL_MS = 16;
export const TYPEWRITER_MIN_FRAME_INTERVAL_MS = 4;
export const TYPEWRITER_MAX_FRAME_INTERVAL_MS = 100;
export const TYPEWRITER_INITIAL_STEP = 32;
export const TYPEWRITER_MAX_STEP = 4096;
export const TYPEWRITER_MAX_CHARS_PER_FRAME = 8192;
export const TYPEWRITER_MAX_BLOCKS_PER_FRAME = 64;
export const TYPEWRITER_EMA_ALPHA = 0.25;
export const TYPEWRITER_FIXED_STEP = 32;
export const TYPEWRITER_ADAPTIVE_BACKLOG_WINDOW_MS = 250;
const TYPEWRITER_MATH_SOURCE = "__conduitMathSource";

export type TypewriterMetrics = {
  scheduler: IncremarkPacingMode;
  sourceVisibleCharacters: number;
  displayedVisibleCharacters: number;
  backlogCharacters: number;
  backlogAgeMs: number;
  pendingBlockCount: number;
  completedBlockCount: number;
  charsPerFrame: number;
  frameIntervalMs: number;
  frameBudgetMs: number;
  frameWorkMs: number;
  frameWorkEmaMs: number;
  terminal: boolean;
};

export function updateEma(previous: number | null, sample: number, alpha = TYPEWRITER_EMA_ALPHA) {
  if (!Number.isFinite(sample) || sample < 0) return previous;
  if (previous == null) return sample;
  return previous + alpha * (sample - previous);
}

export function normalizeFrameInterval(
  sample: number,
  fallback = TYPEWRITER_DEFAULT_FRAME_INTERVAL_MS,
) {
  if (!Number.isFinite(sample)
    || sample < TYPEWRITER_MIN_FRAME_INTERVAL_MS
    || sample > TYPEWRITER_MAX_FRAME_INTERVAL_MS) {
    return fallback;
  }
  return Math.min(TYPEWRITER_MAX_FRAME_INTERVAL_MS, Math.max(TYPEWRITER_MIN_FRAME_INTERVAL_MS, sample));
}

export function chooseFrameBudget(frameIntervalMs = TYPEWRITER_DEFAULT_FRAME_INTERVAL_MS) {
  const interval = normalizeFrameInterval(frameIntervalMs);
  return Math.min(
    TYPEWRITER_FRAME_WORK_BUDGET_MS,
    Math.max(TYPEWRITER_MIN_FRAME_BUDGET_MS, interval * 0.5),
  );
}

/** Select the next buffered work chunk from measured frame cost, not input rate. */
export function chooseBufferedStep(
  bufferedCharacters: number,
  previousStep: number,
  frameWorkMs: number,
  frameBudgetMs: number,
) {
  const available = Math.max(1, Math.trunc(bufferedCharacters));
  const current = Math.max(1, Math.trunc(previousStep) || 1);
  const budget = Math.max(TYPEWRITER_MIN_FRAME_BUDGET_MS, frameBudgetMs);
  if (frameWorkMs > budget) return Math.min(available, Math.max(1, Math.floor(current * 0.5)));
  if (frameWorkMs <= budget * 0.5) return Math.min(available, Math.min(TYPEWRITER_MAX_STEP, current * 2));
  return Math.min(available, current);
}

export function chooseFixedStep(availableCharacters: number) {
  return Math.min(Math.max(1, Math.trunc(availableCharacters)), TYPEWRITER_FIXED_STEP);
}

export function chooseAdaptiveStep(
  availableCharacters: number,
  observedRate: number | null,
  backlogCharacters: number,
  frameIntervalMs: number,
) {
  const available = Math.max(1, Math.trunc(availableCharacters));
  const catchUpRate = Math.max(0, backlogCharacters) / TYPEWRITER_ADAPTIVE_BACKLOG_WINDOW_MS * 1000;
  const targetRate = Math.max(0, observedRate || 0, catchUpRate);
  if (targetRate <= 0) return Math.min(available, TYPEWRITER_FIXED_STEP);
  const interval = normalizeFrameInterval(frameIntervalMs);
  return Math.min(available, Math.max(1, Math.min(TYPEWRITER_MAX_STEP, Math.ceil(targetRate * interval / 1000))));
}

// AST nodes are immutable once produced: every transform in this renderer
// returns a fresh object rather than editing one in place, so a node's
// character counts and its prepared form are cached against the node itself.
// That is what stops a streaming frame from re-walking the whole message for
// every accepted chunk, which is what made frame cost grow with message length.
const visibleCharacterCache = new WeakMap<object, number>();
const totalCharacterCache = new WeakMap<object, number>();
const preparedNodeCache = new WeakMap<object, any>();

export function visibleAstCharacters(node: any): number {
  if (!node || typeof node !== "object") return 0;
  const cached = visibleCharacterCache.get(node);
  if (cached !== undefined) return cached;
  let total = 0;
  if (node.type === "math" || node.type === "inlineMath") total = 1;
  else if (node.type === "image" || node.type === "imageReference") total = 0;
  else if (typeof node.value === "string") total = node.value.length;
  else if (Array.isArray(node.children)) {
    for (const child of node.children) total += visibleAstCharacters(child);
  }
  visibleCharacterCache.set(node, total);
  return total;
}

function totalAstCharacters(node: any): number {
  if (!node || typeof node !== "object") return Math.max(1, countChars(node));
  const cached = totalCharacterCache.get(node);
  if (cached !== undefined) return cached;
  const total = Math.max(1, countChars(node));
  totalCharacterCache.set(node, total);
  return total;
}

/**
 * The core math plugin treats formulas as one visible unit. Nested formulas
 * need the same contract before they enter the generic AST slicer. Keep their
 * source outside `value`; MathNode reads it from this private field.
 */
export function prepareTypewriterNode(node: any): any {
  if (!node || typeof node !== "object") return node;
  const cached = preparedNodeCache.get(node);
  if (cached !== undefined) return cached;
  const prepared = computePreparedTypewriterNode(node);
  preparedNodeCache.set(node, prepared);
  // The result is already in prepared form, so re-preparing it is a lookup.
  if (prepared !== node) preparedNodeCache.set(prepared, prepared);
  return prepared;
}

function computePreparedTypewriterNode(node: any): any {
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

function countVisibleBlocks(blocks: Array<{ node?: any; displayNode?: any }>, display = false) {
  let total = 0;
  for (const block of blocks) total += visibleAstCharacters(display ? block.displayNode : block.node);
  return total;
}

function smartMergeAst(baseNode: any, fullSlice: any): any {
  if (!baseNode || !fullSlice || baseNode.type !== fullSlice.type) return fullSlice;
  if (fullSlice.value !== undefined) return fullSlice;
  if (!Array.isArray(baseNode.children) || !Array.isArray(fullSlice.children)) return fullSlice;
  if (fullSlice.children.length < baseNode.children.length) return fullSlice;
  if (fullSlice.children.length === baseNode.children.length) {
    if (baseNode.children.length === 0) return fullSlice;
    const lastIndex = baseNode.children.length - 1;
    return {
      ...fullSlice,
      children: [
        ...baseNode.children.slice(0, lastIndex),
        smartMergeAst(baseNode.children[lastIndex], fullSlice.children[lastIndex]),
      ],
    };
  }
  const baseLastIndex = baseNode.children.length - 1;
  return {
    ...fullSlice,
    children: [
      ...baseNode.children.slice(0, baseLastIndex),
      smartMergeAst(baseNode.children[baseLastIndex], fullSlice.children[baseLastIndex]),
      ...fullSlice.children.slice(baseNode.children.length),
    ],
  };
}

function appendToAst(baseNode: any, sourceNode: any, endChars: number) {
  const fullSlice = sliceAst(sourceNode, endChars);
  return fullSlice ? smartMergeAst(baseNode, fullSlice) : baseNode;
}

function emptyDisplayNode(node: any): any {
  if (!node || typeof node !== "object") return { type: "paragraph", children: [] };
  if (Array.isArray(node.children)) return { ...node, children: [] };
  return { type: node.type || "paragraph", children: [] };
}

export type BufferedIncremarkTypewriterOptions = {
  onChange: (blocks: DisplayBlock[]) => void;
  onDisplayBusyChange?: (busy: boolean) => void;
  onMetrics?: (metrics: TypewriterMetrics) => void;
  pacing?: IncremarkPacingMode;
};

/**
 * A producer-consumer scheduler for incremental Markdown.
 *
 * Parser updates replace the source queue. The consumer drains complete
 * blocks and bounded partial slices on one rAF schedule. Buffered mode selects
 * work from measured frame cost; adaptive mode also uses the observed source
 * rate to catch up; fixed mode uses a stable chunk size. None of these modes
 * render outside the frame budget.
 */
export class BufferedIncremarkTypewriter {
  private readonly callbacks: BufferedIncremarkTypewriterOptions;
  private pacing: IncremarkPacingMode;
  private sourceBlocks: ParsedBlock[] = [];
  private progress = new Map<string, number>();
  private cachedDisplay = new Map<string, { node: any; progress: number; source: any }>();
  private baselineCharacters = 0;
  private enabled = false;
  private busy = false;
  private frameHandle: number | null = null;
  private lastFrameAt: number | null = null;
  private frameIntervalMs = TYPEWRITER_DEFAULT_FRAME_INTERVAL_MS;
  private currentStep = TYPEWRITER_INITIAL_STEP;
  private frameWorkMs = 0;
  private frameWorkEmaMs = 0;
  private observedRate: number | null = null;
  private lastObservedSourceCharacters = 0;
  private lastObservedSourceAt: number | null = null;
  private backlogStartedAt: number | null = null;
  private lastMetrics: TypewriterMetrics = {
    scheduler: "buffered",
    sourceVisibleCharacters: 0,
    displayedVisibleCharacters: 0,
    backlogCharacters: 0,
    backlogAgeMs: 0,
    pendingBlockCount: 0,
    completedBlockCount: 0,
    charsPerFrame: 0,
    frameIntervalMs: TYPEWRITER_DEFAULT_FRAME_INTERVAL_MS,
    frameBudgetMs: chooseFrameBudget(),
    frameWorkMs: 0,
    frameWorkEmaMs: 0,
    terminal: false,
  };
  private readonly publishedBlocks = new Map<string, DisplayBlock>();
  private terminalEmitted = false;
  // Blocks complete in order, so everything before this index is finished and
  // can never change again unless setSourceBlocks rewinds it. Keeping the
  // finished prefix as retained results -- rather than rebuilding, re-walking
  // and re-summing it on every frame -- is what stops per-frame cost growing
  // with message length. A long answer draws O(n) frames; when each of those
  // frames also touched all n blocks the total was quadratic.
  private completedPrefix = 0;
  /** The array as handed in, so an unchanged leading run can be recognised. */
  private sourceInputs: ParsedBlock[] = [];
  /** Running sums of visible characters over sourceBlocks. */
  private readonly sourceVisibleSums: number[] = [];
  private readonly completedDisplay: DisplayBlock[] = [];
  /** Running sums of visible characters over completedDisplay, for O(1) rewind. */
  private readonly completedVisibleSums: number[] = [];
  private sourceVisibleCharacters = 0;

  constructor(callbacks: BufferedIncremarkTypewriterOptions) {
    this.callbacks = callbacks;
    this.pacing = callbacks.pacing || "buffered";
  }

  setBaselineCharacters(characters: number) {
    this.baselineCharacters = Math.max(0, Math.trunc(characters));
    this.emitMetrics(performance.now(), false, 0, this.getDisplayBlocks());
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.scheduleFrame();
    else this.cancelFrame();
  }

  setPacing(mode: IncremarkPacingMode) {
    if (this.pacing === mode) return;
    this.pacing = mode;
    this.currentStep = mode === "fixed" ? TYPEWRITER_FIXED_STEP : TYPEWRITER_INITIAL_STEP;
    this.emitMetrics(performance.now(), false, 0, this.getDisplayBlocks());
    this.scheduleFrame();
  }

  observeSource(blocks: ParsedBlock[]) {
    const now = performance.now();
    const sourceCharacters = this.baselineCharacters + countVisibleBlocks(blocks);
    const elapsed = this.lastObservedSourceAt == null ? 0 : now - this.lastObservedSourceAt;
    const delta = sourceCharacters - this.lastObservedSourceCharacters;
    if (elapsed > 0 && delta > 0) this.observedRate = updateEma(this.observedRate, delta / elapsed * 1000);
    this.lastObservedSourceCharacters = sourceCharacters;
    this.lastObservedSourceAt = now;
    this.setSourceBlocks(blocks);
    this.scheduleFrame();
  }

  push(blocks: ParsedBlock[]) {
    this.setSourceBlocks(blocks);
    this.scheduleFrame();
  }

  reset() {
    this.cancelFrame();
    this.sourceBlocks = [];
    this.progress.clear();
    this.cachedDisplay.clear();
    this.publishedBlocks.clear();
    this.rewindCompleted(0);
    this.sourceInputs = [];
    this.sourceVisibleSums.length = 0;
    this.sourceVisibleCharacters = 0;
    this.baselineCharacters = 0;
    this.lastFrameAt = null;
    this.frameIntervalMs = TYPEWRITER_DEFAULT_FRAME_INTERVAL_MS;
    this.currentStep = TYPEWRITER_INITIAL_STEP;
    this.frameWorkMs = 0;
    this.frameWorkEmaMs = 0;
    this.observedRate = null;
    this.lastObservedSourceCharacters = this.baselineCharacters;
    this.lastObservedSourceAt = null;
    this.backlogStartedAt = null;
    this.terminalEmitted = false;
    this.setBusy(false);
    this.emitMetrics(performance.now(), false, 0, []);
  }

  seed(blocks: ParsedBlock[]) {
    this.reset();
    this.baselineCharacters = countVisibleBlocks(blocks);
    this.emitMetrics(performance.now(), false, 0, []);
  }

  flush() {
    for (const block of this.sourceBlocks) this.progress.set(block.id, this.blockCharacters(block));
    const display = this.getDisplayBlocks();
    this.setBusy(false);
    this.callbacks.onChange(display);
    this.emitMetrics(performance.now(), true, 0, display);
  }

  completeSeeded() {
    this.setBusy(false);
    this.emitMetrics(performance.now(), true, 0, []);
  }

  getDisplayBlocks() {
    return this.stabilizeDisplayBlocks(this.buildDisplayBlocks());
  }

  getMetrics() {
    return this.lastMetrics;
  }

  getDebugState() {
    const activeIndex = this.firstIncompleteIndex();
    const active = activeIndex >= 0 ? this.sourceBlocks[activeIndex] : null;
    const currentProgress = active ? this.progress.get(active.id) || 0 : 0;
    const currentTotal = active ? this.blockCharacters(active) : 0;
    return {
      processing: activeIndex >= 0,
      currentBlockId: active?.id ?? null,
      currentProgress,
      currentTotal,
      pendingBlockCount: activeIndex >= 0 ? Math.max(0, this.sourceBlocks.length - activeIndex - 1) : 0,
      completedBlockCount: activeIndex >= 0 ? activeIndex : this.sourceBlocks.length,
    };
  }

  destroy() {
    this.cancelFrame();
    this.publishedBlocks.clear();
    this.rewindCompleted(0);
    this.sourceInputs = [];
    this.sourceVisibleSums.length = 0;
    this.sourceVisibleCharacters = 0;
    this.sourceBlocks = [];
    this.progress.clear();
    this.cachedDisplay.clear();
    this.setBusy(false);
  }

  /**
   * Take a parser update.
   *
   * A delta changes the tail of the document, so the blocks before it arrive as
   * the very same objects the previous call was given. Recognising that run and
   * leaving it alone is what makes this cost the size of the change rather than
   * the size of the message -- the difference between a long answer costing
   * O(n) and O(n^2) overall.
   */
  private setSourceBlocks(blocks: ParsedBlock[]) {
    let shared = 0;
    const limit = Math.min(blocks.length, this.sourceInputs.length);
    while (shared < limit && blocks[shared] === this.sourceInputs[shared]) shared += 1;

    const changedIds = new Set<string>();
    for (let index = shared; index < blocks.length; index += 1) changedIds.add(blocks[index]!.id);
    // Only a block that has left the tail can be dropped: the shared run keeps
    // every id it had.
    for (let index = shared; index < this.sourceBlocks.length; index += 1) {
      const id = this.sourceBlocks[index]!.id;
      if (changedIds.has(id)) continue;
      this.progress.delete(id);
      this.cachedDisplay.delete(id);
      this.publishedBlocks.delete(id);
    }

    let firstChangedIndex = blocks.length < this.sourceBlocks.length ? blocks.length : -1;
    const previousById = new Map<string, ParsedBlock>();
    for (let index = shared; index < this.sourceBlocks.length; index += 1) {
      const entry = this.sourceBlocks[index]!;
      previousById.set(entry.id, entry);
    }
    const prepared = this.sourceBlocks.slice(0, shared);
    prepared.length = blocks.length;
    this.sourceVisibleSums.length = blocks.length;
    for (let index = shared; index < blocks.length; index += 1) {
      const input = blocks[index]!;
      const node = prepareTypewriterNode(input.node);
      const block = node === input.node ? input : { ...input, node } as ParsedBlock;
      prepared[index] = block;
      this.sourceVisibleSums[index] = (index > 0 ? this.sourceVisibleSums[index - 1]! : 0)
        + visibleAstCharacters(block.node);
      const previous = previousById.get(block.id);
      if (!previous || previous.node !== block.node) {
        const previousProgress = this.progress.get(block.id) || 0;
        this.progress.set(block.id, Math.min(previousProgress, this.blockCharacters(block)));
        this.cachedDisplay.delete(block.id);
        if (firstChangedIndex < 0) firstChangedIndex = index;
      }
      // A block that kept its id and node can still have moved. The retained
      // prefix is positional, so a reorder has to rewind it too.
      if (firstChangedIndex < 0 && this.sourceBlocks[index]?.id !== block.id) firstChangedIndex = index;
    }
    this.sourceVisibleCharacters = blocks.length ? this.sourceVisibleSums[blocks.length - 1]! : 0;
    this.sourceInputs = blocks;
    this.sourceBlocks = prepared as ParsedBlock[];
    if (firstChangedIndex >= 0 && firstChangedIndex < this.completedPrefix) {
      this.rewindCompleted(firstChangedIndex);
    }
    const active = this.firstIncompleteIndex() >= 0;
    if (active && this.backlogStartedAt == null) this.backlogStartedAt = performance.now();
    if (!active) this.backlogStartedAt = null;
    this.setBusy(active);
    this.terminalEmitted = false;
  }

  private scheduleFrame() {
    if (!this.enabled || this.frameHandle != null || typeof requestAnimationFrame !== "function") return;
    this.frameHandle = requestAnimationFrame((timestamp) => {
      this.frameHandle = null;
      this.drainFrame(timestamp);
      if (this.firstIncompleteIndex() >= 0) this.scheduleFrame();
    });
  }

  private cancelFrame() {
    if (this.frameHandle != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
  }

  private drainFrame(timestamp: number) {
    if (this.lastFrameAt != null) {
      this.frameIntervalMs = normalizeFrameInterval(timestamp - this.lastFrameAt, this.frameIntervalMs);
    }
    this.lastFrameAt = timestamp;
    const frameBudgetMs = chooseFrameBudget(this.frameIntervalMs);
    const startedAt = performance.now();
    let accepted = this.getDisplayBlocks();
    const sourceCharacters = this.baselineCharacters + this.sourceVisibleCharacters;
    let displayedCharacters = this.baselineCharacters + this.displayedVisibleCharacters(accepted);
    let processedCharacters = 0;
    let processedBlocks = 0;
    let acceptedProgress = false;

    while (processedCharacters < TYPEWRITER_MAX_CHARS_PER_FRAME
      && processedBlocks < TYPEWRITER_MAX_BLOCKS_PER_FRAME) {
      const activeIndex = this.firstIncompleteIndex();
      if (activeIndex < 0) break;
      const block = this.sourceBlocks[activeIndex]!;
      const total = this.blockCharacters(block);
      const current = this.progress.get(block.id) || 0;
      const remaining = Math.max(0, total - current);
      if (remaining <= 0) continue;
      const step = Math.min(
        remaining,
        TYPEWRITER_MAX_CHARS_PER_FRAME - processedCharacters,
        this.chooseStep(remaining, sourceCharacters - displayedCharacters, frameBudgetMs),
      );
      if (step <= 0) break;
      const nextProgress = current + step;
      this.progress.set(block.id, nextProgress);
      const candidate = this.getDisplayBlocks();
      const elapsed = performance.now() - startedAt;
      if (elapsed > frameBudgetMs && processedCharacters > 0) {
        this.progress.set(block.id, current);
        break;
      }
      accepted = candidate;
      displayedCharacters = this.baselineCharacters + this.displayedVisibleCharacters(accepted);
      acceptedProgress = true;
      processedCharacters += step;
      if (nextProgress >= total) processedBlocks += 1;
      if (elapsed >= frameBudgetMs) break;
    }

    if (!acceptedProgress && this.firstIncompleteIndex() >= 0) {
      const active = this.sourceBlocks[this.firstIncompleteIndex()]!;
      const current = this.progress.get(active.id) || 0;
      const next = Math.min(this.blockCharacters(active), current + 1);
      this.progress.set(active.id, next);
      accepted = this.getDisplayBlocks();
      processedCharacters = Math.max(1, next - current);
    }

    this.callbacks.onChange(accepted);
    const frameWorkMs = Math.max(0, performance.now() - startedAt);
    this.frameWorkMs = frameWorkMs;
    this.frameWorkEmaMs = updateEma(this.frameWorkEmaMs, frameWorkMs) || frameWorkMs;
    if (frameWorkMs > frameBudgetMs) {
      this.currentStep = Math.max(1, Math.floor(this.currentStep * 0.5));
    } else if (frameWorkMs <= frameBudgetMs * 0.5) {
      this.currentStep = Math.min(TYPEWRITER_MAX_STEP, Math.max(1, this.currentStep * 2));
    }
    const pending = this.firstIncompleteIndex() >= 0;
    if (!pending) {
      this.backlogStartedAt = null;
      this.setBusy(false);
    } else if (this.backlogStartedAt == null) {
      this.backlogStartedAt = performance.now();
      this.setBusy(true);
    }
    const terminal = !pending && !this.terminalEmitted;
    if (terminal) this.terminalEmitted = true;
    this.emitMetrics(performance.now(), terminal, processedCharacters, accepted, frameBudgetMs);
  }

  private chooseStep(availableCharacters: number, backlogCharacters: number, frameBudgetMs: number) {
    if (this.pacing === "fixed") return chooseFixedStep(availableCharacters);
    if (this.pacing === "adaptive") {
      return chooseAdaptiveStep(availableCharacters, this.observedRate, backlogCharacters, this.frameIntervalMs);
    }
    return chooseBufferedStep(availableCharacters, this.currentStep, this.frameWorkMs, frameBudgetMs);
  }

  private emitMetrics(
    now: number,
    terminal: boolean,
    charsPerFrame: number,
    display: DisplayBlock[],
    frameBudgetMs = chooseFrameBudget(this.frameIntervalMs),
  ) {
    const sourceVisibleCharacters = this.baselineCharacters + this.sourceVisibleCharacters;
    const displayedVisibleCharacters = this.baselineCharacters + this.displayedVisibleCharacters(display);
    const backlogCharacters = Math.max(0, sourceVisibleCharacters - displayedVisibleCharacters);
    const activeIndex = this.firstIncompleteIndex();
    this.lastMetrics = {
      scheduler: this.pacing,
      sourceVisibleCharacters,
      displayedVisibleCharacters,
      backlogCharacters,
      backlogAgeMs: this.backlogStartedAt == null ? 0 : Math.max(0, now - this.backlogStartedAt),
      pendingBlockCount: activeIndex >= 0 ? Math.max(0, this.sourceBlocks.length - activeIndex) : 0,
      completedBlockCount: activeIndex >= 0 ? activeIndex : this.sourceBlocks.length,
      charsPerFrame,
      frameIntervalMs: this.frameIntervalMs,
      frameBudgetMs,
      frameWorkMs: this.frameWorkMs,
      frameWorkEmaMs: this.frameWorkEmaMs,
      terminal,
    };
    this.callbacks.onMetrics?.(this.lastMetrics);
  }

  private rewindCompleted(index: number) {
    this.completedPrefix = index;
    this.completedDisplay.length = index;
    this.completedVisibleSums.length = index;
  }

  private completedVisibleCharacters() {
    return this.completedVisibleSums[this.completedVisibleSums.length - 1] ?? 0;
  }

  /**
   * Freeze a finished block's published result.
   *
   * Its node cannot change again, so the stabilise decision it would get on
   * every later frame is the one it gets here, once.
   */
  private retireCompletedBlock(block: ParsedBlock) {
    const display = this.stabilizeDisplayBlock({
      ...block,
      status: "completed",
      displayNode: block.node,
      progress: 1,
      isDisplayComplete: true,
    } as DisplayBlock);
    this.completedDisplay.push(display);
    this.completedVisibleSums.push(this.completedVisibleCharacters() + visibleAstCharacters(display.displayNode));
  }

  private firstIncompleteIndex() {
    while (this.completedPrefix < this.sourceBlocks.length) {
      const block = this.sourceBlocks[this.completedPrefix]!;
      if ((this.progress.get(block.id) || 0) < this.blockCharacters(block)) return this.completedPrefix;
      this.retireCompletedBlock(block);
      this.completedPrefix += 1;
    }
    return -1;
  }

  /**
   * The retained prefix already knows its own total, so only the active block
   * -- the one entry that changes between frames -- has to be walked.
   */
  private displayedVisibleCharacters(display: DisplayBlock[]) {
    if (!display.length) return 0;
    const last = display[display.length - 1]!;
    const activeCharacters = last.isDisplayComplete ? 0 : visibleAstCharacters(last.displayNode);
    const retained = last.isDisplayComplete
      ? this.completedVisibleSums[display.length - 1] ?? 0
      : this.completedVisibleSums[display.length - 2] ?? 0;
    return retained + activeCharacters;
  }

  private blockCharacters(block: ParsedBlock) {
    return totalAstCharacters(block.node);
  }

  private buildDisplayBlocks(): DisplayBlock[] {
    const activeIndex = this.firstIncompleteIndex();
    const display = this.completedDisplay.slice();
    if (activeIndex < 0) return display;
    const active = this.sourceBlocks[activeIndex]!;
    const total = this.blockCharacters(active);
    const progress = Math.min(total, this.progress.get(active.id) || 0);
    const cached = this.cachedDisplay.get(active.id);
    let displayNode: any;
    if (progress <= 0) {
      displayNode = emptyDisplayNode(active.node);
    } else if (cached && cached.source === active.node && progress >= cached.progress) {
      displayNode = appendToAst(cached.node, active.node, progress);
    } else {
      displayNode = sliceAst(active.node, progress) || emptyDisplayNode(active.node);
    }
    this.cachedDisplay.set(active.id, { node: displayNode, progress, source: active.node });
    display.push({
      ...active,
      status: "pending",
      displayNode,
      progress: total > 0 ? progress / total : 1,
      isDisplayComplete: false,
    } as DisplayBlock);
    return display;
  }

  /**
   * Hold the last non-empty render of a block that momentarily slices to
   * nothing, so a reparse cannot blank a paragraph that is already on screen.
   */
  private stabilizeDisplayBlock(block: DisplayBlock) {
    const previous = this.publishedBlocks.get(block.id);
    const previousNode = previous?.displayNode;
    const currentNode = block.displayNode;
    const previousCharacters = visibleAstCharacters(previousNode);
    const currentCharacters = visibleAstCharacters(currentNode);
    const previousRawText = String((previous as DisplayBlock & { rawText?: string })?.rawText ?? "");
    const currentRawText = String((block as DisplayBlock & { rawText?: string })?.rawText ?? "");
    const sourceDidNotShrink = !previousRawText || !currentRawText || currentRawText.length >= previousRawText.length;
    const sameStructuralNode = previousNode?.type === currentNode?.type;
    const preservesEmptyStructuralNode = sameStructuralNode
      && ["paragraph", "heading", "table"].includes(String(previousNode?.type));
    const next = previous && previousNode && currentCharacters === 0 && sourceDidNotShrink
      && (previousCharacters > 0 || preservesEmptyStructuralNode)
      ? { ...block, displayNode: previousNode } as DisplayBlock
      : block;
    this.publishedBlocks.set(next.id, next);
    return next;
  }

  /**
   * Only the last entry can be new. Everything before it was stabilised and
   * published when it was retired, and re-deciding it each frame produced the
   * same answer at a cost that grew with the message.
   */
  private stabilizeDisplayBlocks(blocks: DisplayBlock[]) {
    const last = blocks.length - 1;
    if (last < 0) return blocks;
    const active = blocks[last]!;
    if (active.isDisplayComplete) return blocks;
    blocks[last] = this.stabilizeDisplayBlock(active);
    return blocks;
  }

  private setBusy(next: boolean) {
    if (next === this.busy) return;
    this.busy = next;
    this.callbacks.onDisplayBusyChange?.(next);
  }
}
