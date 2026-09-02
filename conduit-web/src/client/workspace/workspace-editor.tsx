import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, forceParsing, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown } from "@codemirror/lang-markdown";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import {
  blockQuoteExtension,
  bulletListExtension,
  codeBlockDecorationsExtension,
  dashExtension,
  defaultHideExtensions,
  emojiExtension,
  fixedTabWidthExtension,
  foldExtension,
  horizonalRuleExtension,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownFormattingKeymapExtension,
  prosemarkMarkdownSyntaxExtensions,
  revealBlockOnArrowExtension,
  taskExtension,
} from "@prosemark/core";
import { createEffect, onCleanup, onMount } from "solid-js";

export function isVisualMarkdownFile(path: string) {
  return /\.(?:md|markdown)$/i.test(path);
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    fontSize: "inherit",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "9.6px 0" },
  ".cm-line": { padding: "0 8px" },
  ".cm-gutters": {
    borderRight: "1px solid var(--border)",
    backgroundColor: "color-mix(in oklch, var(--background), var(--accent) 14%)",
    color: "var(--muted-foreground)",
    fontSize: "inherit",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "32px", padding: "0 6.4px 0 0" },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--accent), transparent 45%)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--foreground), transparent 78%) !important",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-foldGutter span": { color: "var(--muted-foreground)" },
}, { dark: true });

const workspaceHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.quote], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom, tags.docComment], color: "oklch(0.72 0.15 305)" },
  { tag: [tags.string, tags.regexp, tags.inserted], color: "oklch(0.75 0.14 145)" },
  { tag: [tags.number, tags.integer, tags.float, tags.character, tags.escape], color: "oklch(0.78 0.13 65)" },
  { tag: [tags.heading, tags.function(tags.variableName), tags.labelName], color: "oklch(0.78 0.13 240)" },
  { tag: [tags.attributeName, tags.propertyName, tags.variableName], color: "oklch(0.8 0.09 200)" },
  { tag: [tags.typeName, tags.className, tags.standard(tags.name)], color: "oklch(0.8 0.11 90)" },
  { tag: tags.meta, color: "oklch(0.68 0.07 260)" },
  { tag: tags.deleted, color: "var(--destructive)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
]);

const sourceEditorSetup = (markdownFile: boolean) => [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(workspaceHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  highlightSelectionMatches(),
  markdownFile ? [foldGutter(), highlightActiveLineGutter(), highlightActiveLine()] : [],
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
];

const proseMarkSetup = [
  defaultHideExtensions,
  blockQuoteExtension,
  bulletListExtension,
  taskExtension,
  emojiExtension,
  horizonalRuleExtension,
  dashExtension,
  foldExtension,
  revealBlockOnArrowExtension,
  fixedTabWidthExtension,
  codeBlockDecorationsExtension,
  prosemarkMarkdownFormattingKeymapExtension(),
  prosemarkBaseThemeSetup(),
];

export default function WorkspaceEditor(props: {
  path: string;
  value: string;
  wrap: boolean;
  editable?: boolean;
  onInput: (value: string) => void;
  onSave: () => void;
}) {
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const editableCompartment = new Compartment();
  const wrappingCompartment = new Compartment();
  const editable = () => props.editable !== false;

  createEffect(() => {
    const wrap = props.wrap;
    host?.setAttribute("data-wrap", String(wrap));
    if (!view) return;
    view.dispatch({ effects: wrappingCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
  });

  createEffect(() => {
    const nextEditable = editable();
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure([
        EditorState.readOnly.of(!nextEditable),
        EditorView.editable.of(nextEditable),
      ]),
    });
    view.contentDOM.setAttribute("aria-label", `${nextEditable ? "Edit" : "Preview"} ${props.path}`);
    if (nextEditable) view.focus();
  });

  onMount(() => {
    let disposed = false;
    const markdownFile = isVisualMarkdownFile(props.path);
    const setup = async () => {
      const language = markdownFile
        ? markdown({ codeLanguages: languages, extensions: [GFM, prosemarkMarkdownSyntaxExtensions] })
        : await LanguageDescription.matchFilename(languages, props.path)?.load();
      if (disposed || !host) return;
      view = new EditorView({
        parent: host,
        doc: props.value,
        extensions: [
          editorTheme,
          sourceEditorSetup(markdownFile),
          markdownFile ? proseMarkSetup : [],
          language || [],
          editableCompartment.of([
            EditorState.readOnly.of(!editable()),
            EditorView.editable.of(editable()),
          ]),
          wrappingCompartment.of(props.wrap ? EditorView.lineWrapping : []),
          EditorView.contentAttributes.of({
            "aria-label": `${editable() ? "Edit" : "Preview"} ${props.path}`,
            spellcheck: markdownFile ? "true" : "false",
          }),
          EditorView.updateListener.of((update) => {
            if (editable() && update.docChanged) props.onInput(update.state.doc.toString());
          }),
          keymap.of([{
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              if (!editable()) return false;
              props.onSave();
              return true;
            },
          }]),
        ],
      });
      if (markdownFile) {
        forceParsing(view, view.state.doc.length, 100);
        view.dispatch({ selection: { anchor: 0 } });
      }
      view.contentDOM.setAttribute("aria-label", `${editable() ? "Edit" : "Preview"} ${props.path}`);
      if (editable()) view.focus();
    };
    void setup();
    onCleanup(() => {
      disposed = true;
      view?.destroy();
      view = undefined;
    });
  });

  return <div ref={host} class="workspace-code-editor" data-markdown={isVisualMarkdownFile(props.path)} data-wrap={props.wrap} />;
}
