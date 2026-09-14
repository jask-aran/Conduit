import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip } from "@codemirror/view";
import { createEffect, createSignal, Show } from "solid-js";
import type { ReviewCommentSide } from "../chat/review-comments";

/** A character range described as whole lines plus the columns it ran between. */
export interface AnnotationSpan {
  side: ReviewCommentSide;
  from: number;
  to: number;
  startColumn: number;
  endColumn: number;
  excerpt: string;
  /** Set on a counterpart the selection ran through, rather than one added as context. */
  selected?: boolean;
}

export interface AnnotationSelection extends AnnotationSpan {
  /** The other side of a comparison, when the selection came from one. */
  counterpart?: AnnotationSpan;
  left: number;
  top: number;
}

/** What a selection reader found, in viewport coordinates. */
export interface AnnotationReading {
  span: AnnotationSpan;
  counterpart?: AnnotationSpan;
  left: number;
  bottom: number;
}

export interface CommentHighlight {
  from: number;
  to: number;
  startColumn: number;
  endColumn: number;
  note: string;
  side?: ReviewCommentSide;
}

export function annotationSpan(doc: Text, side: ReviewCommentSide, from: number, to: number): AnnotationSpan | null {
  const start = doc.lineAt(Math.max(0, Math.min(from, doc.length)));
  const end = doc.lineAt(Math.max(0, Math.min(Math.max(from, to - 1), doc.length)));
  if (to <= from) return null;
  return {
    side,
    from: start.number,
    to: end.number,
    startColumn: from - start.from + 1,
    endColumn: Math.min(to, end.to) - end.from + 1,
    excerpt: doc.sliceString(start.from, end.to),
  };
}

/** Resolves a comment's line and column pair against a document. */
export function commentRange(view: EditorView, item: Pick<CommentHighlight, "from" | "to" | "startColumn" | "endColumn">) {
  const doc = view.state.doc;
  const start = doc.line(Math.max(1, Math.min(item.from, doc.lines)));
  const end = doc.line(Math.max(1, Math.min(item.to, doc.lines)));
  const from = start.from + Math.max(0, Math.min(item.startColumn - 1, start.length));
  const to = end.from + Math.max(0, Math.min(item.endColumn - 1, end.length));
  return to > from ? { from, to } : null;
}

export type CommentLocator = (view: EditorView, item: CommentHighlight) => { from: number; to: number } | null;

export function commentHighlightsExtension(items: readonly CommentHighlight[], locate: CommentLocator = commentRange): Extension {
  return [
    EditorView.decorations.of((view) => Decoration.set(items.flatMap((item) => {
      const range = locate(view, item);
      return range ? [Decoration.mark({ class: "cm-review-comment" }).range(range.from, range.to)] : [];
    }).sort((left, right) => left.from - right.from))),
    hoverTooltip((view, position) => {
      const item = items.find((candidate) => {
        const range = locate(view, candidate);
        return range && position >= range.from && position <= range.to;
      });
      if (!item) return null;
      return {
        pos: view.state.doc.lineAt(position).from,
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

const POPUP_WIDTH = 300;

/** Where a popup should sit so it clears the selection: just past its end. */
export function selectionEnd(view: EditorView) {
  const range = view.state.selection.main;
  return view.coordsAtPos(range.to) ?? view.coordsAtPos(range.head) ?? view.coordsAtPos(range.from);
}

export function annotationExtension(options: {
  side: ReviewCommentSide;
  onSelect: (selection: AnnotationSelection | null) => void;
  /** Pairs the selection with the same passage on the other side of a comparison. */
  counterpart?: (side: ReviewCommentSide, from: number, to: number) => AnnotationSpan | undefined;
  /**
   * Describes the selection in terms the view uses, such as an inline
   * comparison's per-side rows. Returns `undefined` to fall back to the
   * editor's own line numbers.
   */
  read?: (view: EditorView) => AnnotationReading | null | undefined;
}): Extension {
  const publish = (view: EditorView, reading: AnnotationReading | null) => {
    if (!reading) return options.onSelect(null);
    // Columns pin the comment to the characters the reader chose; the excerpt
    // still carries the whole lines so the span has context around it.
    const host = view.dom.closest(".workspace-comparison-content, .workspace-editor-content")?.getBoundingClientRect();
    const left = reading.left - (host?.left ?? 0);
    options.onSelect({
      ...reading.span,
      counterpart: reading.counterpart,
      // The box sits past the end of the selection, and inside the view.
      left: Math.max(4, host ? Math.min(left, host.width - POPUP_WIDTH) : left),
      top: reading.bottom - (host?.top ?? 0),
    });
  };
  const fromState = (view: EditorView): AnnotationReading | null => {
    const range = view.state.selection.main;
    if (range.empty) return null;
    const span = annotationSpan(view.state.doc, options.side, range.from, range.to);
    const coords = selectionEnd(view);
    if (!span || !coords) return null;
    return { span, counterpart: options.counterpart?.(options.side, range.from, range.to), left: coords.left, bottom: coords.bottom };
  };
  const readSelection = (view: EditorView) => {
    const reading = options.read?.(view);
    return reading === undefined ? fromState(view) : reading;
  };
  return [
    EditorView.updateListener.of((update) => {
      if (update.selectionSet) publish(update.view, readSelection(update.view));
    }),
  ];
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
