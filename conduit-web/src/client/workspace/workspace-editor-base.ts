import { defaultKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightSpecialChars, keymap, lineNumbers, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { createWorkspaceSearchPanel } from "./workspace-search-panel";

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    fontSize: "inherit",
    lineHeight: "1.5",
  },
  ".cm-content": { padding: "8px 0 28px" },
  ".cm-line": { padding: "0 10px" },
  ".cm-gutters": {
    borderRight: "0",
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    fontSize: "inherit",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "28px", padding: "0 5px 0 3px" },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--accent), transparent 55%)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--foreground), transparent 78%) !important",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-foldGutter": { width: "12px" },
  ".cm-foldGutter .cm-gutterElement": {
    display: "grid",
    width: "12px",
    padding: "0",
    placeItems: "center",
  },
  ".workspace-fold-marker": {
    position: "relative",
    width: "9px",
    height: "9px",
    color: "color-mix(in oklch, var(--muted-foreground), transparent 12%)",
    opacity: "0.72",
  },
  ".workspace-fold-marker::before": {
    position: "absolute",
    top: "1px",
    left: "2px",
    width: "4px",
    height: "4px",
    borderRight: "1px solid currentColor",
    borderBottom: "1px solid currentColor",
    content: "''",
  },
  ".workspace-fold-marker[data-open='true']::before": { transform: "rotate(45deg)" },
  ".workspace-fold-marker[data-open='false']::before": { top: "2px", left: "1px", transform: "rotate(-45deg)" },
  ".workspace-fold-marker:hover": { color: "var(--foreground)", opacity: "1" },
  ".workspace-indent-guides": {
    backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(var(--workspace-indent-size) - 1px), color-mix(in oklch, var(--muted-foreground), transparent 82%) calc(var(--workspace-indent-size) - 1px), color-mix(in oklch, var(--muted-foreground), transparent 82%) var(--workspace-indent-size))",
    backgroundPosition: "10px 0",
    backgroundRepeat: "no-repeat",
    backgroundSize: "calc(var(--workspace-indent-depth) * var(--workspace-indent-size)) 100%",
  },
  ".cm-matchingBracket": {
    backgroundColor: "var(--accent)",
    outline: "1px solid var(--ring)",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--foreground), transparent 88%)" },
  ".cm-foldPlaceholder": {
    border: "1px solid var(--border)",
    borderRadius: "3px",
    backgroundColor: "var(--accent)",
    color: "var(--muted-foreground)",
  },
  ".cm-panels": {
    borderColor: "var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-search label": { color: "var(--muted-foreground)", fontFamily: "var(--font-sans)" },
  ".cm-textfield": {
    border: "1px solid var(--input)",
    borderRadius: "4px",
    outline: "none",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-textfield:focus": { borderColor: "var(--ring)" },
  ".cm-button": {
    border: "1px solid var(--border)",
    borderRadius: "4px",
    backgroundImage: "none",
    backgroundColor: "var(--accent)",
    color: "var(--foreground)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--border)",
    borderRadius: "4px",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "0 8px 24px rgb(0 0 0 / 24%)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--foreground)",
  },
}, { dark: true });

const oneDarkPro = {
  foreground: "#abb2bf",
  comment: "#5c6370",
  red: "#e06c75",
  orange: "#d19a66",
  yellow: "#e5c07b",
  green: "#98c379",
  cyan: "#56b6c2",
  blue: "#61afef",
  purple: "#c678dd",
  invalid: "#f44747",
} as const;

export const workspaceHighlightStyle = HighlightStyle.define([
  { tag: tags.content, color: oneDarkPro.foreground },
  { tag: tags.punctuation, color: oneDarkPro.foreground },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.quote], color: oneDarkPro.comment, fontStyle: "italic" },
  { tag: [tags.variableName, tags.propertyName, tags.labelName, tags.self], color: oneDarkPro.red },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: oneDarkPro.red },
  { tag: [tags.constant(tags.variableName), tags.constant(tags.propertyName), tags.macroName], color: oneDarkPro.orange },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.standard(tags.function(tags.variableName))], color: oneDarkPro.blue },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.name)], color: oneDarkPro.yellow },
  { tag: tags.tagName, color: oneDarkPro.red },
  { tag: tags.attributeName, color: oneDarkPro.orange },
  { tag: [tags.string, tags.docString, tags.character, tags.attributeValue], color: oneDarkPro.green },
  { tag: [tags.regexp, tags.special(tags.string)], color: oneDarkPro.green },
  { tag: tags.escape, color: oneDarkPro.cyan },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom, tags.unit, tags.color], color: oneDarkPro.orange },
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: oneDarkPro.purple },
  { tag: [tags.operator, tags.derefOperator, tags.arithmeticOperator, tags.logicOperator, tags.bitwiseOperator, tags.compareOperator, tags.updateOperator, tags.definitionOperator, tags.typeOperator, tags.controlOperator], color: oneDarkPro.cyan },
  { tag: [tags.meta, tags.documentMeta, tags.annotation, tags.processingInstruction], color: oneDarkPro.orange },
  { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: oneDarkPro.blue, fontWeight: "600" },
  { tag: [tags.link, tags.url], color: oneDarkPro.cyan, textDecoration: "underline" },
  { tag: tags.monospace, color: oneDarkPro.green },
  { tag: tags.inserted, color: oneDarkPro.green },
  { tag: tags.changed, color: oneDarkPro.yellow },
  { tag: tags.deleted, color: oneDarkPro.red },
  { tag: tags.invalid, color: "#ffffff", backgroundColor: oneDarkPro.invalid },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
], { themeType: "dark" });

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "workspace-fold-marker";
  marker.dataset.open = String(open);
  marker.setAttribute("aria-hidden", "true");
  return marker;
}

function indentationGuideDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = view.state.tabSize;
  for (const range of view.visibleRanges) {
    let position = range.from;
    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      const whitespace = line.text.match(/^[\t ]+/)?.[0] ?? "";
      let columns = 0;
      for (const character of whitespace) columns += character === "\t" ? tabSize - (columns % tabSize) : 1;
      const depth = Math.floor(columns / tabSize);
      if (depth > 0) {
        builder.add(line.from, line.from, Decoration.line({
          attributes: {
            class: "workspace-indent-guides",
            style: `--workspace-indent-depth:${depth};--workspace-indent-size:${tabSize}ch`,
          },
        }));
      }
      if (line.to >= range.to) break;
      position = line.to + 1;
    }
  }
  return builder.finish();
}

const indentationGuides = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = indentationGuideDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.decorations = indentationGuideDecorations(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

export const workspaceReadOnlySetup = [
  editorTheme,
  lineNumbers(),
  highlightSpecialChars(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  syntaxHighlighting(workspaceHighlightStyle, { fallback: true }),
  bracketMatching(),
  search({ top: false, createPanel: createWorkspaceSearchPanel }),
  highlightSelectionMatches(),
  foldGutter({ markerDOM: createFoldMarker }),
  indentationGuides,
  keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
];
