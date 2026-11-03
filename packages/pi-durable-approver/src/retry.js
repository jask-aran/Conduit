import { setTimeout as delay } from "node:timers/promises";

/** Retry with an independent deadline per attempt and abortable jitter. */
export async function withRetry(attempt, { timeoutMs = 20_000, retries = 2, signal } = {}) {
  let attempts = 0;
  const annotate = (reason, timeout = false) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    // Frozen errors still need the attempt metadata.
    const result = Object.isExtensible(error) ? error : Object.assign(new Error(error.message), { cause: error, retry: error.retry });
    result.attempts = attempts;
    if (timeout) result.timeout = true;
    return result;
  };
  for (;;) {
    if (signal?.aborted) throw annotate(signal.reason);
    attempts++;
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Approval attempt timed out"));
    }, timeoutMs);
    let onAbort;
    let failure;
    try {
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const value = await Promise.race([Promise.resolve().then(() => attempt(controller.signal)), cancelled]);
      return { value, attempts };
    } catch (error) {
      failure = annotate(error, timedOut);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted || failure.retry === false || attempts > retries) throw failure;
    try {
      await delay(Math.random() * Math.min(4_000, 500 * 2 ** (attempts - 1)), undefined, { signal });
    } catch {
      throw annotate(signal?.reason);
    }
  }
}
