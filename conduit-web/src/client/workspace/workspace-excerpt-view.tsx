import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import { createEffect, onCleanup } from "solid-js";
import type { ReviewCommentCounterpart, ReviewCommentSide } from "../chat/review-comments";
import { commentRange } from "./workspace-annotate";
import { workspaceExcerptSetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
import "./workspace.css";

/**
 * A window onto the lines a review comment was written against, rendered by the
 * same CodeMirror setup as the file viewer so an excerpt reads exactly as it did
 * where it was captured, gutter numbers and all. A comment taken on a comparison
 * carries the other side with it, and is rendered as the diff it came from.
 */
export default function WorkspaceExcerptView(props: {
  path: string;
  text: string;
  firstLine: number;
  startColumn: number;
  endColumn: number;
  note?: string;
  side?: ReviewCommentSide;
  counterpart?: ReviewCommentCounterpart;
}) {
  let host!: HTMLDivElement;
  createEffect(() => {
    const onModified = props.side !== "original";
    const modified = onModified ? props.text : props.counterpart?.excerpt ?? "";
    const original = onModified ? props.counterpart?.excerpt : props.text;
    const firstLine = onModified ? props.firstLine : props.counterpart?.from ?? 1;
    const lines = modified.split("\n").length;
    const language = new Compartment();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: modified,
        extensions: [
          workspaceExcerptSetup(firstLine),
          language.of([]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": `${props.path} lines ${props.firstLine} to ${props.firstLine + props.text.split("\n").length - 1}`,
          }),
          // The commented characters read as they do when a chip reveals them;
          // the lines that came along for context step back.
          ...(onModified ? [EditorView.decorations.of((view) => {
            const range = commentRange(view, { from: 1, to: lines, startColumn: props.startColumn, endColumn: props.endColumn });
            const end = view.state.doc.length;
            if (!range) return Decoration.none;
            return Decoration.set([
              ...(range.from > 0 ? [Decoration.mark({ class: "cm-review-context" }).range(0, range.from)] : []),
              Decoration.mark({ class: "cm-review-comment" }).range(range.from, range.to),
              ...(range.to < end ? [Decoration.mark({ class: "cm-review-context" }).range(range.to, end)] : []),
            ]);
          })] : []),
          ...(original === undefined ? [] : [unifiedMergeView({
            original,
            mergeControls: false,
            gutter: false,
            highlightChanges: true,
            syntaxHighlightDeletions: true,
          })]),
        ],
      }),
    });
    let disposed = false;
    const description = workspaceLanguageForFilename(props.path);
    if (description) {
      void description.load()
        .then((support) => { if (!disposed) view.dispatch({ effects: language.reconfigure(support) }); })
        .catch(() => undefined);
    }
    onCleanup(() => {
      disposed = true;
      view.destroy();
    });
  });
  return <div ref={host} class="workspace-excerpt" data-side={props.side} data-comparison={props.counterpart ? "true" : undefined} />;
}
