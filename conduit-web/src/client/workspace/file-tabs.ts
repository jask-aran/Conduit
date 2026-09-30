import { fileEntryKey, formatFileView, parseFileView, type FileEntry } from "./file-documents.ts";
import { isSplitView } from "./workspace-types.ts";

/**
 * A file viewer side's tabs (docs/design/panes-and-rail.md): the files it
 * holds in strip order, and their keys most recently shown first. Kept free
 * of signals so the rules are testable (test/file-tabs.test.js).
 */
export type FileTabs = { entries: FileEntry[]; used: string[] };
export const FILE_TAB_CAP = 5;

/** `ftabs=<position>.<side>:<entries>`, position 0 pane A, then the shown panes beside it in order. */
export function fileTabsFromParams(params: URLSearchParams): Record<string, FileTabs> {
  const order = params.getAll("pane").filter(isSplitView).map((_, index) => index);
  const found: Record<string, FileTabs> = {};
  for (const value of params.getAll("ftabs")) {
    const at = value.indexOf(":");
    const [position, side] = value.slice(0, at).split(".").map(Number);
    const pane = position === 0 ? "main" : order[position! - 1] === undefined ? null : String(order[position! - 1]);
    const entries = value.slice(at + 1).split("|").map((part) => parseFileView(`files:${part}`)?.[0]).filter((entry): entry is FileEntry => Boolean(entry)).slice(0, FILE_TAB_CAP);
    if (pane !== null && entries.length) found[`${pane}#${side || 0}`] = { entries, used: entries.map(fileEntryKey) };
  }
  return found;
}

/** A side's `ftabs` value; a side with only its showing file needs none. */
export const fileTabParam = (position: number, side: number, tabs: FileTabs | null | undefined) =>
  tabs && tabs.entries.length > 1 ? `${position}.${side}:${formatFileView(tabs.entries).slice("files:".length)}` : null;

/**
 * A side now showing `entry`: one already a tab is shown in place; otherwise
 * it replaces the file the side showed before (`previous`) unless that is
 * kept (Ctrl), else joins the end. Past the cap the least recently shown goes.
 */
export function reconcileSide(tabs: FileTabs | undefined, entry: FileEntry, previous: FileEntry | undefined, kept: boolean): FileTabs {
  let entries = [...(tabs?.entries ?? [])];
  const entryKey = fileEntryKey(entry);
  const at = entries.findIndex((item) => fileEntryKey(item) === entryKey);
  const replaced = previous && !kept && fileEntryKey(previous) !== entryKey ? entries.findIndex((item) => fileEntryKey(item) === fileEntryKey(previous)) : -1;
  if (at >= 0) {
    entries[at] = entry;
    if (replaced >= 0) entries.splice(replaced, 1);
  } else if (replaced >= 0) entries[replaced] = entry;
  else entries.push(entry);
  let used = [entryKey, ...(tabs?.used ?? []).filter((item) => item !== entryKey)].filter((item) => entries.some((candidate) => fileEntryKey(candidate) === item));
  while (entries.length > FILE_TAB_CAP) {
    const drop = [...used].reverse().find((item) => item !== entryKey);
    if (!drop) break;
    entries = entries.filter((item) => fileEntryKey(item) !== drop);
    used = used.filter((item) => item !== drop);
  }
  return { entries, used };
}

/** A tab forgotten from its side. */
export const withoutTab = (tabs: FileTabs, key: string): FileTabs =>
  ({ entries: tabs.entries.filter((entry) => fileEntryKey(entry) !== key), used: tabs.used.filter((item) => item !== key) });

/** The tab a side shows when its showing `key` closes: the one it used last. */
export const nextShownTab = (tabs: FileTabs | null | undefined, key: string) => {
  const hidden = tabs?.used.find((item) => item !== key);
  return hidden ? tabs!.entries.find((entry) => fileEntryKey(entry) === hidden) : undefined;
};

/** A record's value moved from one key to another (a side closing shifts the next one down). */
export function moveKey<T>(current: Record<string, T>, from: string, to: string): Record<string, T> {
  const next = { ...current };
  if (from in current) next[to] = current[from]!; else delete next[to];
  delete next[from];
  return next;
}

/** Two keys' values traded (two sides or two panes swapping). */
export function swapRecordKeys<T>(current: Record<string, T>, a: string, b: string): Record<string, T> {
  const next = { ...current };
  delete next[a];
  delete next[b];
  if (b in current) next[a] = current[b]!;
  if (a in current) next[b] = current[a]!;
  return next;
}

export type DropZone = "left" | "middle" | "right";

/**
 * Where over a pane a dragged document lands, from the pointer's fraction of
 * its width: the outer fifths of a file viewer (its columns take the rest) or
 * thirds of anything else open panes; without room for one, only the middle.
 */
export function dropZoneAt(fraction: number, { edges, viewer }: { edges: boolean; viewer: boolean }): { zone: DropZone; edge: number } {
  const edge = viewer ? 1 / 5 : 1 / 3;
  return { zone: !edges ? "middle" : fraction < edge ? "left" : fraction > 1 - edge ? "right" : "middle", edge };
}

/** The wash is the target itself: an edge's band, else the pane between them. */
export function dropWash(box: { left: number; right: number; width: number }, zone: DropZone, edge: number, edges: boolean) {
  const band = edges ? box.width * edge : 0;
  return zone === "left" ? { left: box.left, width: band } : zone === "right" ? { left: box.right - band, width: band } : { left: box.left + band, width: box.width - band * 2 };
}
