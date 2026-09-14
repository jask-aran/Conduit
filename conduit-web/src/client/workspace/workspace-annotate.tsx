import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip } from "@codemirror/view";
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

export interface CommentHighlight {
  from: number;
  to: number;
  note: string;
  side?: ReviewCommentSide;
}

export function commentHighlightsExtension(items: readonly CommentHighlight[]): Extension {
  return [
    EditorView.decorations.of((view) => Decoration.set(items.flatMap((item) => {
      const start = view.state.doc.line(Math.max(1, Math.min(item.from, view.state.doc.lines)));
      const end = view.state.doc.line(Math.max(1, Math.min(item.to, view.state.doc.lines)));
      return start.from < end.to ? [Decoration.mark({ class: "cm-review-comment" }).range(start.from, end.to)] : [];
    }).sort((left, right) => left.from - right.from))),
    hoverTooltip((view, position) => {
      const line = view.state.doc.lineAt(position);
      const item = items.find((candidate) => line.number >= candidate.from && line.number <= candidate.to);
      if (!item) return null;
      return {
        pos: line.from,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "workspace-review-comment-tooltip";
          dom.textContent = item.note || "Referenced without a note";
          return { dom };
        },
      };
    }),
  ];
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
  let noteInput: HTMLTextAreaElement | undefined;
  // `autofocus` only applies while the document parses; this box arrives later.
  createEffect(() => { if (open()) queueMicrotask(() => noteInput?.focus({ preventScroll: true })); });
  createEffect(() => {
    props.selection;
    setOpen(false);
    setNote("");
    setError("");
  });
  const add = () => {
    if (!props.onAdd(note())) return setError("Limit of 12 references reached");
    props.onDismiss();
    queueMicrotask(() => {
      document.querySelector<HTMLTextAreaElement>(".composer textarea:not([disabled])")?.focus({ preventScroll: true });
    });
  };
  return <div class="workspace-annotation" style={{ left: `${props.selection.left}px`, top: `${props.selection.top}px` }}>
    <Show when={open()} fallback={<button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(true)}>Comment</button>}>
      <textarea ref={noteInput} aria-label={`Comment on lines ${props.selection.from}-${props.selection.to}`} rows={2} maxlength={2000} value={note()} onInput={(event) => setNote(event.currentTarget.value)} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); add(); }
      }} />
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={add}>Add</button>
      <Show when={error()}><small role="alert">{error()}</small></Show>
    </Show>
  </div>;
}
