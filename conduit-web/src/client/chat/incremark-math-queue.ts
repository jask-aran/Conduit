export type MathRenderPolicy = "stream" | "reattach";

export const MATH_RENDER_STREAM_FRAME_BUDGET_MS = 4;
export const MATH_RENDER_REATTACH_FRAME_BUDGET_MS = 8;
export const MATH_RENDER_STREAM_MAX_JOBS_PER_FRAME = 4;
export const MATH_RENDER_REATTACH_MAX_JOBS_PER_FRAME = 12;

export type MathRenderQueueMetric = {
  event: "enqueue" | "cancel" | "frame";
  policy: MathRenderPolicy | null;
  queueDepth: number;
  oldestJobAgeMs: number;
  processedJobs: number;
  cancelledJobs: number;
  frameBudgetMs: number;
};

type MathRenderJob = {
  policy: MathRenderPolicy;
  queuedAt: number;
  run: () => void;
  cancelled: boolean;
  completed: boolean;
};

type MathRenderQueueOptions = {
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  onMetrics?: (metric: MathRenderQueueMetric) => void;
};

function defaultRequestFrame(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function defaultCancelFrame(handle: number) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

/**
 * Frame-bounded KaTeX work queue.
 *
 * Live streaming uses a small batch. Complete-message reattach uses a larger
 * batch, but both policies stop on measured elapsed time so one response
 * cannot monopolise a frame.
 */
export class MathRenderQueue {
  private readonly now: () => number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly onMetrics?: (metric: MathRenderQueueMetric) => void;
  private readonly jobs: MathRenderJob[] = [];
  private frameHandle: number | null = null;
  private cancelledJobs = 0;

  constructor(options: MathRenderQueueOptions = {}) {
    this.now = options.now || (() => performance.now());
    this.requestFrame = options.requestFrame || defaultRequestFrame;
    this.cancelFrame = options.cancelFrame || defaultCancelFrame;
    this.onMetrics = options.onMetrics;
  }

  enqueue(run: () => void, policy: MathRenderPolicy = "stream") {
    const job: MathRenderJob = {
      policy,
      queuedAt: this.now(),
      run,
      cancelled: false,
      completed: false,
    };
    this.jobs.push(job);
    this.emitMetrics("enqueue", policy, 0);
    this.schedule();
    let cancelled = false;
    return () => {
      if (cancelled || job.completed) return;
      cancelled = true;
      job.cancelled = true;
      const index = this.jobs.indexOf(job);
      if (index >= 0) this.jobs.splice(index, 1);
      this.cancelledJobs += 1;
      this.emitMetrics("cancel", policy, 0);
      if (!this.jobs.length && this.frameHandle != null) {
        this.cancelFrame(this.frameHandle);
        this.frameHandle = null;
      }
    };
  }

  getMetrics(): MathRenderQueueMetric {
    const policy = this.jobs[0]?.policy || null;
    const frameBudgetMs = policy === "reattach"
      ? MATH_RENDER_REATTACH_FRAME_BUDGET_MS
      : MATH_RENDER_STREAM_FRAME_BUDGET_MS;
    return {
      event: "frame",
      policy,
      queueDepth: this.jobs.length,
      oldestJobAgeMs: this.oldestJobAgeMs(),
      processedJobs: 0,
      cancelledJobs: this.cancelledJobs,
      frameBudgetMs,
    };
  }

  private schedule() {
    if (this.frameHandle != null || !this.jobs.length) return;
    this.frameHandle = this.requestFrame(() => {
      this.frameHandle = null;
      this.processFrame();
      this.schedule();
    });
  }

  private processFrame() {
    const policy = this.jobs[0]?.policy || "stream";
    const frameBudgetMs = policy === "reattach"
      ? MATH_RENDER_REATTACH_FRAME_BUDGET_MS
      : MATH_RENDER_STREAM_FRAME_BUDGET_MS;
    const maxJobs = policy === "reattach"
      ? MATH_RENDER_REATTACH_MAX_JOBS_PER_FRAME
      : MATH_RENDER_STREAM_MAX_JOBS_PER_FRAME;
    const startedAt = this.now();
    let processedJobs = 0;
    while (this.jobs.length && processedJobs < maxJobs && this.now() - startedAt < frameBudgetMs) {
      const next = this.jobs.shift()!;
      if (next.cancelled) continue;
      next.completed = true;
      next.run();
      processedJobs += 1;
    }
    this.emitMetrics("frame", policy, processedJobs, frameBudgetMs);
  }

  private oldestJobAgeMs() {
    const oldest = this.jobs[0]?.queuedAt;
    return oldest == null ? 0 : Math.max(0, this.now() - oldest);
  }

  private emitMetrics(
    event: MathRenderQueueMetric["event"],
    policy: MathRenderPolicy | null,
    processedJobs: number,
    frameBudgetMs = policy === "reattach" ? MATH_RENDER_REATTACH_FRAME_BUDGET_MS : MATH_RENDER_STREAM_FRAME_BUDGET_MS,
  ) {
    this.onMetrics?.({
      event,
      policy,
      queueDepth: this.jobs.length,
      oldestJobAgeMs: this.oldestJobAgeMs(),
      processedJobs,
      cancelledJobs: this.cancelledJobs,
      frameBudgetMs,
    });
  }
}
