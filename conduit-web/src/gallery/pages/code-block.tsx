import { createSignal } from "solid-js";
import { CODE_BLOCK, Read, Transcript, Turn, Answer, CodeBlock, codeBlockHtml, fillCodeBlocks, CopyButton, MessageFoot } from "@/components/ui";
import { px, rounding } from "../specs";
import { LONG, typeOf } from "../demos";
import { row, token, type Page } from "../model";

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

export const codeBlockPage: Page = {
  title: "CodeBlock",
  summary: "A fenced block in an answer: a box, its language and Copy, numbered lines; a long one folds. Not frosted: it reads in the transcript's units and scale.",
  preview: codeScene,
  usage: `import { CodeBlock } from "@/components/ui/code";

<CodeBlock lang="tsx" code="const ready = true;" />`,
  anatomy: { scene: codeScene, parts: [
    { selector: ".ui-code", name: "a box", does: "a --tint line at the control corner, no fill", from: (el) => rounding(el) },
    { selector: ".ui-code-lang", name: "the language, where the numbers start", does: "Caption, the data face", from: (el) => typeOf(el) },
    { selector: ".ui-code .ui-copy", name: "Copy, and the fold's chevron beside it", does: "icon-xs ghost buttons with caption-sized icons, their glyphs as far from the end as the language is from the start", from: (el) => px(`${el.getBoundingClientRect().width}px`) },
    { selector: ".ui-code-line", name: "line numbers (the block's counter)", does: "muted, tabular, as wide as the last one", from: (el) => getComputedStyle(el, "::before").color },
    { selector: ".ui-code > pre", name: "the code", does: "the code face in the Row role, at 1.6", from: (el) => typeOf(el) },
    { selector: ".ui-code-more", name: "folded", does: "the cut fades, the foot counts what it hides", from: (el) => px(`${el.getBoundingClientRect().height}px`) }
  ] },
  examples: [
    row("No language", "Plain output without a language label", () => <Read class="g-read">{(() => <CodeBlock code="Workspace ready: /work/conduit" />)()}</Read>, { phone: true, code: '<CodeBlock code="Workspace ready: /work/conduit" />' }),
    row("Long line", "A workspace path scrolls inside the answer", () => <Read class="g-read">{(() => <Transcript><Turn><Answer><CodeBlock lang="sh" code="git diff -- src/client/chat/context-gauge.tsx src/client/chat/mobile-composer-options.tsx src/client/settings/settings-core.tsx" /></Answer></Turn></Transcript>)()}</Read>, { phone: true, code: "<Answer><CodeBlock lang code /></Answer>" }),
    row("Always open", "Explicitly open without a fold control", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={SNIPPET} open streaming={false} />)()}</Read>, { phone: true, code: "<CodeBlock open streaming={false} />" }),
    row("Copy Markdown", "Standalone copy control in the message foot", () => <Read class="g-read">{(() => { const [copied, copy] = useCopied(); return <Transcript><Turn><Answer><p>The workspace is ready in /work/conduit.</p></Answer><MessageFoot time="22:16"><CopyButton label="Copy Markdown" copied={copied()} onCopy={copy} /></MessageFoot></Turn></Transcript>; })()}</Read>, { phone: true, code: '<MessageFoot><CopyButton label="Copy Markdown" copied onCopy /></MessageFoot>' }),
    row("short", "a fence under the fold: no foot", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={SNIPPET} />)()}</Read>, { phone: true, code: "<CodeBlock lang code onCopy>" }),
    row("folded", "past the fold: cut and fading, a chevron beside Copy", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={LONG} fold={6} />)()}</Read>, { phone: true, code: "<CodeBlock fold onToggle>" }),
    row("copied", "the check, and the code washing --tint as it fades", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={SNIPPET} copied />)()}</Read>, { phone: true, code: "<CodeBlock copied>" }),
    row("highlighted", "the caller's own lines (CODE_BLOCK.line), coloured by a highlighter's classes; the block numbers them · --syntax-* by role", () => <Read class="g-read">{(() => <CodeBlock lang="ts" lines={2}><code><span class={CODE_BLOCK.line}><span class="hljs-keyword">const</span> <span class="hljs-variable">fold</span> = <span class="hljs-number">15</span>; <span class="hljs-comment">// lines</span></span><span class={CODE_BLOCK.line}><span class="hljs-keyword">export</span> <span class="hljs-keyword">default</span> <span class="hljs-title">fold</span>;</span></code></CodeBlock>)()}</Read>, { phone: true, code: "<CodeBlock lines>{code}" }),
    row("as a string", "codeBlockHtml: the same block for a renderer that writes HTML, its icons put in by fillCodeBlocks", () => <Read class="g-read">{(() => { const el = document.createElement("div"); el.innerHTML = codeBlockHtml({ lang: "sh", code: "npm run build\nnpm run gallery", lines: 2 }); fillCodeBlocks(el); return el.firstElementChild; })()}</Read>, { phone: true, code: "codeBlockHtml · fillCodeBlocks" }),
    row("A fence in an answer", "the Markdown's fenced code (marked and Incremark): the language as written, numbered lines", () => <Read class="g-read">{(() => <CodeBlock lang="sh" code={"npm run gallery"} />)()}</Read>, { phone: true }),
    row("Folded by Settings · Code blocks", "long ones (past 15 lines, or every one) fold; one opened by hand stays open", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={LONG} fold={15} />)()}</Read>, { phone: true }),
    row("Still being written, folded", "the fold holds while the model writes into it, and the foot pulses as its count climbs", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={LONG} fold={6} streaming />)()}</Read>, { phone: true })
  ],
  motion: [
    row("unfolds · folds", "in height: the one move that pushes what is below · in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Read class="g-read">{(() => <FoldDemo />)()}</Read>, { phone: true, code: "<CodeBlock fold open onToggle>" }),
    row("copied", "a --tint wash over all of it, fading · .7s ease-out", () => <Read class="g-read">{(() => <LiveCopy />)()}</Read>, { phone: true, code: "<CodeBlock copied>" }),
    row("writing", "the foot breathes while the fence is written · 1.6s ease-in-out", () => <Read class="g-read">{(() => <CodeBlock lang="ts" code={LONG} fold={4} streaming />)()}</Read>, { phone: true, code: "<CodeBlock streaming>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--font-code", "code face"),
    token("--text-row", "code size"),
    token("--tint", "border and copied wash"),
    token("--leading-code", "code line height")
  ] }],
  api: ["CodeBlock", "CopyButton"]
};
