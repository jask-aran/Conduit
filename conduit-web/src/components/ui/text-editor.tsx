import { history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Redo2Icon, Undo2Icon, WrapTextIcon } from "lucide-solid";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { codeReadOnlySetup } from "./code-setup";
import { FileButton } from "./file";
import * as Icons from "./icons";

/*
 * Text edited in a pane of its own (a prompt block, a note): the workspace editor's setup (code-setup.ts: its theme,
 * highlighting, line numbers, find and replace) in a box that scrolls inside itself, so a settings page never scrolls
 * for its text. The tags a prompt is wrapped in and the {{slots}} filled in are marked as PromptText marks them.
 * Its bar: find, undo, redo, wrap; Mod-S saves when onSave is given.
 */
const slotMarks = new MatchDecorator({
  regexp: /\{\{[^{}\n]*\}\}|<\/?(?:[a-z][\w-]*|\{\{[^{}\n]*\}\})(?:\s[^<>\n]*)?>/gi,
  decoration: (match) => Decoration.mark({ class: match[0].startsWith("{{") ? "ui-prompt-slot" : "ui-prompt-tag" }),
});
const promptMarks = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = slotMarks.createDeco(view); }
  update(update: ViewUpdate) { this.decorations = slotMarks.updateDeco(update, this.decorations); }
}, { decorations: (plugin) => plugin.decorations });

export function TextEditor(props: { value: string; label: string; onChange?: (value: string) => void; onSave?: () => void; readOnly?: boolean; markdown?: boolean; wrap?: boolean; fill?: boolean }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const editable = new Compartment();
  const wrapping = new Compartment();
  const [wrap, setWrap] = createSignal(props.wrap ?? true);
  const [depth, setDepth] = createSignal({ undo: 0, redo: 0 });
  onMount(() => {
    view = new EditorView({ parent: host, state: EditorState.create({ doc: props.value, extensions: [
      codeReadOnlySetup(),
      history(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      promptMarks,
      ...(props.markdown === false ? [] : [markdown()]),
      editable.of([EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly)]),
      wrapping.of(wrap() ? EditorView.lineWrapping : []),
      EditorView.contentAttributes.of({ "aria-label": props.label, spellcheck: "true" }),
      keymap.of([...historyKeymap, indentWithTab, { key: "Mod-s", preventDefault: true, run: () => { if (!props.onSave) return false; props.onSave(); return true; } }]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        setDepth({ undo: undoDepth(update.state), redo: redoDepth(update.state) });
        // A change the host made (a reset, a load) is not an edit to report back.
        if (update.transactions.some((transaction) => transaction.isUserEvent("input") || transaction.isUserEvent("delete") || transaction.isUserEvent("undo") || transaction.isUserEvent("redo") || transaction.isUserEvent("move")))
          props.onChange?.(update.state.doc.toString());
      }),
    ] }) });
  });
  onCleanup(() => view?.destroy());
  // The host's value wins when it is not what the editor holds: a block loaded, reset or saved elsewhere.
  createEffect(() => {
    const value = props.value;
    if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
  createEffect(() => { const readOnly = Boolean(props.readOnly); view?.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) }); });
  createEffect(() => { const on = wrap(); view?.dispatch({ effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []) }); });
  const run = (command: (target: EditorView) => boolean) => { if (view) { command(view); view.focus(); } };
  return <div class="ui-text-editor" data-fill={props.fill ? "" : undefined} data-readonly={props.readOnly ? "" : undefined}>
    <div class="ui-text-editor-bar">
      <FileButton label="Find and replace (Ctrl+F)" onClick={() => run(openSearchPanel)}><Icons.Search /></FileButton>
      <Show when={!props.readOnly}>
        <FileButton label="Undo (Ctrl+Z)" disabled={!depth().undo} onClick={() => run(undo)}><Undo2Icon /></FileButton>
        <FileButton label="Redo (Ctrl+Shift+Z)" disabled={!depth().redo} onClick={() => run(redo)}><Redo2Icon /></FileButton>
      </Show>
      <FileButton label={wrap() ? "Don't wrap lines" : "Wrap lines"} aria-pressed={wrap()} onClick={() => setWrap(!wrap())}><WrapTextIcon /></FileButton>
    </div>
    <div ref={host} class="ui-text-editor-host" />
  </div>;
}
