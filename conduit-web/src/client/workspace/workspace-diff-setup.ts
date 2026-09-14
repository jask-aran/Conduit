import { MergeView, type DirectMergeConfig } from "@codemirror/merge";
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker } from "@codemirror/view";
import { inlineRowNumber, type InlineRow } from "./workspace-inline-diff";

/**
 * Everything a comparison looks like, carried by the extension rather than by
 * the container it is mounted in. A CodeMirror theme travels with the editor,
 * so a diff embedded in a dialog, a panel, or anywhere else reads the same
 * without its host restating a single rule.
 */
export const workspaceDiffTheme = EditorView.theme({
  ".cm-content": { caretColor: "transparent !important" },
  ".cm-cursor": { display: "none" },
  ".cm-changeGutter": { width: "0", minWidth: "0", overflow: "visible", padding: "0" },
  ".cm-changeGutter .cm-gutterElement": { width: "3px", minWidth: "3px", padding: "0", transform: "translateX(-3px)" },
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": { background: "color-mix(in srgb, var(--destructive) 14%, transparent)" },
  "&.cm-merge-b .cm-changedLine": { background: "color-mix(in srgb, var(--workspace-git-added) 14%, transparent)" },
  ".cm-changedText, .cm-deletedText": { background: "none !important", textDecoration: "none" },
  "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": { background: "var(--destructive)" },
  "&.cm-merge-b .cm-changedLineGutter": { background: "var(--workspace-git-added)" },
  ".cm-mergeSpacer": {
    background: "repeating-linear-gradient(135deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)",
    opacity: ".45",
  },
  ".cm-collapsedLines": {
    border: "0",
    borderBlock: "1px solid var(--border)",
    background: "transparent",
    color: "var(--muted-foreground)",
    padding: "4px 10px",
    font: "10px var(--font-sans)",
    cursor: "pointer",
  },
  ".cm-collapsedLines:hover": { background: "var(--accent)", color: "var(--foreground)" },
  ".cm-deletedLine, .cm-deletedLine del": { textDecoration: "none" },
  ".cm-diff-removed": { background: "color-mix(in srgb, var(--destructive) 14%, transparent)" },
  ".cm-diff-added": { background: "color-mix(in srgb, var(--workspace-git-added) 14%, transparent)" },
  ".cm-diff-removed-gutter": { background: "var(--destructive)" },
  ".cm-diff-added-gutter": { background: "var(--workspace-git-added)" },
});

/** Replaces the rows an inline comparison is standing on. */
export const setInlineRows = StateEffect.define<readonly InlineRow[]>();

const inlineRows = StateField.define<readonly InlineRow[]>({
  create: () => [],
  update(rows, transaction) {
    for (const effect of transaction.effects) if (effect.is(setInlineRows)) return effect.value;
    return rows;
  },
});

/** The rows of the inline comparison a state is showing, if it is one. */
export const inlineRowsOf = (state: EditorState): readonly InlineRow[] | null => state.field(inlineRows, false) ?? null;

class ChangeMarker extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
}

const removedMarker = new ChangeMarker("cm-diff-removed-gutter");
const addedMarker = new ChangeMarker("cm-diff-added-gutter");
const removedLine = Decoration.line({ class: "cm-diff-removed" });
const addedLine = Decoration.line({ class: "cm-diff-added" });

const eachChangedRow = <T,>(state: EditorState, make: (kind: "removed" | "added", from: number) => T, collect: (value: T, from: number) => void) => {
  const rows = state.field(inlineRows, false) ?? [];
  const doc = state.doc;
  for (let number = 1; number <= doc.lines && number <= rows.length; number++) {
    const kind = rows[number - 1]!.kind;
    if (kind === "context") continue;
    const { from } = doc.line(number);
    collect(make(kind, from), from);
  }
};

/** Numbers each row in the document it belongs to, rather than in this view. */
export const inlineLineNumbers = {
  formatNumber: (line: number, state: EditorState) => inlineRowNumber((state.field(inlineRows, false) ?? [])[line - 1]),
};

/**
 * An inline comparison: one document holding both sides, each line marked and
 * numbered as the side it came from. Selection, search and copy work on the
 * removed lines because they are lines, not widgets.
 */
export function workspaceInlineDiff(rows: readonly InlineRow[]): Extension {
  return [
    workspaceDiffTheme,
    inlineRows.init(() => rows),
    EditorView.decorations.compute([inlineRows, "doc"], (state) => {
      const marks: ReturnType<typeof removedLine.range>[] = [];
      eachChangedRow(state, (kind, from) => (kind === "removed" ? removedLine : addedLine).range(from), (value) => marks.push(value));
      return Decoration.set(marks);
    }),
    Prec.low(gutter({
      class: "cm-changeGutter",
      markers: (view) => {
        const builder = new RangeSetBuilder<GutterMarker>();
        eachChangedRow(view.state, (kind) => kind === "removed" ? removedMarker : addedMarker, (marker, from) => builder.add(from, from, marker));
        return builder.finish();
      },
    })),
  ];
}

/** How every comparison in the workspace reads its chunks. */
export const workspaceDiffOptions = {
  highlightChanges: true,
  gutter: true,
  diffConfig: { scanLimit: 500, timeout: 40 },
} as const;

/** A side-by-side comparison, styled the same way on both sides. */
export function workspaceMergeView(config: DirectMergeConfig): MergeView {
  const styled = (side: DirectMergeConfig["a"]) => ({ ...side, extensions: [workspaceDiffTheme, side?.extensions ?? []] });
  return new MergeView({ ...workspaceDiffOptions, ...config, a: styled(config.a), b: styled(config.b) });
}
