import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

/** Releases are synchronous; one that throws is logged and passed over rather than taking the rest down with it. */
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

  /** At once if the session has already ended. */
  defer(release) {
    const guarded = () => {
      try { release(); } catch (error) { this.log.error("A live session could not release a resource", error); }
    };
    if (this.closed) return guarded();
    Effect.runSync(Scope.addFinalizer(this.scope, Effect.sync(guarded)));
  }

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

  close() {
    if (this.closed) return;
    this.closed = true;
    Effect.runSync(Scope.close(this.scope, Exit.void));
  }
}
