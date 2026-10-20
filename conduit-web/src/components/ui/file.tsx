import { Show, splitProps, type JSX } from "solid-js";
import { EllipsisIcon } from "lucide-solid";

/*
 * A file in a pane or the dock (DESIGN Panes and windows): its header -- the name (or the pane's tabs), its git
 * letter and unsaved dot, its actions and tools, the ⋯ they fold into -- and the status bar at its foot. The app
 * measures a header (fitting): it sets data-compact ("tight", "bare") and data-folded on the actions that do not
 * fit, lowest data-fold first. Behaviour is the app's: these draw.
 */

/** A file's column: header, body, status bar. focused: it holds the keyboard (its header lifts). */
export function FileView(props: JSX.HTMLAttributes<HTMLElement> & { ref?: (element: HTMLElement) => void; focused?: boolean }) {
  const [local, rest] = splitProps(props, ["focused"]);
  return <section {...rest} class="ui-file" data-focused={local.focused ? "" : undefined} />;
}
/** One file or two side by side in a pane: its sides share the width by --side-a/--side-b. Inside it a header's ⋯
 *  is always there, and the buttons it also holds (inMenu: copy, wrap) stay in it. */
export function FileViewer(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void }) {
  return <div {...props} class="ui-file-viewer" />;
}

/** The header: what the file is, then its controls in a fixed order (save, actions, tools, the ⋯, close, the pane's own). */
export function FileHead(props: JSX.HTMLAttributes<HTMLElement> & { ref?: (element: HTMLElement) => void }) {
  return <header {...props} class="ui-file-head" />;
}
/** The file's path with its mark; the name's own text is what fitting keeps in view. */
export const FileName = (props: { path: string; icon: JSX.Element }) =>
  <div class="ui-file-name" title={props.path}>{props.icon}<span>{props.path}</span></div>;
/** Its git letter: M, A, U, D. */
export const FileGit = (props: { status: string }) => <code class="ui-file-git" data-status={props.status} title="Git status">{props.status}</code>;
/** The unsaved dot: there while the file has changes not saved. */
export const FileDirty = (props: { dirty: boolean }) => <span class="ui-file-dirty" data-dirty={props.dirty ? "" : undefined} aria-hidden="true" />;
/** The file's actions (review, copy, download): the ones fitting folds first. */
export const FileActions = (props: { ref?: (element: HTMLDivElement) => void; children: JSX.Element }) => <div ref={props.ref} class="ui-file-actions">{props.children}</div>;
/** The editor's tools (find, wrap): they go last, only when the header is bare. */
export const FileTools = (props: { children: JSX.Element }) => <div class="ui-file-tools">{props.children}</div>;
/** What a host adds to the header (a comparison's scope); goes with the actions. */
export const FileSuffix = (props: { children?: JSX.Element }) => <span class="ui-file-suffix">{props.children}</span>;

/** A header or status-bar control: an icon (label is its name and tooltip), or words with an icon (wide).
 *  inMenu: the file's ⋯ has it too, so a pane's viewer leaves it there. close: the header's ×, after everything. */
export function FileButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; wide?: boolean; inMenu?: boolean; close?: boolean; "data-fold"?: string }) {
  const [local, rest] = splitProps(props, ["label", "wide", "inMenu", "close", "children"]);
  return <button type="button" aria-label={local.label} title={local.label} {...rest} class="ui-file-button"
    data-wide={local.wide ? "" : undefined} data-in-menu={local.inMenu ? "" : undefined} data-close={local.close ? "" : undefined}>{local.children}</button>;
}
/** The header's ⋯: what fitting folded, and what a pane's viewer keeps there. A menu's trigger takes it with `as`. */
export function FileMore(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: (element: HTMLButtonElement) => void }) {
  return <button type="button" aria-label="More file actions" title="More file actions" {...props} class="ui-file-button" data-more=""><EllipsisIcon /></button>;
}

/** The status bar at a file's foot: its commands, then its details at the end. Both scroll sideways, never wrap. */
export function StatusBar(props: { label?: string; commands: JSX.Element; children?: JSX.Element }) {
  return <footer class="ui-status-bar" aria-label={props.label ?? "Editor status"}>
    <div class="ui-status-group">{props.commands}</div>
    <div class="ui-status-group" data-details="">{props.children}</div>
  </footer>;
}
/** A fact in the status bar (Working copy, 1,204 × 800, UTF-8). */
export const StatusText = (props: { children: JSX.Element }) => <span class="ui-status-text">{props.children}</span>;
/** A status-bar picker: its value in words, then its icon, a chevron (language, indentation). strong: a mode (Edit,
 *  Preview), its mark leading. A menu's trigger takes it with `as`. */
export function StatusPicker(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { strong?: boolean; icon?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["strong", "icon", "children"]);
  return <button type="button" {...rest} class="ui-status-picker" data-strong={local.strong ? "" : undefined}>
    <Show when={local.strong}>{local.icon}</Show><span>{local.children}</span><Show when={!local.strong}>{local.icon}</Show>
  </button>;
}
