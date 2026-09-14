import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEffect, onCleanup } from "solid-js";
import type { ReviewCommentSide } from "../chat/review-comments";
import { commentHighlightsExtension } from "./workspace-annotate";
import { workspaceExcerptSetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
import "./workspace.css";

/**
 * A window onto the lines a review comment was written against, rendered by the
 * same CodeMirror setup as the file viewer so an excerpt reads exactly as it did
 * where it was captured, gutter numbers and all.
 */
export default function WorkspaceExcerptView(props: {
  path: string;
  text: string;
  firstLine: number;
  startColumn: number;
  endColumn: number;
  note?: string;
  side?: ReviewCommentSide;
}) {
  let host!: HTMLDivElement;
  createEffect(() => {
    const lines = props.text.split("\n").length;
    const language = new Compartment();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          workspaceExcerptSetup(props.firstLine),
          language.of([]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": `${props.path} lines ${props.firstLine} to ${props.firstLine + lines - 1}`,
          }),
          commentHighlightsExtension([{
            from: 1,
            to: lines,
            startColumn: props.startColumn,
            endColumn: props.endColumn,
            note: props.note ?? "",
          }]),
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
  return <div ref={host} class="workspace-excerpt" data-side={props.side} />;
}
