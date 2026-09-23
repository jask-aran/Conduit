import { Show } from "solid-js";
import type { HarnessSummary } from "./api/contracts";

/**
 * Product marks for the coding harnesses, served from `public/brand/`.
 *
 * `tint: true` marks are single-colour artwork: they render as a mask filled
 * with `currentColor` so they follow the surrounding theme. The Codex mark is
 * the official gradient artwork and renders as an image; never tint or invert
 * it. Entries beyond the shipped adapters are staged for the ones that follow;
 * see `docs/brand/README.md` for provenance.
 */
type Mark = { src: string; tint?: boolean };

const BLOSSOM: Mark = { src: "/brand/openai-blossom-mark.svg", tint: true };

const MARKS: Record<string, Mark> = {
  conduit: { src: "/favicon.svg" },
  codex: { src: "/brand/codex-mark.svg" },
  "chatgpt-web": BLOSSOM,
  "claude-code": { src: "/brand/claude-code-mark.svg", tint: true },
  fx: { src: "/brand/fx-mark.svg", tint: true },
  opencode: { src: "/brand/opencode-mark.svg", tint: true },
  pi: { src: "/brand/pi-mark.svg", tint: true },
};

const FALLBACK = BLOSSOM;

export function harnessStatusLabel(status: HarnessSummary["status"]): string {
  return status === "authentication_required" ? "Sign-in required" : status === "unavailable" ? "Unavailable" : "Ready";
}

export function HarnessMark(props: { id: string; class?: string }) {
  const mark = (): Mark => MARKS[props.id] ?? FALLBACK;
  return <Show when={mark().tint} fallback={<img class={`harness-mark ${props.class || ""}`} src={mark().src} alt="" />}>
    <i class={`harness-mark harness-mark-tinted ${props.class || ""}`} style={{ "mask-image": `url("${mark().src}")`, "-webkit-mask-image": `url("${mark().src}")` }} aria-hidden="true" />
  </Show>;
}

const HARNESS_LABELS: Record<string, string> = {
  conduit: "Conduit",
  pi: "Pi",
  codex: "Codex",
  "chatgpt-web": "ChatGPT Web",
  "claude-code": "Claude Code",
  fx: "fx",
  opencode: "OpenCode",
};

/**
 * What to call the backend behind a chat.
 *
 * Keyed by the implementation the chat reports, so a surface that shows the
 * runtime names the harness that is actually running rather than assuming the
 * built-in one.
 */
const IMPLEMENTATION_LABELS: Record<string, string> = {
  conduit_pi: "Conduit Pi",
  codex: "Codex",
  "chatgpt-web": "ChatGPT Web",
};

export const harnessLabelFor = (implementation?: string | null) => implementation
  ? IMPLEMENTATION_LABELS[implementation] || HARNESS_LABELS[implementation] || implementation
  : null;

export function ThreadHarnessMark(props: { id?: string }) {
  const id = () => props.id || "conduit";
  const label = () => HARNESS_LABELS[id()] || id();
  return <span class="thread-harness-mark" role="img" aria-label={`${label()} harness`} title={label()}>
    <HarnessMark id={id()} />
  </span>;
}
