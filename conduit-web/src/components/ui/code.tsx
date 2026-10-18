import { createRoot, For, Show, type JSX } from "solid-js";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "lucide-solid";
import { Button } from "./controls";
import { CODE_BLOCK } from "./shared";
export { CODE_BLOCK } from "./shared";

/**
 * Copy, and what it says once it has: the icon turns to a check for a moment (the caller holds `copied` about
 * 1.2s, or sets data-copied on the button itself). Whatever was copied marks itself `data-copied` and takes the
 * copied wash: a --tint that fades out.
 */
export function CopyButton(props: { copied?: boolean; label?: string; onCopy?: () => void }) {
  return <Button variant="ghost" size="icon-xs" class="ui-copy" data-copied={props.copied ? "" : undefined} aria-label={props.copied ? "Copied" : props.label ?? "Copy"} onClick={() => props.onCopy?.()}>
    <CopyIcon class="ui-copy-idle" /><CheckIcon class="ui-copy-done" />
  </Button>;
}
const moreLabel = (hidden: number) => `Show ${hidden} more ${hidden === 1 ? "line" : "lines"}`;
/**
 * A fenced block: a box, its language and Copy over numbered lines that scroll sideways. A long one folds to
 * `fold` lines, fading at the cut, "Show N more lines" under it and a chevron beside Copy (the caption pins as
 * the block scrolls by, so it is the way out part-way down); opened, the foot says Show less. `streaming`
 * pulses the foot of a folded block still being written.
 *
 * code: the text, split into lines here. Or children: the caller's own <code>, one CODE_BLOCK.line a line (already
 * highlighted, and grown in place as the block streams, so a finished line is never built again), with `lines`
 * their count. Lines are numbered by the block, not their markup. A renderer that writes HTML has the same block
 * as a string (codeBlockHtml).
 */
export function CodeBlock(props: { lang?: string; code?: string; lines?: number; onCopy?: () => void; copied?: boolean; fold?: number; open?: boolean; onToggle?: () => void; streaming?: boolean; children?: JSX.Element }) {
  const text = () => (props.code ?? "").split("\n");
  const count = () => props.lines ?? text().length;
  const folds = () => props.fold != null && count() > props.fold;
  const folded = () => folds() && !props.open;
  return <figure class="ui-code" data-lines={count()} data-folded={folded() ? "" : undefined} data-copied={props.copied ? "" : undefined} data-streaming={props.streaming ? "" : undefined}
    style={{ "--code-digits": String(count()).length, ...(folds() ? { "--code-fold": props.fold } : {}) }}>
    <figcaption><span class="ui-code-lang">{props.lang ?? "text"}</span>
      <CopyButton copied={props.copied} label="Copy code" onCopy={props.onCopy} />
      <Show when={folds()}><Button variant="ghost" size="icon-xs" class="ui-code-toggle" aria-label={folded() ? "Expand code" : "Collapse code"} aria-expanded={!folded()} onClick={() => props.onToggle?.()}><ChevronDownIcon class="ui-disclosure-chevron" /></Button></Show>
    </figcaption>
    <pre><Show when={props.code === undefined} fallback={<code><For each={text()}>{(line) => <span class={CODE_BLOCK.line}>{line || " "}</span>}</For></code>}>{props.children}</Show></pre>
    <Show when={folds()}><button type="button" class="ui-code-more" onClick={() => props.onToggle?.()}>{folded() ? moreLabel(count() - props.fold!) : "Show less"}</button></Show>
  </figure>;
}

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
/**
 * The CodeBlock for a renderer that writes HTML: the same markup, its controls marked for one delegated listener
 * (data-copy-code, data-expand-code) since a string has no handlers; the listener opens and folds it with
 * setCodeBlockOpen. A sanitizer keeps no SVG, so fillCodeBlocks puts the icons in once the string is parsed. Its
 * lines are plain; a caller may colour them afterwards.
 */
export function codeBlockHtml(props: { lang?: string; code: string; lines: number; fold?: number; streaming?: boolean }) {
  const folds = props.fold != null && props.lines > props.fold;
  const lang = escape(props.lang ?? "text");
  return `<figure class="ui-code" data-language="${lang}" data-lines="${props.lines}"${folds ? " data-folded" : ""}${props.streaming ? " data-streaming" : ""}`
    + ` style="--code-digits: ${String(props.lines).length}${folds ? `; --code-fold: ${props.fold}` : ""}">`
    + `<figcaption><span class="ui-code-lang">${lang}</span>`
    + `<button type="button" data-slot="button" class="ui-button ui-copy" data-variant="ghost" data-size="icon-xs" aria-label="Copy code" data-copy-code></button>`
    + (folds ? `<button type="button" data-slot="button" class="ui-button ui-code-toggle" data-variant="ghost" data-size="icon-xs" aria-label="Expand code" aria-expanded="false" data-expand-code></button>` : "")
    + `</figcaption><pre><code>${(props.code.endsWith("\n") ? props.code.slice(0, -1) : props.code).split("\n").map((line) => `<span class="${CODE_BLOCK.line}">${escape(line)}</span>`).join("")}</code></pre>`
    + (folds ? `<button type="button" class="ui-code-more" data-expand-code>${moreLabel(props.lines - props.fold!)}</button>` : "")
    + "</figure>";
}
let icons: { copy: Node; check: Node; chevron: Node } | undefined;
/** Put the icons into the controls of every codeBlockHtml block under root that has none yet. */
export function fillCodeBlocks(root: ParentNode) {
  icons ??= createRoot((dispose) => { const made = { copy: <CopyIcon class="ui-copy-idle" /> as Node, check: <CheckIcon class="ui-copy-done" /> as Node, chevron: <ChevronDownIcon class="ui-disclosure-chevron" /> as Node }; dispose(); return made; });
  for (const button of root.querySelectorAll(".ui-code > figcaption > .ui-copy:empty")) button.append(icons.copy.cloneNode(true), icons.check.cloneNode(true));
  for (const button of root.querySelectorAll(".ui-code > figcaption > .ui-code-toggle:empty")) button.append(icons.chevron.cloneNode(true));
}
/** Open or fold a codeBlockHtml block, its chevron and foot saying so. */
export function setCodeBlockOpen(block: HTMLElement, open: boolean) {
  const fold = Number(block.style.getPropertyValue("--code-fold"));
  block.toggleAttribute("data-folded", !open);
  block.querySelector(".ui-code-toggle")?.setAttribute("aria-expanded", String(open));
  block.querySelector(".ui-code-toggle")?.setAttribute("aria-label", open ? "Collapse code" : "Expand code");
  const more = block.querySelector(".ui-code-more");
  if (more) more.textContent = open ? "Show less" : moreLabel((Number(block.dataset.lines) || 0) - fold);
}
