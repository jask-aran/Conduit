// `required` on a task event is the step's tasks that can be done here and now (a step with no dock does not wait
// for the dock).

export type TourState =
  | { kind: "idle" }
  | { kind: "waiting"; step: number; done: string[] }
  | { kind: "done"; step: number; done: string[] }
  | { kind: "ended"; step: number; finished: boolean };

export type TourEvent =
  | { type: "start" }
  | { type: "task"; id: string; required: string[] }
  | { type: "check"; required: string[] }
  | { type: "next" }
  | { type: "back" }
  | { type: "end" };

const complete = (done: string[], required: string[]) => required.length > 0 && required.every((id) => done.includes(id));

export function tourReduce(state: TourState, event: TourEvent, steps: number): TourState {
  const at = (step: number): TourState => ({ kind: "waiting", step, done: [] });
  switch (event.type) {
    case "start":
      // Resume where it stopped, unless it was finished (or never begun): then from the top.
      if (state.kind === "waiting" || state.kind === "done") return state;
      return state.kind === "ended" && !state.finished ? at(Math.min(state.step, steps - 1)) : at(0);
    case "end":
      return state.kind === "waiting" || state.kind === "done" ? { kind: "ended", step: state.step, finished: false } : state;
    case "next":
      if (state.kind !== "waiting" && state.kind !== "done") return state;
      return state.step + 1 < steps ? at(state.step + 1) : { kind: "ended", step: state.step, finished: true };
    case "back":
      if (state.kind !== "waiting" && state.kind !== "done") return state;
      return state.step > 0 ? at(state.step - 1) : at(0);
    case "task": {
      if (state.kind !== "waiting" || state.done.includes(event.id)) return state;
      const done = [...state.done, event.id];
      return complete(done, event.required) ? { kind: "done", step: state.step, done } : { ...state, done };
    }
    case "check":
      // What can be done changed (a dock closed, a chat opened): the tasks already seen may now be all there is.
      return state.kind === "waiting" && complete(state.done, event.required) ? { kind: "done", step: state.step, done: state.done } : state;
  }
}

/* Remembered on this device only. Unreadable storage (a private window) just means a fresh tour. */
const STORAGE_KEY = "conduit:keyboard-tour";
export type TourMemory = { state: TourState; offered: boolean };

export function readTourMemory(): TourMemory {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<TourMemory> | null;
    const state = raw?.state;
    const valid = state && typeof state === "object" && ["idle", "waiting", "done", "ended"].includes(state.kind)
      && (state.kind === "idle" || Number.isInteger((state as { step?: unknown }).step));
    // A tour left open when the page went away resumes at its step, waiting again.
    const resumed: TourState = !valid ? { kind: "idle" }
      : state.kind === "waiting" || state.kind === "done" ? { kind: "ended", step: state.step, finished: false } : state;
    return { state: resumed, offered: raw?.offered === true };
  } catch {
    return { state: { kind: "idle" }, offered: false };
  }
}

export function writeTourMemory(memory: TourMemory) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch { /* not remembered, nothing lost now */ }
}
