import { MergeView, unifiedMergeView, type DirectMergeConfig } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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
});

/** How every comparison in the workspace reads its chunks. */
export const workspaceDiffOptions = {
  highlightChanges: true,
  gutter: true,
  diffConfig: { scanLimit: 500, timeout: 40 },
} as const;

/** A unified comparison, styled, for embedding wherever one is needed. */
export function workspaceUnifiedMerge(original: string, options: Partial<Parameters<typeof unifiedMergeView>[0]> = {}): Extension {
  return [
    workspaceDiffTheme,
    unifiedMergeView({
      original,
      mergeControls: false,
      syntaxHighlightDeletions: true,
      ...workspaceDiffOptions,
      ...options,
    }),
  ];
}

/** A side-by-side comparison, styled the same way on both sides. */
export function workspaceMergeView(config: DirectMergeConfig): MergeView {
  const styled = (side: DirectMergeConfig["a"]) => ({ ...side, extensions: [workspaceDiffTheme, side?.extensions ?? []] });
  return new MergeView({ ...workspaceDiffOptions, ...config, a: styled(config.a), b: styled(config.b) });
}
