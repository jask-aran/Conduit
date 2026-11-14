import { createComputed, For, on, Show } from "solid-js";
import { Group, Keycap, OverlayPage, SettingLine, SettingValue } from "@/components/ui";
import { OverlayDialog } from "@/components/ui/dialog";
import type { DocumentMarkKind } from "./host";

/**
 * One thing done in a paper and its ways: chords in the editor's notation (`Mod-Alt-1`, as `addKeyboardShortcuts` names them) and text typed
 * where a line or a word starts (`typed`, `space` when a Space ends it). A row with `command` is one of the app's palette commands
 * (ARTIFACT_COMMANDS): the app names it and adds the keys it is bound to.
 */
export type PaperKey = ({ does: string } | { command: string }) & { keys?: readonly string[]; typed?: string; space?: boolean };
export type PaperKeyGroup = "Writing" | "Blocks" | "Comments" | "Paper";
/** A row as the sheet shows it, its chords already written in the app's words. */
export type PaperKeyRow = { does: string; keys: string[]; typed?: string; space?: boolean };

/** The marks' chords, which the format's StarterKit binds. */
export const PAPER_MARK_KEYS: Record<Exclude<DocumentMarkKind, "color" | "highlight">, string> = { bold: "Mod-b", italic: "Mod-i", strike: "Mod-Shift-s", code: "Mod-e" };
/** Asks the one comments go to about the text selected, or the caret's block (editor.tsx). */
export const PAPER_COMMENT_KEY = "Mod-Alt-m";
// Read here, not from the app's shortcut environment: the editor is lifted whole into other projects.
const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** A chord in the editor's notation (`Mod-Shift-s`) as its hints write it: Mod is ⌘ on Apple platforms and Ctrl elsewhere. */
export const paperKeys = (chord: string) => chord.split("-").map((key) => key === "Mod" ? apple ? "⌘" : "Ctrl" : key.length === 1 ? key.toUpperCase() : key);

/*
 * Most of these are bound inside the editor's libraries (the format's StarterKit, task list and table, with their input rules), which say them only
 * in their own keymaps, so each is declared here once as they bind it. Undo and redo are the editor's own (editor.tsx), Find find.tsx's, a date
 * nodes.tsx's, `/` and `@` the typed menus' (typed.tsx, editor.tsx), and a reply's Mod-Enter the comment margin's (components/markup/margin.tsx).
 */
export const PAPER_KEYS: Record<PaperKeyGroup, readonly PaperKey[]> = {
  Writing: [
    { does: "Bold", keys: [PAPER_MARK_KEYS.bold], typed: "**text**" },
    { does: "Italic", keys: [PAPER_MARK_KEYS.italic], typed: "*text*" },
    { does: "Strikethrough", keys: [PAPER_MARK_KEYS.strike], typed: "~~text~~" },
    { does: "Code", keys: [PAPER_MARK_KEYS.code], typed: "`text`" },
    { does: "Line break", keys: ["Shift-Enter"] },
    { does: "Undo", keys: ["Mod-z"] },
    { does: "Redo", keys: ["Shift-Mod-z", "Mod-y"] },
    { does: "Today's date", typed: "@today", space: true },
    { does: "Tomorrow's date", typed: "@tomorrow", space: true },
  ],
  Blocks: [
    { command: "blockMenu", typed: "/" },
    { does: "Text", keys: ["Mod-Alt-0"] },
    { does: "Heading 1", keys: ["Mod-Alt-1"], typed: "#", space: true },
    { does: "Heading 2", keys: ["Mod-Alt-2"], typed: "##", space: true },
    { does: "Heading 3", keys: ["Mod-Alt-3"], typed: "###", space: true },
    { does: "Bullet list", keys: ["Mod-Shift-8"], typed: "-", space: true },
    { does: "Numbered list", keys: ["Mod-Shift-7"], typed: "1.", space: true },
    { does: "Checklist", keys: ["Mod-Shift-9"], typed: "[ ]", space: true },
    { does: "Quote", keys: ["Mod-Shift-b"], typed: ">", space: true },
    { does: "Code", keys: ["Mod-Alt-c"], typed: "```", space: true },
    { does: "Divider", typed: "---" },
    { does: "Indent list item", keys: ["Tab"] },
    { does: "Outdent list item", keys: ["Shift-Tab"] },
    { does: "Next table cell", keys: ["Tab"] },
    { does: "Previous table cell", keys: ["Shift-Tab"] },
    { command: "blockUp" },
    { command: "blockDown" },
  ],
  Comments: [
    { does: "Ask an agent", typed: "@" },
    { does: "Comment on the selection", keys: [PAPER_COMMENT_KEY] },
    { does: "Send a reply", keys: ["Mod-Enter"] },
    { command: "nextComment" },
    { command: "previousComment" },
  ],
  Paper: [
    { command: "find", keys: ["Mod-f"] },
  ],
};

/** Every key and typed trigger of a paper, by group. */
export function PaperShortcuts(props: { open: boolean; onOpenChange: (open: boolean) => void; groups: [title: string, rows: PaperKeyRow[]][] }) {
  // Opened from a command, so there is no trigger for focus to go back to: it goes back to where it was.
  let back: HTMLElement | null = null;
  createComputed(on(() => props.open, (open) => { if (open) back = document.activeElement instanceof HTMLElement ? document.activeElement : null; }));
  // `rail` for its height, held inside the window, with the page alone in it.
  return <OverlayDialog open={props.open} onOpenChange={props.onOpenChange} label="Paper shortcuts" placement="center" layout="rail"
    onCloseAutoFocus={(event) => { event.preventDefault(); if (back?.isConnected) back.focus({ preventScroll: true }); back = null; }}>
    <OverlayPage title="Paper shortcuts" onClose={() => props.onOpenChange(false)}>
      <For each={props.groups}>{([title, rows]) => <Group title={title}>
        <For each={rows}>{(row) => <SettingLine plain label={row.does}>
          <For each={row.keys}>{(keys) => <Keycap>{keys}</Keycap>}</For>
          <Show when={row.typed}>{(typed) => <SettingValue mono>{typed()}</SettingValue>}</Show>
          <Show when={row.space}><Keycap>Space</Keycap></Show>
        </SettingLine>}</For>
      </Group>}</For>
    </OverlayPage>
  </OverlayDialog>;
}
