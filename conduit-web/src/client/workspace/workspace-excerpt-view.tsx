import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { createEffect, onCleanup } from "solid-js";
import type { ReviewCommentCounterpart, ReviewCommentSide } from "../chat/review-comments";
import { commentRange } from "./workspace-annotate";
import { inlineLineNumbers, workspaceInlineDiff } from "./workspace-diff-setup";
import { buildInlineDiff, inlineDocLine } from "./workspace-inline-diff";
import { workspaceExcerptSetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
import "./workspace.css";

/**
 * A window onto the lines a review comment was written against, rendered by the
 * same CodeMirror setup as the file viewer so an excerpt reads exactly as it did
 * where it was captured, gutter numbers and all. A comment taken on a comparison
 * carries the other side with it, and is rendered by the same inline diff the
 * comparison itself uses.
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
    const side: ReviewCommentSide = props.side === "original" ? "original" : "modified";
    const counterpart = props.counterpart;
    const language = new Compartment();
    // Numbering stays in the file's own terms, so the excerpt reads as a window.
    const offset = (value: number | null, first: number) => value === null ? null : value + first - 1;
    const diff = counterpart && (() => {
      const original = side === "original" ? props.text : counterpart.excerpt;
      const modified = side === "original" ? counterpart.excerpt : props.text;
      const firstOriginal = side === "original" ? props.firstLine : counterpart.from;
      const firstModified = side === "original" ? counterpart.from : props.firstLine;
      const built = buildInlineDiff(original, modified);
      return {
        doc: built.doc,
        rows: built.rows.map((row) => ({ ...row, original: offset(row.original, firstOriginal), modified: offset(row.modified, firstModified) })),
      };
    })();
    const highlight = { from: props.firstLine, to: props.firstLine + props.text.split("\n").length - 1, startColumn: props.startColumn, endColumn: props.endColumn, note: props.note ?? "", side };
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: diff ? diff.doc : props.text,
        extensions: [
          workspaceExcerptSetup(diff ? inlineLineNumbers : { formatNumber: (number) => String(number + props.firstLine - 1) }),
          language.of([]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": `${props.path} lines ${highlight.from} to ${highlight.to}` }),
          ...(diff ? [workspaceInlineDiff(diff.rows)] : []),
          // The commented characters read as they do when a chip reveals them;
          // the lines that came along for context step back.
          EditorView.decorations.of((target) => {
            const doc = target.state.doc;
            const from = diff ? inlineDocLine(diff.rows, side, highlight.from) : 1;
            const to = diff ? inlineDocLine(diff.rows, side, highlight.to) : doc.lines;
            const range = from && to ? commentRange(target, { ...highlight, from, to }) : null;
            if (!range) return Decoration.none;
            return Decoration.set([
              ...(range.from > 0 ? [Decoration.mark({ class: "cm-review-context" }).range(0, range.from)] : []),
              Decoration.mark({ class: "cm-review-comment" }).range(range.from, range.to),
              ...(range.to < doc.length ? [Decoration.mark({ class: "cm-review-context" }).range(range.to, doc.length)] : []),
            ]);
          }),
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
