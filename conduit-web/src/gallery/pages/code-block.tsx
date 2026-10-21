import { createSignal } from "solid-js";
import { CODE_BLOCK, Transcript, Turn, Answer, CodeBlock, codeBlockHtml, fillCodeBlocks, CopyButton, MessageFoot } from "@/components/ui";
import { InUse, FormTable, form, px, rounding, type Mark, type FormRow } from "../specs";
import { LONG, typeOf, reading } from "../demos";
import { type Family, lib } from "../model";

export const SNIPPET = "const total = items.reduce(\n  (sum, item) => sum + item.size, 0);";
/** Copy says so for a moment, as the app's does. */
export const useCopied = () => { const [copied, setCopied] = createSignal(false); return [copied, () => { setCopied(true); setTimeout(() => setCopied(false), 1200); }] as const; };
/** A turn with a fence, live: Copy it, open and fold it, copy the answer. */
export function codeScene() {
  const [code, copyCode] = useCopied(), [answer, copyAnswer] = useCopied(), [open, setOpen] = createSignal(false);
  return <div class="g-card-scene"><Transcript><Turn>
    <Answer><p>Each step runs in order; the build caches what it can.</p><CodeBlock lang="ts" code={LONG} fold={6} open={open()} onToggle={() => setOpen(!open())} copied={code()} onCopy={copyCode} /></Answer>
    <MessageFoot time="22:16"><CopyButton copied={answer()} label="Copy answer" onCopy={copyAnswer} /></MessageFoot>
  </Turn></Transcript></div>;
}
export function FoldDemo() { const [open, setOpen] = createSignal(false); return <CodeBlock lang="ts" code={LONG} fold={4} open={open()} onToggle={() => setOpen(!open())} />; }
export function LiveCopy() { const [copied, copy] = useCopied(); return <CodeBlock lang="sh" code={"npm run gallery"} copied={copied()} onCopy={copy} />; }
export const CODE_MARKS: Mark[] = [
  { selector: ".ui-code", label: "a box: a --tint line at the control corner, no fill", read: (el) => rounding(el) },
  { selector: ".ui-code-lang", label: "the language, where the numbers start: Caption, the data face", read: (el) => typeOf(el) },
  { selector: ".ui-code .ui-copy", label: "Copy, and the fold's chevron beside it: icon-xs ghost buttons with caption-sized icons, their glyphs as far from the end as the language is from the start", read: (el) => px(`${el.getBoundingClientRect().width}px`) },
  { selector: ".ui-code-line", label: "line numbers (the block's counter): muted, tabular, as wide as the last one", read: (el) => getComputedStyle(el, "::before").color },
  { selector: ".ui-code > pre", label: "the code: the code face in the Row role, at 1.6", read: (el) => typeOf(el) },
  { selector: ".ui-code-more", label: "folded: the cut fades, the foot counts what it hides", read: (el) => px(`${el.getBoundingClientRect().height}px`) },
];
export const CODE_FORMS: FormRow[] = [
  form("short", "a fence under the fold: no foot", () => <CodeBlock lang="ts" code={SNIPPET} />, "<CodeBlock lang code onCopy>"),
  form("folded", "past the fold: cut and fading, a chevron beside Copy", () => <CodeBlock lang="ts" code={LONG} fold={6} />, "<CodeBlock fold onToggle>"),
  form("copied", "the check, and the code washing --tint as it fades", () => <CodeBlock lang="ts" code={SNIPPET} copied />, "<CodeBlock copied>"),
  form("highlighted", "the caller's own lines (CODE_BLOCK.line), coloured by a highlighter's classes; the block numbers them", () => <CodeBlock lang="ts" lines={2}><code><span class={CODE_BLOCK.line}><span class="hljs-keyword">const</span> <span class="hljs-variable">fold</span> = <span class="hljs-number">15</span>; <span class="hljs-comment">// lines</span></span><span class={CODE_BLOCK.line}><span class="hljs-keyword">export</span> <span class="hljs-keyword">default</span> <span class="hljs-title">fold</span>;</span></code></CodeBlock>, "<CodeBlock lines>{code}", "--syntax-* by role"),
  form("as a string", "codeBlockHtml: the same block for a renderer that writes HTML, its icons put in by fillCodeBlocks", () => { const el = document.createElement("div"); el.innerHTML = codeBlockHtml({ lang: "sh", code: "npm run build\nnpm run gallery", lines: 2 }); fillCodeBlocks(el); return el.firstElementChild; }, "codeBlockHtml · fillCodeBlocks"),
];
export const CODE_IN_APP: FormRow[] = [
  form("A fence in an answer", "the Markdown's fenced code (marked and Incremark): the language as written, numbered lines", () => <CodeBlock lang="sh" code={"npm run gallery"} />),
  form("Folded by Settings · Code blocks", "long ones (past 15 lines, or every one) fold; one opened by hand stays open", () => <CodeBlock lang="ts" code={LONG} fold={15} />),
  form("Still being written, folded", "the fold holds while the model writes into it, and the foot pulses as its count climbs", () => <CodeBlock lang="ts" code={LONG} fold={6} streaming />),
];

export const codeBlockFamily: Family = { title: "CodeBlock", note: "a fenced block in an answer: a box, its language and Copy, numbered lines; a long one folds. Not frosted: it reads in the transcript's units and scale", usage: `import { CodeBlock } from "@/components/ui/code";

<CodeBlock lang="tsx" code="const ready = true;" />`,
  api: ["CodeBlock", "CopyButton"],
  groups: [
    { title: "In use", note: "in an answer, measured; Copy it, open and fold it", layout: "desktop", atoms: [
      lib("code-inuse", "CodeBlock in use", "both", "transcript", "Answer > CodeBlock · MessageFoot > CopyButton", () => <InUse scene={codeScene} marks={CODE_MARKS} spacing={[".ui-answer"]} />, "row"),
    ] },
    { title: "Forms", note: "each form at each density", layout: "desktop", atoms: [
      lib("code-forms", "CodeBlock · forms × densities", "both", "transcript", "CodeBlock", () => <FormTable rows={reading(CODE_FORMS)} on={["desktop", "phone"]} widths={["180px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
    { title: "In the app", note: "where the app draws one", layout: "desktop", atoms: [
      lib("code-in-app", "CodeBlock · in the app", "both", "transcript", "chat/code-block.ts", () => <FormTable rows={reading(CODE_IN_APP)} on={["desktop", "phone"]} widths={["minmax(0, 1fr)", "minmax(0, 1fr)"]} stacked />, "row"),
    ] },
    { title: "Motion", note: "its own moves: it unfolds (gentle) and folds back (quick); Copied washes it; a folded fence still being written breathes", layout: "desktop", atoms: [
      lib("code-motion", "CodeBlock · motion", "both", "transcript", "CodeBlock fold · copied · streaming", () => <FormTable rows={reading([
        form("unfolds · folds", "in height: the one move that pushes what is below", () => <FoldDemo />, "<CodeBlock fold open onToggle>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave"),
        form("copied", "a --tint wash over all of it, fading", () => <LiveCopy />, "<CodeBlock copied>", ".7s ease-out"),
        form("writing", "the foot breathes while the fence is written", () => <CodeBlock lang="ts" code={LONG} fold={4} streaming />, "<CodeBlock streaming>", "1.6s ease-in-out"),
      ])} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
