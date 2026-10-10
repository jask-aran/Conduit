import { createSignal } from "solid-js";
import type { ModelOption, Project, Template } from "../client/api/contracts";

/* What the gallery's fake chat has to choose from: invented, never read from a server. */

const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
const model = (provider: string, id: string, label: string): ModelOption => ({ provider, id, spec: `${provider}/${id}`, label, thinkingLevels: levels, defaultThinkingLevel: "medium" });
export const MODELS: ModelOption[] = [
  model("openrouter", "gemini-3.8-flash", "Google: Gemini 3.8 Flash"),
  model("openrouter", "free-router", "Free Models Router"),
  model("openrouter", "muse-spark-1.3", "Meta: Muse Spark 1.3 Contributor"),
  model("xai", "grok-4.6", "Grok 4.6"),
  model("anthropic", "claude-opus-5-5", "Claude Opus 5.5"),
  model("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
  model("openai", "gpt-6", "GPT-6"),
];

export const PROFILES: Template[] = [
  { id: "assistant", label: "Assistant", description: "General help", implementation: "conduit_pi" },
  { id: "coder", label: "Coder", description: "Works in a folder", implementation: "conduit_pi" },
  { id: "claude-code", label: "Claude Code", implementation: "claude_code" },
  { id: "codex", label: "Codex", implementation: "codex" },
];

const place = (id: string, name: string, kind: Project["kind"], origin: Project["origin"]): Project =>
  ({ id, slug: id, name, kind, origin, workingRoot: `/home/you/${id}`, sessions: [] });
export const PROJECTS: Project[] = [
  place("engie", "Engie", "project", "managed"),
  place("japan", "Japan", "project", "managed"),
  place("nhp", "NHP", "project", "managed"),
  place("test", "Test", "project", "managed"),
  place("conduit", "Conduit", "workspace", "linked"),
  place("deriv-dash", "deriv-dash", "workspace", "linked"),
  place("jaskfish", "JaskFish", "workspace", "cloned"),
  place("largetest", "largetest", "workspace", "created"),
];

export function seededModels() {
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  const [effort, setEffort] = createSignal("medium");
  return {
    models: () => MODELS, model: current, effort, notice: () => "",
    chooseModel: (spec: string) => { setCurrent(spec); return true; },
    chooseEffort: (level: string) => { setEffort(level); return true; },
  };
}

export function seededPlace() {
  const [current, setCurrent] = createSignal<Project | null>(null);
  return { get projects() { return PROJECTS; }, get current() { return current(); }, onChoose: (project: Project) => setCurrent((now) => now?.id === project.id ? null : project) };
}

export function seededProfile() {
  const [active, setActive] = createSignal(PROFILES[0]!);
  return { profiles: PROFILES, active, choose: (id: string) => setActive(PROFILES.find((profile) => profile.id === id) ?? PROFILES[0]!) };
}
