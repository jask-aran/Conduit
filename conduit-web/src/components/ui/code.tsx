import { For, Show } from "solid-js";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "lucide-solid";
import { Button } from "./controls";

/**
 * Copy, and what it says once it has: the icon turns to a check for a moment (the caller holds `copied` about
 * 1.2s). Whatever was copied marks itself `data-copied` and takes the copied wash: a --tint that fades out.
 */
export function CopyButton(props: { copied?: boolean; label?: string; onCopy?: () => void }) {
  return <Button variant="ghost" size="icon-xs" class="ui-copy" data-copied={props.copied ? "" : undefined} aria-label={props.copied ? "Copied" : props.label ?? "Copy"} onClick={() => props.onCopy?.()}>
    <Show when={props.copied} fallback={<CopyIcon />}><CheckIcon /></Show>
  </Button>;
}
/**
 * A fenced block: a box, its language and Copy over numbered lines that scroll sideways. A long one folds to
 * `fold` lines, fading at the cut, "Show N more lines" under it and a chevron beside Copy (the caption pins as
 * the block scrolls by, so it is the way out part-way down); opened, the foot says Show less. `streaming`
 * pulses the foot of a folded block still being written.
 */
export function CodeBlock(props: { lang?: string; code: string; onCopy?: () => void; copied?: boolean; fold?: number; open?: boolean; onToggle?: () => void; streaming?: boolean }) {
  const lines = () => props.code.split("\n");
  const folds = () => props.fold != null && lines().length > props.fold;
  const folded = () => folds() && !props.open;
  const hidden = () => lines().length - (props.fold ?? 0);
  return <figure class="ui-code" data-folded={folded() ? "" : undefined} data-copied={props.copied ? "" : undefined} data-streaming={props.streaming ? "" : undefined}
    style={{ "--code-digits": String(lines().length).length, ...(folds() ? { "--code-fold": props.fold } : {}) }}>
    <figcaption><span class="ui-code-lang">{props.lang ?? "text"}</span>
      <CopyButton copied={props.copied} label="Copy code" onCopy={props.onCopy} />
      <Show when={folds()}><Button variant="ghost" size="icon-xs" aria-label={folded() ? "Expand code" : "Collapse code"} aria-expanded={!folded()} onClick={() => props.onToggle?.()}><ChevronDownIcon class="ui-disclosure-chevron" /></Button></Show>
    </figcaption>
    <pre><For each={lines()}>{(line, index) => <span class="ui-code-line"><span class="ui-code-n">{index() + 1}</span><code>{line || " "}</code></span>}</For></pre>
    <Show when={folds()}><button type="button" class="ui-code-more" onClick={() => props.onToggle?.()}>{folded() ? `Show ${hidden()} more ${hidden() === 1 ? "line" : "lines"}` : "Show less"}</button></Show>
  </figure>;
}
