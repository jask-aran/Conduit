import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

/**
 * Released in reverse order of `own`: what takes connections first, then what serves them, then the agents, the voice
 * model and the terminals they run beside.
 */
export class ServerLifetime {
  constructor({ log = console } = {}) {
    this.log = log;
    this.scope = Scope.makeUnsafe();
    this.closing = null;
  }

  own(name, resource, release, { timeoutMs = 10_000 } = {}) {
    const finalizer = Effect.tryPromise({ try: () => Promise.resolve().then(() => release(resource)), catch: (error) => error }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.sync(() => this.log.warn(`Conduit stopped waiting for ${name} after ${timeoutMs}ms`)),
      }),
      Effect.catch((error) => Effect.sync(() => this.log.error(`Conduit could not release ${name}`, error))),
    );
    Effect.runSync(Scope.addFinalizer(this.scope, finalizer));
    return resource;
  }

  interval(name, run, ms) {
    const timer = setInterval(run, ms);
    timer.unref?.();
    return this.own(name, timer, clearInterval);
  }

  close() {
    this.closing ??= Effect.runPromise(Scope.close(this.scope, Exit.void));
    return this.closing;
  }
}
