import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

/**
 * What one live session holds, let go of when it ends.
 *
 * A session's child, sockets, unanswered requests and timers are each handed
 * over where they are taken, with how to release them, and closing the
 * session releases all of it in reverse, once, however it ended -- asked to
 * stop, crashed, or reaped. Each ending used to repeat its own subset of that
 * cleanup, which is how a request's timer could outlive the process it was
 * waiting on. Releases are synchronous, and one that throws is logged and
 * passed over rather than taking the rest down with it.
 */
export class SessionScope {
  constructor({ log = console } = {}) {
    this.log = log;
    this.scope = Scope.makeUnsafe();
    this.closed = false;
    this.timers = new Map();
    this.defer(() => {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    });
  }

  /** Release with `release` when the session ends; at once if it has. */
  defer(release) {
    const guarded = () => {
      try { release(); } catch (error) { this.log.error("A live session could not release a resource", error); }
    };
    if (this.closed) return guarded();
    Effect.runSync(Scope.addFinalizer(this.scope, Effect.sync(guarded)));
  }

  /** A one-shot timer under `key`, replacing any still pending, that ends with the session. */
  timeout(key, ms, run) {
    this.clear(key);
    if (this.closed) return;
    const timer = setTimeout(() => { this.timers.delete(key); run(); }, ms);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  clear(key) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  /** End the session: every release, newest first. Later calls do nothing. */
  close() {
    if (this.closed) return;
    this.closed = true;
    Effect.runSync(Scope.close(this.scope, Exit.void));
  }
}

/** Reject every request still waiting on a session, and stop its clock. */
export function rejectPending(pending, error) {
  for (const entry of pending.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject?.(error);
  }
  pending.clear();
}
