import * as Icons from "./icons";
import { For, Show, type JSX } from "solid-js";

import { Button, ShowMore } from "./controls";
import { CODE_BLOCK } from "./shared";
export { CODE_BLOCK } from "./shared";

export function CopyButton(props: { copied?: boolean; label?: string; onCopy?: () => void }) {
  return <Button variant="ghost" size="icon-xs" class="ui-copy" data-copied={props.copied ? "" : undefined} aria-label={props.copied ? "Copied" : props.label ?? "Copy"} onClick={() => props.onCopy?.()}>
    <Icons.Copy class="ui-copy-idle" /><Icons.Check class="ui-copy-done" />
  </Button>;
}
const moreLabel = (hidden: number) => `Show ${hidden} more ${hidden === 1 ? "line" : "lines"}`;
/** children: the caller's <code>, grown in place as it streams so a finished line is never rebuilt. */
export function CodeBlock(props: { lang?: string; code?: string; lines?: number; onCopy?: () => void; copied?: boolean; fold?: number; open?: boolean; onToggle?: () => void; streaming?: boolean; children?: JSX.Element }) {
  const text = () => (props.code ?? "").split("\n");
  const count = () => props.lines ?? text().length;
  const folds = () => props.fold != null && count() > props.fold;
  const folded = () => folds() && !props.open;
  return <figure class="ui-code" data-lines={count()} data-folded={folded() ? "" : undefined} data-copied={props.copied ? "" : undefined} data-streaming={props.streaming ? "" : undefined}
    style={{ "--code-digits": String(count()).length, ...(folds() ? { "--code-fold": props.fold } : {}) }}>
    <figcaption><span class="ui-code-lang">{props.lang ?? "text"}</span>
      <CopyButton copied={props.copied} label="Copy code" onCopy={props.onCopy} />
      <Show when={folds()}><Button variant="ghost" size="icon-xs" class="ui-code-toggle" aria-label={folded() ? "Expand code" : "Collapse code"} aria-expanded={!folded()} onClick={() => props.onToggle?.()}><Icons.ChevronDown class="ui-disclosure-chevron ui-fold-chevron ui-size-icon-sm" data-turn="half" /></Button></Show>
    </figcaption>
    <pre><Show when={props.code === undefined} fallback={<code><For each={text()}>{(line) => <span class={CODE_BLOCK.line}>{line || " "}</span>}</For></code>}>{props.children}</Show></pre>
    <Show when={folds()}><ShowMore bar open={!folded()} more={moreLabel(count() - props.fold!)} onToggle={() => props.onToggle?.()} /></Show>
  </figure>;
}

