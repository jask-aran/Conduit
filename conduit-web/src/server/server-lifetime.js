import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

/**
 * What the server holds, released when it stops.
 *
 * Each resource is handed over where it is made, with how to let it go, and
 * the server lets everything go in the reverse order: what takes connections
 * first, then what serves them, then the agents, the voice model and the
 * terminals they run beside. Shutdown used to be one function that had to name
 * every resource in the right order, and one release that threw took every
 * release after it down with it. Here each release is bounded by its own
 * timeout and a failure is logged and passed over.
 */
export class ServerLifetime {
  constructor({ log = console } = {}) {
    this.log = log;
    this.scope = Scope.makeUnsafe();
    this.closing = null;
  }

  /** Release `resource` with `release` when the server stops. Returns `resource`. */
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

  /** A recurring timer that ends with the server and never holds it open. */
  interval(name, run, ms) {
    const timer = setInterval(run, ms);
    timer.unref?.();
    return this.own(name, timer, clearInterval);
  }

  /** Release everything, once; later calls share the first. */
  close() {
    this.closing ??= Effect.runPromise(Scope.close(this.scope, Exit.void));
    return this.closing;
  }
}
