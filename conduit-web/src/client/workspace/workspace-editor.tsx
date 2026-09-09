import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder, Text, Transaction } from "@codemirror/state";
import { Decoration, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, ViewPlugin, type Command, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { ChevronDownIcon, IndentDecreaseIcon, IndentIncreaseIcon, PencilIcon, PencilOffIcon, Redo2Icon, SearchIcon, Undo2Icon, WrapTextIcon } from "lucide-solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Menu, MenuContent, MenuGroup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/primitives";
import { csvLanguage, isCsvFile } from "./csv-language";
import { workspaceLanguageForFilename, workspaceLanguageForName, workspaceLanguages } from "./workspace-languages";
import { createWorkspaceSearchPanel } from "./workspace-search-panel";

export function isVisualMarkdownFile(path: string) {
  return /\.(?:md|markdown)$/i.test(path);
}

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

const sourceEditorSetup = [
  lineNumbers(),
  highlightSpecialChars(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(workspaceHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  search({ top: false, createPanel: createWorkspaceSearchPanel }),
  highlightSelectionMatches(),
  foldGutter({ markerDOM: createFoldMarker }),
  indentationGuides,
  highlightActiveLineGutter(),
  highlightActiveLine(),
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

type Indentation = "tabs:4" | "spaces:2" | "spaces:4" | "spaces:8";

const indentationOptions: ReadonlyArray<{ value: Indentation; label: string }> = [
  { value: "spaces:2", label: "Spaces: 2" },
  { value: "spaces:4", label: "Spaces: 4" },
  { value: "spaces:8", label: "Spaces: 8" },
  { value: "tabs:4", label: "Tabs: 4" },
];

function isIndentation(value: string): value is Indentation {
  return indentationOptions.some((option) => option.value === value);
}

function indentationLabel(value: Indentation) {
  return indentationOptions.find((option) => option.value === value)?.label ?? "Spaces: 2";
}

function detectIndentation(document: Text): Indentation {
  let tabs = 0;
  const spaces = new Map<number, number>();
  for (let lineNumber = 1; lineNumber <= Math.min(document.lines, 200); lineNumber += 1) {
    const text = document.line(lineNumber).text;
    if (text.startsWith("\t")) {
      tabs += 1;
      continue;
    }
    const width = text.match(/^ +\S/)?.[0].length;
    if (!width) continue;
    const indentation = width - 1;
    const size = indentation % 4 === 0 ? 4 : indentation % 2 === 0 ? 2 : 0;
    if (size) spaces.set(size, (spaces.get(size) ?? 0) + 1);
  }
  const spaceChoice = [...spaces].sort((left, right) => right[1] - left[1])[0];
  if (tabs > (spaceChoice?.[1] ?? 0)) return "tabs:4";
  return spaceChoice?.[0] === 4 ? "spaces:4" : "spaces:2";
}

function indentationExtensions(indentation: Indentation) {
  const [kind, sizeText] = indentation.split(":") as ["tabs" | "spaces", "2" | "4" | "8"];
  const size = Number(sizeText);
  return [EditorState.tabSize.of(size), indentUnit.of(kind === "tabs" ? "\t" : " ".repeat(size))];
}

export default function WorkspaceEditor(props: {
  path: string;
  value: string;
  wrap: boolean;
  editable?: boolean;
  canEdit?: boolean;
  statusText?: string;
  statusTitle?: string;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (value: string) => void;
  onToggleEditing?: () => void;
  onToggleWrap: () => void;
  reveal?: { source: string; position: number };
  onRevealed?: () => void;
  onShowDiff?: () => void;
  ref?: (handle: WorkspaceEditorHandle) => void;
}) {
  let host: HTMLDivElement | undefined;
  let positionLabel: HTMLButtonElement | undefined;
  let undoButton: HTMLButtonElement | undefined;
  let redoButton: HTMLButtonElement | undefined;
  let view: EditorView | undefined;
  const editableCompartment = new Compartment();
  const wrappingCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const historyCompartment = new Compartment();
  const indentationCompartment = new Compartment();
  const editable = () => props.editable !== false;
  let activePath = props.path;
  let savedDocument = Text.of(props.value.split("\n"));
  let languageLoadToken = 0;
  let lastDirty = false;
  const [indentation, setIndentation] = createSignal<Indentation>(detectIndentation(savedDocument));
  const [selectedLanguage, setSelectedLanguage] = createSignal(languageNameForPath(activePath));
  const documents = new Map<string, CachedDocument>();

  function languageNameForPath(path: string) {
    if (isVisualMarkdownFile(path)) return "Markdown";
    if (isCsvFile(path)) return "CSV";
    return workspaceLanguageForFilename(path)?.name ?? "Plain Text";
  }

  const updatePosition = (state: EditorState) => {
    if (!positionLabel) return;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    positionLabel.textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
    if (undoButton) undoButton.disabled = !editable() || undoDepth(state) === 0;
    if (redoButton) redoButton.disabled = !editable() || redoDepth(state) === 0;
  };

  const runCommand = (command: Command) => {
    if (!view) return;
    command(view);
    updatePosition(view.state);
  };

  const runEditCommand = (command: Command) => {
    runCommand(command);
    view?.focus();
  };

  const installLanguage = async (name: string) => {
    const token = ++languageLoadToken;
    const path = activePath;
    if (!view) return;
    if (name === "Plain Text") {
      view.dispatch({ effects: languageCompartment.reconfigure([]) });
      host?.setAttribute("data-markdown", "false");
      view.contentDOM.spellcheck = false;
      setSelectedLanguage(name);
      return;
    }
    const extensions = name === "Markdown"
      ? await import("./workspace-markdown").then(({ workspaceMarkdownExtensions }) => workspaceMarkdownExtensions())
      : name === "CSV"
        ? csvLanguage
        : await workspaceLanguageForName(name)?.load();
    if (token !== languageLoadToken || path !== activePath || !view || !extensions) return;
    view.dispatch({ effects: languageCompartment.reconfigure(extensions) });
    host?.setAttribute("data-markdown", String(name === "Markdown"));
    view.contentDOM.spellcheck = name === "Markdown";
    setSelectedLanguage(name);
  };

  const reportDirty = (dirty: boolean) => {
    if (dirty === lastDirty) return;
    lastDirty = dirty;
    props.onDirtyChange(dirty);
  };

  const stateExtensions = (path: string, documentIndentation: Indentation) => [
    editorTheme,
    sourceEditorSetup,
    historyCompartment.of(history()),
    indentationCompartment.of(indentationExtensions(documentIndentation)),
    languageCompartment.of(isCsvFile(path) ? csvLanguage : []),
    editableCompartment.of([
      EditorState.readOnly.of(!editable()),
      EditorView.editable.of(editable()),
    ]),
    wrappingCompartment.of(props.wrap ? EditorView.lineWrapping : []),
    EditorView.contentAttributes.of({
      "aria-label": `${editable() ? "Edit" : "Preview"} ${path}`,
      spellcheck: isVisualMarkdownFile(path) ? "true" : "false",
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) reportDirty(!update.state.doc.eq(savedDocument));
      if (update.docChanged || update.selectionSet) updatePosition(update.state);
    }),
    keymap.of([{
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        if (!editable()) return false;
        props.onSave(view?.state.doc.toString() ?? props.value);
        return true;
      },
    }]),
  ];

  const createDocumentState = (path: string, value: string, documentIndentation: Indentation) => EditorState.create({
    doc: value,
    extensions: stateExtensions(path, documentIndentation),
  });

  const cacheActiveDocument = () => {
    if (!view) return;
    documents.delete(activePath);
    documents.set(activePath, {
      state: view.state,
      savedDocument,
      indentation: indentation(),
      language: selectedLanguage(),
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    });
    if (documents.size <= 12) return;
    const oldestCleanPath = [...documents].find(([, document]) => document.state.doc.eq(document.savedDocument))?.[0];
    if (oldestCleanPath) documents.delete(oldestCleanPath);
  };

  const openDocument = (path: string, value: string) => {
    if (!view || path === activePath) {
      if (path === activePath && view && view.state.doc.eq(savedDocument) && value !== savedDocument.toString()) {
        editorHandle.replaceDocument(value);
      }
      return;
    }
    cacheActiveDocument();
    languageLoadToken += 1;
    activePath = path;
    const incomingDocument = Text.of(value.split("\n"));
    const cached = documents.get(path);
    const canRestore = Boolean(cached && (!cached.state.doc.eq(cached.savedDocument) || cached.savedDocument.eq(incomingDocument)));
    const nextIndentation = canRestore ? cached!.indentation : detectIndentation(incomingDocument);
    const nextLanguage = canRestore ? cached!.language : languageNameForPath(path);
    savedDocument = canRestore ? cached!.savedDocument : incomingDocument;
    setIndentation(nextIndentation);
    setSelectedLanguage(nextLanguage);
    host?.setAttribute("data-markdown", String(nextLanguage === "Markdown"));
    view.setState(canRestore ? cached!.state : createDocumentState(path, value, nextIndentation));
    view.dispatch({
      effects: [
        editableCompartment.reconfigure([
          EditorState.readOnly.of(!editable()),
          EditorView.editable.of(editable()),
        ]),
        wrappingCompartment.reconfigure(props.wrap ? EditorView.lineWrapping : []),
      ],
    });
    view.contentDOM.setAttribute("aria-label", `${editable() ? "Edit" : "Preview"} ${path}`);
    view.contentDOM.spellcheck = nextLanguage === "Markdown";
    lastDirty = !view.state.doc.eq(savedDocument);
    props.onDirtyChange(lastDirty);
    updatePosition(view.state);
    const scrollTop = canRestore ? cached!.scrollTop : 0;
    const scrollLeft = canRestore ? cached!.scrollLeft : 0;
    requestAnimationFrame(() => {
      if (!view || activePath !== path) return;
      view.scrollDOM.scrollTop = scrollTop;
      view.scrollDOM.scrollLeft = scrollLeft;
    });
    if (!canRestore && nextLanguage !== "Plain Text" && nextLanguage !== "CSV") void installLanguage(nextLanguage).catch(() => undefined);
  };

  const editorHandle: WorkspaceEditorHandle = {
    getValue: () => view?.state.doc.toString() ?? props.value,
    focus: () => view?.focus(),
    acknowledgeSaved(value) {
      savedDocument = Text.of(value.split("\n"));
      reportDirty(Boolean(view && !view.state.doc.eq(savedDocument)));
    },
    replaceDocument(value) {
      const nextDocument = Text.of(value.split("\n"));
      savedDocument = nextDocument;
      if (!view || view.state.doc.eq(nextDocument)) {
        reportDirty(false);
        return;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        effects: historyCompartment.reconfigure(history()),
        annotations: Transaction.addToHistory.of(false),
      });
      reportDirty(false);
    },
    openDocument,
  };
  props.ref?.(editorHandle);

  createEffect(() => {
    const path = props.path;
    const value = props.value;
    if (view && path !== activePath) openDocument(path, value);
  });

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
    view.contentDOM.setAttribute("aria-label", `${nextEditable ? "Edit" : "Preview"} ${activePath}`);
    updatePosition(view.state);
    if (nextEditable) view.focus();
  });

  onMount(() => {
    const setup = () => {
      if (!host) return;
      view = new EditorView({
        parent: host,
        state: createDocumentState(activePath, props.value, indentation()),
      });
      updatePosition(view.state);
      view.contentDOM.setAttribute("aria-label", `${editable() ? "Edit" : "Preview"} ${activePath}`);
      if (editable()) view.focus();
    };
    setup();
    const languageName = languageNameForPath(activePath);
    if (languageName !== "Plain Text" && languageName !== "CSV") void installLanguage(languageName).catch(() => undefined);
    onCleanup(() => {
      languageLoadToken += 1;
      view?.destroy();
      view = undefined;
    });
  });

  createEffect(() => {
    const request = props.reveal;
    const path = props.path;
    if (!request) return;
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    // A staged or original-side location must be mapped into the live buffer,
    // which may also contain unsaved edits. Load diffing only for this action.
    void import("@codemirror/merge").then(({ diff }) => {
      if (cancelled || !view || activePath !== path) return;
      const source = request.source.replace(/\r\n?/g, "\n");
      const target = view.state.doc.toString();
      const position = Math.max(0, Math.min(request.position, source.length));
      let mapped = position;
      for (const change of diff(source, target, { scanLimit: 500, timeout: 40 })) {
        if (position < change.fromA) break;
        if (position <= change.toA) {
          mapped = change.fromB + Math.min(position - change.fromA, change.toB - change.fromB);
          break;
        }
        mapped = position + change.toB - change.toA;
      }
      const anchor = Math.max(0, Math.min(mapped, view.state.doc.length));
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      view.focus();
      props.onRevealed?.();
    });
  });

  return <div class="workspace-code-surface" data-editable={editable()}>
    <div ref={host} class="workspace-code-editor" data-markdown={isVisualMarkdownFile(props.path)} data-wrap={props.wrap} />
    <footer class="workspace-editor-status" aria-label="Editor status">
      <div class="workspace-editor-command-group">
        <button type="button" class="workspace-editor-mode" disabled={!props.canEdit} aria-label={editable() ? "Close editor" : "Edit file"} aria-pressed={editable()} onClick={() => props.onToggleEditing?.()}>
          <Show when={editable()} fallback={<PencilOffIcon />}><PencilIcon /></Show>
          <span>{editable() ? "Editing" : "Preview"}</span>
        </button>
        <Show when={props.onShowDiff}><button type="button" aria-pressed="true">File</button><button type="button" aria-pressed="false" onClick={() => props.onShowDiff?.()}>Diff</button></Show>
        <button type="button" aria-label="Find or replace" title="Find or replace (Ctrl+F)" onClick={() => runCommand(openSearchPanel)}><SearchIcon /></button>
        <button ref={undoButton} type="button" class="workspace-edit-command" aria-label="Undo" title="Undo (Ctrl+Z)" disabled onClick={() => runEditCommand(undo)}><Undo2Icon /></button>
        <button ref={redoButton} type="button" class="workspace-edit-command" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled onClick={() => runEditCommand(redo)}><Redo2Icon /></button>
        <button type="button" class="workspace-edit-command" aria-label="Outdent selection" title="Outdent selection (Shift+Tab)" onClick={() => runEditCommand(indentLess)}><IndentDecreaseIcon /></button>
        <button type="button" class="workspace-edit-command" aria-label="Indent selection" title="Indent selection (Tab)" onClick={() => runEditCommand(indentMore)}><IndentIncreaseIcon /></button>
      </div>
      <div class="workspace-editor-detail-group">
        <span class="workspace-editor-metadata" title={props.statusTitle ?? props.statusText}>{props.statusText}</span>
        <button type="button" ref={positionLabel} aria-label="Go to line" title="Go to line (Alt+G)" onClick={() => runCommand(gotoLine)}>Ln 1, Col 1</button>
        <button type="button" aria-label={props.wrap ? "Disable line wrapping" : "Enable line wrapping"} title={props.wrap ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={props.wrap} onClick={() => { props.onToggleWrap(); view?.focus(); }}><WrapTextIcon /></button>
        <Menu>
          <MenuTrigger class="workspace-editor-picker" aria-label={`Indentation ${indentationLabel(indentation())}`} title="Indentation">
            <span>{indentationLabel(indentation())}</span><ChevronDownIcon />
          </MenuTrigger>
          <MenuContent class="workspace-editor-picker-menu">
            <MenuGroup>
              <MenuRadioGroup value={indentation()} onChange={(value) => {
                if (!isIndentation(value)) return;
                setIndentation(value);
                view?.dispatch({ effects: indentationCompartment.reconfigure(indentationExtensions(value)) });
                view?.focus();
              }}>
                <For each={indentationOptions}>{(option) => <MenuRadioItem value={option.value}>{option.label}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger class="workspace-editor-picker" aria-label={`Language mode ${selectedLanguage()}`} title="Language mode">
            <span>{selectedLanguage()}</span><ChevronDownIcon />
          </MenuTrigger>
          <MenuContent class="workspace-editor-picker-menu workspace-editor-language-menu">
            <MenuGroup>
              <MenuRadioGroup value={selectedLanguage()} onChange={(value) => void installLanguage(value).catch(() => undefined)}>
                <MenuRadioItem value="Plain Text">Plain Text</MenuRadioItem>
                <MenuRadioItem value="Markdown">Markdown</MenuRadioItem>
                <MenuRadioItem value="CSV">CSV</MenuRadioItem>
                <For each={workspaceLanguages}>{(language) => <MenuRadioItem value={language.name}>{language.name}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </MenuContent>
        </Menu>
      </div>
    </footer>
  </div>;
}

export interface WorkspaceEditorHandle {
  getValue: () => string;
  focus: () => void;
  acknowledgeSaved: (value: string) => void;
  replaceDocument: (value: string) => void;
  openDocument: (path: string, value: string) => void;
}

interface CachedDocument {
  state: EditorState;
  savedDocument: Text;
  indentation: Indentation;
  language: string;
  scrollTop: number;
  scrollLeft: number;
}
