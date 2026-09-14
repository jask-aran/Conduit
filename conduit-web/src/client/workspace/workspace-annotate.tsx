import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEffect, createSignal, Show } from "solid-js";
import type { ReviewCommentSide } from "../chat/review-comments";

export interface AnnotationSelection {
  side: ReviewCommentSide;
  from: number;
  to: number;
  excerpt: string;
  left: number;
  top: number;
}

export function annotationExtension(options: {
  side: ReviewCommentSide;
  onSelect: (selection: AnnotationSelection | null) => void;
}): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const range = update.state.selection.main;
    if (range.empty) {
      options.onSelect(null);
      return;
    }
    const start = update.state.doc.lineAt(range.from);
    const end = update.state.doc.lineAt(Math.max(range.from, range.to - 1));
    const coords = update.view.coordsAtPos(range.head);
    if (!coords) return;
    const host = update.view.dom.closest(".workspace-comparison-content, .workspace-editor-content")?.getBoundingClientRect();
    options.onSelect({
      side: options.side,
      from: start.number,
      to: end.number,
      excerpt: update.state.doc.sliceString(start.from, end.to),
      left: coords.left - (host?.left ?? 0),
      top: coords.bottom - (host?.top ?? 0),
    });
  });
}

export function WorkspaceAnnotationPopup(props: {
  selection: AnnotationSelection;
  onAdd: (note: string) => boolean;
  onDismiss: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal("");
  createEffect(() => {
    props.selection;
    setOpen(false);
    setNote("");
    setError("");
  });
  const add = () => {
    if (props.onAdd(note())) props.onDismiss();
    else setError("Limit of 12 references reached");
  };
  return <div class="workspace-annotation" style={{ left: `${props.selection.left}px`, top: `${props.selection.top}px` }}>
    <Show when={open()} fallback={<button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(true)}>Comment</button>}>
      <textarea autofocus aria-label={`Comment on lines ${props.selection.from}-${props.selection.to}`} rows={2} maxlength={2000} value={note()} onInput={(event) => setNote(event.currentTarget.value)} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); add(); }
      }} />
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={add}>Add</button>
      <Show when={error()}><small role="alert">{error()}</small></Show>
    </Show>
  </div>;
}
