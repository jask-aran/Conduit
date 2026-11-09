/* How a thread draws the work between what it says (Settings → Appearance → Reasoning & tool use), per device: each
   run as its steps, each as one line (its run header), or the turn header alone. */
import { createSignal } from "solid-js";

export type RunForm = "steps" | "headers" | "turn";

export const RUN_FORMS: readonly { value: RunForm; label: string; description: string }[] = [
  { value: "steps", label: "Steps", description: "Each run of work shows its steps; the turn header sums up the turn." },
  { value: "headers", label: "One line per run", description: "Each run of work is one line; the turn header sums up the turn." },
  { value: "turn", label: "Turn header only", description: "The turn header alone stands for the turn's work." },
];

const KEY = "conduit:run-form";

function stored(): RunForm {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "steps" || value === "headers" || value === "turn") return value;
  } catch { /* unavailable */ }
  return "steps";
}

const [form, setForm] = createSignal<RunForm>(stored());
export const runForm = form;

export function saveRunForm(value: RunForm): RunForm {
  try { localStorage.setItem(KEY, value); } catch { /* this session only */ }
  setForm(value);
  return value;
}
