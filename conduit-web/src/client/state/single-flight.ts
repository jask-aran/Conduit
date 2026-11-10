/**
 * One run of `run` at a time. Asked for while one is under way, it runs once more after it (however many ask), and
 * every caller waiting gets that last run's result: the answer as it is after their ask, never one from before it.
 */
export function createSingleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  let again = false;
  return () => {
    if (running) { again = true; return running; }
    return running = (async () => { let result: T; do { again = false; result = await run(); } while (again); return result; })().finally(() => { running = null; });
  };
}
