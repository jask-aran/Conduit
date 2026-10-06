import * as Effect from "effect/Effect";

/**
 * Ending a child process, once, the same way everywhere.
 *
 * Every owner of a subprocess used to write its own SIGTERM, wait and SIGKILL,
 * with its own grace, its own idea of whether the whole process group goes,
 * and in two places no SIGKILL at all. A child that ignored SIGTERM then
 * outlived the server. This is the one escalation: ask, wait `graceMs`, then
 * insist, and resolve once the child has actually gone (or `killWaitMs` after
 * insisting, for a child the kernel has not reaped yet).
 *
 * `group` signals the child's process group, for children spawned `detached`
 * that start their own descendants (git, installers). `waitMs` first gives a
 * child already asked to exit some other way (a shutdown request) that long.
 */
const exited = (child) => child.exitCode != null || child.signalCode != null;

const signal = (child, name, group) => {
  if (group && child.pid && process.platform !== "win32") {
    try { process.kill(-child.pid, name); return; } catch { /* no group: the child alone */ }
  }
  try { child.kill(name); } catch { /* already gone */ }
};

const exit = (child) => Effect.callback((resume) => {
  if (exited(child)) return resume(Effect.succeed(true));
  const done = () => resume(Effect.succeed(true));
  child.once("exit", done);
  return Effect.sync(() => child.off("exit", done));
});

const within = (effect, ms, orElse) => effect.pipe(Effect.timeoutOrElse({ duration: Math.max(0, ms), orElse }));

export function terminateEffect(child, { graceMs = 3_000, killWaitMs = 2_000, group = false, waitMs = 0 } = {}) {
  const escalate = Effect.suspend(() => {
    if (exited(child)) return Effect.succeed(true);
    signal(child, "SIGTERM", group);
    return within(exit(child), graceMs, () => Effect.sync(() => signal(child, "SIGKILL", group)).pipe(
      Effect.andThen(within(exit(child), killWaitMs, () => Effect.succeed(false)))));
  });
  return Effect.suspend(() => {
    if (!child || exited(child)) return Effect.succeed(true);
    return waitMs > 0 ? within(exit(child), waitMs, () => escalate) : escalate;
  });
}

/** Resolves true once the child has exited, false if it outlived SIGKILL's wait. */
export const terminate = (child, options) => Effect.runPromise(terminateEffect(child, options));
