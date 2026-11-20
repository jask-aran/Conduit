/*
 * Every key the sheet takes, by group, in Excel's words for what it does: the list a person opens with Ctrl+/ or the palette's Shortcuts.
 * Kept by hand beside the handlers (grid.ts onKeyDown, sheet.tsx `events.key` and its section's keydown, formula-editor.tsx, sequences.tsx).
 */
import { createComputed, createRoot, For, on, type JSX } from "solid-js";
import { Group, Keycap, OverlayPage, SettingLine } from "@/components/ui";
import { OverlayDialog } from "@/components/ui/dialog";

// Each row: what it does, then each of its chords.
const SHEET_KEYS: [string, [string, ...string[]][]][] = [
  ["Move", [
    ["Move one cell", "Arrow keys"], ["To the edge of the data region", "Ctrl+Arrow"], ["Start of the row", "Home"], ["To cell A1", "Ctrl+Home"],
    ["To the last cell used", "Ctrl+End"], ["Down or up a screen", "Page Down", "Page Up"], ["Right or left a screen", "Alt+Page Down", "Alt+Page Up"],
    ["Next cell down, or round a selection", "Enter", "Shift+Enter"], ["Next cell right, or round a selection", "Tab", "Shift+Tab"],
    ["Show the active cell", "Ctrl+Backspace"], ["Go to a cell or range", "F5"], ["Next or previous tab", "Ctrl+Page Down", "Ctrl+Page Up", "Ctrl+Shift+Page Down", "Ctrl+Shift+Page Up"],
  ]],
  ["Select", [
    ["Extend the selection", "Shift+Arrow"], ["Extend to the edge of the data", "Ctrl+Shift+Arrow"], ["Extend to the last cell used", "Ctrl+Shift+End"],
    ["Current region, then the whole sheet", "Ctrl+A"], ["Current region", "Ctrl+Shift+*"], ["Whole sheet", "Ctrl+Shift+Space"],
    ["Whole column", "Ctrl+Space"], ["Whole row", "Shift+Space"], ["Only the active cell", "Shift+Backspace", "Esc"], ["Extend the selection with the arrows, on or off", "F8"],
  ]],
  ["Edit", [
    ["Edit the cell", "F2"], ["Start typing over the cell", "Any letter or number"], ["Cancel the entry", "Esc"], ["New line in the cell", "Alt+Enter"],
    ["Fill the selection with the entry", "Ctrl+Enter"], ["Cycle $ in a reference", "F4"], ["Clear contents", "Delete"],
    ["Fill down", "Ctrl+D"], ["Fill right", "Ctrl+R"], ["Insert today's date", "Ctrl+;"], ["Insert the time", "Ctrl+Shift+;"],
    ["Copy the formula from above", "Ctrl+'"], ["Copy the value from above", "Ctrl+Shift+\""], ["AutoSum", "Alt+="],
    ["Undo", "Ctrl+Z"], ["Redo", "Ctrl+Y", "Ctrl+Shift+Z"], ["Cut, copy, paste", "Ctrl+X", "Ctrl+C", "Ctrl+V"], ["Paste values", "Ctrl+Shift+V"],
    ["Paste formatting", "Ctrl+Alt+V"], ["Insert or edit a link", "Ctrl+K"], ["Open the cell's list or calendar", "Alt+Down"],
    ["Find", "Ctrl+F"], ["Replace", "Ctrl+H"], ["Repeat the last action on the selection", "F4"], ["Show formulas, or values", "Ctrl+`"],
  ]],
  ["Rows, columns and tabs", [
    ["Insert rows, columns or cells", "Ctrl+Shift++"], ["Delete rows, columns or cells", "Ctrl+-"], ["Hide rows", "Ctrl+9"], ["Unhide rows", "Ctrl+Shift+9"],
    ["Hide columns", "Ctrl+0"], ["Unhide columns", "Ctrl+Shift+0"], ["Group", "Alt+Shift+Right"], ["Ungroup", "Alt+Shift+Left"],
    ["Filter on or off", "Ctrl+Shift+L"], ["Open a filter's list", "Alt+Down"], ["Format as table", "Alt H T"], ["New tab", "Shift+F11"], ["Rename the tab", "F2 on the tab"], ["The tab's menu", "Shift+F10 on the tab"],
  ]],
  ["Format", [
    ["Bold", "Ctrl+B"], ["Italic", "Ctrl+I"], ["Underline", "Ctrl+U"], ["Strikethrough", "Ctrl+5"], ["Custom number format", "Ctrl+1"],
    ["General", "Ctrl+Shift+~"], ["Number", "Ctrl+Shift+!"], ["Time", "Ctrl+Shift+@"], ["Date", "Ctrl+Shift+#"], ["Currency", "Ctrl+Shift+$"],
    ["Percent", "Ctrl+Shift+%"], ["Scientific", "Ctrl+Shift+^"], ["Outline border", "Ctrl+Shift+&"], ["Remove borders", "Ctrl+Shift+_"], ["Clear formatting", "Ctrl+\\"],
  ]],
  ["Menus and tools", [
    ["Cell menu (type to search it)", "Shift+F10", "Menu key"], ["Search every action by name", "Alt+Q"], ["Round the grid, the ribbon and the tabs", "F6", "Shift+F6"], ["Along the ribbon or the tabs", "Left", "Right"], ["Ribbon key tips", "Alt"], ["Chart of the selection", "Alt+F1"],
    ["Comment on the selection", "Shift+F2"], ["Ask the agent about the selection", "Ctrl+Alt+M"], ["These shortcuts", "Ctrl+/"],
  ]],
];

// The list never changes: made once, in a root of its own, a while after a sheet opens, and moved into the dialog each time it opens.
let made: JSX.Element[] | undefined;
const list = () => made ??= createRoot(() => SHEET_KEYS.map(([title, rows]) => <Group title={title}>
  <For each={rows}>{([does, ...keys]) => <SettingLine plain label={does}><For each={keys}>{(chord) => <Keycap>{chord}</Keycap>}</For></SettingLine>}</For>
</Group>));

/** The sheet's keys, by group; the keyboard goes back to where it was as it shuts. */
export function SheetShortcuts(props: { open: boolean; onOpenChange(open: boolean): void }) {
  let back: HTMLElement | null = null;
  setTimeout(list, 1000);
  createComputed(on(() => props.open, (open) => { if (open) back = document.activeElement instanceof HTMLElement ? document.activeElement : null; }));
  return <OverlayDialog open={props.open} onOpenChange={props.onOpenChange} label="Sheet shortcuts" placement="center" layout="rail"
    onCloseAutoFocus={(event) => { event.preventDefault(); if (back?.isConnected) back.focus({ preventScroll: true }); back = null; }}>
    <OverlayPage title="Sheet shortcuts" onClose={() => props.onOpenChange(false)}>
      {list()}
    </OverlayPage>
  </OverlayDialog>;
}
