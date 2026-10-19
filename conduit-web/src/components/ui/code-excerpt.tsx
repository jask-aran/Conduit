import { EditorState, Prec } from "@codemirror/state";
import { EditorView, highlightSpecialChars, lineNumbers } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { JSX } from "solid-js";

/** Read-only code engine with the same syntax tokens as the v2 code block.
 * Callers supply language, line numbers, diff data and selection decorations. */
export const codeExcerptSetup = (numbers: Parameters<typeof lineNumbers>[0] = {}) => [
  lineNumbers(numbers), highlightSpecialChars(), EditorState.readOnly.of(true), EditorView.editable.of(false),
  syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syntax-keyword)" },
    { tag: [tags.string, tags.regexp], color: "var(--syntax-string)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
    { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
    { tag: tags.function(tags.variableName), color: "var(--syntax-title)" },
    { tag: [tags.variableName, tags.propertyName], color: "var(--syntax-variable)" },
    { tag: [tags.comment, tags.meta], color: "var(--syntax-meta)" },
  ]), { fallback: true }),
  Prec.high(EditorView.theme({
    "&": { color: "var(--foreground)", backgroundColor: "transparent" },
    ".cm-scroller": { fontFamily: "var(--font-code)", fontSize: "var(--text-caption)", lineHeight: "var(--leading-code)" },
    ".cm-content": { padding: "var(--space-sm) 0" },
    ".cm-line": { padding: "0 var(--space-md)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" },
    ".cm-gutterElement": { padding: "0 var(--space-sm)" },
    ".cm-review-comment": { boxShadow: "none", backgroundColor: "color-mix(in oklch, var(--warn), transparent var(--tone-line))" },
    ".cm-review-context": { color: "var(--muted-foreground)", opacity: "var(--opacity-muted)" },
    ".cm-diff-added": { backgroundColor: "color-mix(in oklch, var(--live), transparent var(--tone-wash))" },
    ".cm-diff-removed": { backgroundColor: "color-mix(in oklch, var(--destructive), transparent var(--tone-wash))" },
    ".cm-diff-added-gutter": { backgroundColor: "var(--live)" },
    ".cm-diff-removed-gutter": { backgroundColor: "var(--destructive)" },
    ".cm-changeGutter": { width: "0", minWidth: "0", overflow: "visible", padding: "0" },
    ".cm-changeGutter .cm-gutterElement": { width: "var(--stroke)", minWidth: "var(--stroke)", transform: "translateX(calc(-1 * var(--stroke)))" },
    ".workspace-indent-guides": { backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(var(--workspace-indent-size) - var(--hairline)), var(--tint) calc(var(--workspace-indent-size) - var(--hairline)), var(--tint) var(--workspace-indent-size))", backgroundPosition: "var(--space-md) 0", backgroundRepeat: "no-repeat", backgroundSize: "calc(var(--workspace-indent-depth) * var(--workspace-indent-size)) 100%" },
  })),
];
export const CodeExcerpt = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-code-excerpt" />;
