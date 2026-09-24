import { Show } from "solid-js";
import type { HarnessSummary } from "./api/contracts";

/**
 * Product marks for the coding harnesses, served from `public/brand/`.
 *
 * `tint: true` marks are single-colour artwork: they render as a mask filled
 * with `currentColor` so they follow the surrounding theme. Codex is shown in
 * one colour like the rest, except where a surface asks for `artwork`: its
 * official gradient mark, rendered as an image and never tinted or inverted.
 * `brand` is the colour a one-colour mark is shown in when a surface lights it
 * (the sidebar, on hover); a mark without one lights to the foreground.
 * Entries beyond the shipped adapters are staged for the ones that follow;
 * see `docs/brand/README.md` for provenance.
 */
type Mark = { src: string; tint?: boolean; artwork?: string; brand?: string };

const BLOSSOM: Mark = { src: "/brand/openai-blossom-mark.svg", tint: true };

const MARKS: Record<string, Mark> = {
  conduit: { src: "/brand/conduit-mark.svg", tint: true },
  codex: { src: "/brand/codex-mono-mark.svg", tint: true, artwork: "/brand/codex-mark.svg" },
  "chatgpt-web": BLOSSOM,
  "claude-code": { src: "/brand/claude-code-mark.svg", tint: true, brand: "#d97757" },
  fx: { src: "/brand/fx-mark.svg", tint: true },
  opencode: { src: "/brand/opencode-mark.svg", tint: true },
  pi: { src: "/brand/pi-mark.svg", tint: true },
};

const FALLBACK = BLOSSOM;

export function harnessStatusLabel(status: HarnessSummary["status"]): string {
  return status === "authentication_required" ? "Sign-in required" : status === "unavailable" ? "Unavailable" : "Ready";
}

export function HarnessMark(props: { id: string; class?: string; artwork?: boolean }) {
  const mark = (): Mark => {
    const found = MARKS[props.id] ?? FALLBACK;
    return props.artwork && found.artwork ? { src: found.artwork } : found;
  };
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

/**
 * `lively`: the mark is greyed like the rest of the row until the row is
 * hovered or focused, then shows in its own colours -- Codex's gradient
 * artwork, Claude's orange, the rest at full foreground.
 */
export function ThreadHarnessMark(props: { id?: string; lively?: boolean }) {
  const id = () => props.id || "conduit";
  const label = () => HARNESS_LABELS[id()] || id();
  const mark = () => MARKS[id()] ?? FALLBACK;
  return <span class="thread-harness-mark" data-lively={props.lively || undefined} data-artwork={props.lively && mark().artwork ? "true" : undefined}
    style={props.lively && mark().brand ? { "--harness-brand": mark().brand } : undefined} role="img" aria-label={`${label()} harness`} title={label()}>
    <HarnessMark id={id()} />
    <Show when={props.lively && mark().artwork}><img class="harness-mark harness-mark-artwork" src={mark().artwork} alt="" /></Show>
  </span>;
}
