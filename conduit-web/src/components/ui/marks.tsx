import { Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";

/** Codex and Claude Code show their official mark as an image (`artwork`), never tinted or inverted. */
export type Mark = { src: string; tint?: boolean; artwork?: string; brand?: string };

const BLOSSOM: Mark = { src: "/brand/openai-blossom-mark.svg", tint: true };

export const MARKS: Record<string, Mark> = {
  conduit: { src: "/brand/conduit-mark.svg", tint: true },
  codex: { src: "/brand/codex-mono-mark.svg", tint: true, artwork: "/brand/codex-mark.svg" },
  "chatgpt-web": BLOSSOM,
  "claude-code": { src: "/brand/claude-code-mono-mark.svg", tint: true, artwork: "/brand/claude-code-mark.svg", brand: "var(--brand-claude-code)" },
  fx: { src: "/brand/fx-mark.svg", tint: true },
  opencode: { src: "/brand/opencode-mark.svg", tint: true },
  pi: { src: "/brand/pi-mark.svg", tint: true },
};

const FALLBACK = BLOSSOM;

export function HarnessMark(props: { id: string; class?: string; artwork?: boolean }) {
  const mark = (): Mark => {
    const found = MARKS[props.id] ?? FALLBACK;
    return props.artwork && found.artwork ? { src: found.artwork } : found;
  };
  return <Show when={mark().tint} fallback={<img class={`ui-harness-mark ${props.class || ""}`} src={mark().src} alt="" />}>
    <i class={`ui-harness-mark ui-harness-mark-tinted ${props.class || ""}`} style={{ "mask-image": `url("${mark().src}")`, "-webkit-mask-image": `url("${mark().src}")` }} aria-hidden="true" />
  </Show>;
}

export function ThreadHarnessMark(props: { id?: string; lively?: boolean; label?: string }) {
  const id = () => props.id || "conduit";
  const label = () => props.label || id();
  const mark = () => MARKS[id()] ?? FALLBACK;
  return <span class="ui-thread-harness-mark ui-size-icon" data-lively={props.lively || undefined} data-artwork={props.lively && mark().artwork ? "true" : undefined}
    style={props.lively && mark().brand ? { "--harness-brand": mark().brand } : undefined} role="img" aria-label={`${label()} harness`} title={label()}>
    <HarnessMark id={id()} />
    <Show when={props.lively && mark().artwork}><img class="ui-harness-mark ui-harness-mark-artwork" src={mark().artwork} alt="" /></Show>
  </span>;
}

export function Glyph(props: { icon?: Component; monogram?: string; colour?: string; class?: string; value?: string }) {
  return <span class={`ui-glyph${props.class ? ` ${props.class}` : ""}`} data-mode={props.monogram !== undefined ? "monogram" : "icon"} data-value={props.value} style={{ color: props.colour }} aria-hidden="true">
    <Show when={props.monogram !== undefined} fallback={<Dynamic component={props.icon} />}>
      {props.monogram}
    </Show>
  </span>;
}
