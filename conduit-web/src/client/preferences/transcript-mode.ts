/* How a transcript draws the work between its replies when its chat has not been set either way (Settings →
   Appearance), per device, one default for chats and one for the agent's threads: Narrated (what it says while it
   works stands) or Folded (it folds into the turn's trace). A chat's own choice, from its menu, is the hub's and wins. */
import { createSignal } from "solid-js";
import type { Narration } from "../turn-rows";

export type NarrationScope = "chat" | "agent";

export const NARRATION_OPTIONS: readonly { value: Narration; label: string; description: string }[] = [
  { value: "show", label: "Narrated", description: "What it says while it works stands in the transcript; each run of tools between is one line." },
  { value: "fold", label: "Folded", description: "What it says while it works folds into the turn's trace with its tools; the answer stands alone." },
];

const KEYS: Record<NarrationScope, string> = { chat: "conduit:transcript-mode", agent: "conduit:transcript-mode-agent" };
// The agent talks as it works, so its threads are Narrated. Chats are meant to fold, and are Narrated for now while
// the Narrated transcript is being worked on; set Folded here once it settles.
const DEFAULTS: Record<NarrationScope, Narration> = { chat: "show", agent: "show" };

function stored(scope: NarrationScope): Narration {
  try {
    const value = localStorage.getItem(KEYS[scope]);
    if (value === "fold" || value === "show") return value;
  } catch { /* unavailable */ }
  return DEFAULTS[scope];
}

const [chats, setChats] = createSignal<Narration>(stored("chat"));
const [agents, setAgents] = createSignal<Narration>(stored("agent"));
export const defaultNarration = (scope: NarrationScope = "chat") => scope === "agent" ? agents() : chats();

export function saveDefaultNarration(scope: NarrationScope, mode: Narration): Narration {
  try { localStorage.setItem(KEYS[scope], mode); } catch { /* this session only */ }
  (scope === "agent" ? setAgents : setChats)(mode);
  return mode;
}
