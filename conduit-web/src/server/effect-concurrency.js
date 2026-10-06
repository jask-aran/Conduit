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

const mutex = () => Semaphore.makeUnsafe(1);
const withMutex = (semaphore, work) => Effect.runPromise(semaphore.withPermit(fromPromise(work)));

export class ServerConcurrency {
  constructor() {
    this.capacityMutex = mutex();
    this.chatMutexes = new Map();
  }

  runCapacity(work) {
    return withMutex(this.capacityMutex, work);
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
    const duration = Math.max(0, Math.trunc(Number(timeoutMs) || 0));
    return Effect.runPromise(
      fromPromise(work).pipe(
        Effect.timeoutOrElse({
          duration,
          orElse: () => Effect.fail(timeoutError()),
        }),
      ),
    );
  }
}
