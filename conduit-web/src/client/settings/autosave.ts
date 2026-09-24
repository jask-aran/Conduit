import { createSignal } from "solid-js";

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

/**
 * Saving a settings surface as it is edited, with no Save button: a valid
 * edit is sent after a short pause (typing) or at once (a toggle, a choice),
 * one request at a time so an older value can never land after a newer one.
 * "Saved" means the latest edit is stored -- a save that completes while a
 * newer edit is waiting says nothing -- and a failure keeps the edit and
 * waits for Retry. An edit that is not valid yet is held back, not saved.
 */
export function createAutosave<T>(options: {
  save: (value: T) => Promise<T>;
  /** The stored value, once the latest edit is saved. */
  onSaved: (saved: T) => void;
  delayMs?: number;
}) {
  const delay = options.delayMs ?? 600;
  const [state, setState] = createSignal<SaveState>({ kind: "idle" });
  let edits = 0;
  let waiting: { value: T; edit: number } | null = null;
  let failed: { value: T; edit: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    const next = waiting;
    waiting = null;
    if (!next) return chain;
    chain = chain.then(async () => {
      try {
        const saved = await options.save(next.value);
        if (next.edit !== edits) return;
        failed = null;
        options.onSaved(saved);
        setState({ kind: "saved" });
      } catch (error) {
        if (next.edit !== edits) return;
        failed = next;
        setState({ kind: "failed", message: (error as Error).message || "Not saved" });
      }
    });
    return chain;
  };

  return {
    state,
    /** A valid value: saved after the pause, or at once. */
    edit(value: T, when: "pause" | "now" = "pause") {
      waiting = { value, edit: ++edits };
      failed = null;
      setState({ kind: "saving" });
      clearTimeout(timer);
      if (when === "now") void send();
      else timer = setTimeout(() => void send(), delay);
    },
    /** An edit that is not valid yet: nothing is sent, and nothing claims to be saved. */
    hold() {
      ++edits;
      waiting = null;
      clearTimeout(timer);
      setState({ kind: "idle" });
    },
    /** Send a waiting edit now -- leaving the surface -- and settle once everything sent has. */
    flush: () => send(),
    retry() {
      if (!failed) return;
      waiting = failed;
      failed = null;
      setState({ kind: "saving" });
      void send();
    },
    /** Something is typed but not yet stored. */
    busy: () => timer !== undefined || state().kind === "saving",
  };
}

/** One header status for a section saved by more than one autosave: a failure first, then saving, then saved. */
export function combineSaveStates(states: SaveState[]): SaveState {
  return states.find((state) => state.kind === "failed")
    ?? states.find((state) => state.kind === "saving")
    ?? states.find((state) => state.kind === "saved")
    ?? { kind: "idle" };
}
