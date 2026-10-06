import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/**
 * Shared server synchronization mechanics. Domain policy stays in the caller:
 * this object only serializes work or applies a deadline.
 */
const fromPromise = (work) => Effect.tryPromise({
  try: () => Promise.resolve().then(work),
  // Preserve Conduit's existing rejected Error values and their code/status
  // fields across the Promise/Effect boundary.
  catch: (error) => error,
});

/**
 * `promise`, or after `ms` whatever `fallback` gives: a value, or a function
 * that returns one or throws. Unlike a race against a timer, the timer goes
 * when the promise wins, so a settled wait does not hold the process open.
 */
export const within = (promise, ms, fallback) => Effect.runPromise(fromPromise(() => promise).pipe(
  Effect.timeoutOrElse({
    duration: Math.max(0, Math.trunc(Number(ms) || 0)),
    orElse: () => (typeof fallback === "function" ? fromPromise(fallback) : Effect.succeed(fallback)),
  }),
));

const mutex = () => Semaphore.makeUnsafe(1);
const withMutex = (semaphore, work) => Effect.runPromise(semaphore.withPermit(fromPromise(work)));
const startWithMutex = (semaphore, work) =>
  withMutex(semaphore, () => ({ pending: work() })).then(({ pending }) => pending);

export class ServerConcurrency {
  constructor() {
    this.capacityMutex = mutex();
    this.generationMutex = mutex();
    this.chatMutexes = new Map();
  }

  runCapacity(work) {
    return withMutex(this.capacityMutex, work);
  }

  /**
   * Serialize only admission and synchronous kickoff. Every adapter claims its
   * generation slot before its first await; the backend RPC itself must not
   * hold a global mutex.
   */
  runGenerationStart(work) {
    return startWithMutex(this.generationMutex, work);
  }

  runChat(chatId, work) {
    let entry = this.chatMutexes.get(chatId);
    if (!entry) {
      entry = { semaphore: mutex(), users: 0 };
      this.chatMutexes.set(chatId, entry);
    }
    entry.users += 1;
    return withMutex(entry.semaphore, work).finally(() => {
      entry.users -= 1;
      if (entry.users === 0 && this.chatMutexes.get(chatId) === entry) {
        this.chatMutexes.delete(chatId);
      }
    });
  }

  isChatBusy(chatId) {
    return this.chatMutexes.has(chatId);
  }

  waitFor(work, timeoutMs, timeoutError) {
    return within(Promise.resolve().then(work), timeoutMs, () => { throw timeoutError(); });
  }
}
