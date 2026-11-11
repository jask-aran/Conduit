import * as Icons from "./icons";
import { Dot } from "./nav";
import { IconButton } from "./actions";
import { Show, splitProps, type JSX } from "solid-js";


export function FileView(props: JSX.HTMLAttributes<HTMLElement> & { ref?: (element: HTMLElement) => void; focused?: boolean }) {
  const [local, rest] = splitProps(props, ["focused"]);
  return <section {...rest} class="ui-file" data-focused={local.focused ? "" : undefined} />;
}
export function FilesPane(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; wide?: boolean | "navigator"; treeCollapsed?: boolean; navigatorOpen?: boolean; treeWidth?: number }) {
  const [local, rest] = splitProps(props, ["wide", "treeCollapsed", "navigatorOpen", "treeWidth"]);
  return <div {...rest} class="ui-files" data-wide={local.wide === undefined ? undefined : String(local.wide)} data-tree-collapsed={local.treeCollapsed ? "" : undefined}
    data-navigator-open={local.navigatorOpen ? "" : undefined} style={local.treeWidth === undefined ? undefined : { "--files-tree-width": `${local.treeWidth}px` }} />;
}
export const FilesTree = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-files-tree" />;
export function FileViewer(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void }) {
  return <div {...props} class="ui-file-viewer" />;
}

export const FileName = (props: { path: string; icon: JSX.Element }) =>
  <div class="ui-file-name" title={props.path}>{props.icon}<span>{props.path}</span></div>;
export const FileGit = (props: { status: string }) => <code class="ui-file-git" data-status={props.status} title="Git status">{props.status}</code>;
export const FileDirty = (props: { dirty: boolean }) => <Dot tone="warn" class="ui-file-dirty" data-dirty={props.dirty ? "" : undefined} />;
export const FileSuffix = (props: { children?: JSX.Element }) => <span class="ui-file-suffix">{props.children}</span>;

export function FileMore(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: (element: HTMLButtonElement) => void }) {
  return <IconButton kind="file" label="More file actions" {...props} data-more=""><Icons.More /></IconButton>;
}

export function StatusBar(props: { label?: string; commands: JSX.Element; children?: JSX.Element }) {
  return <footer class="ui-status-bar" aria-label={props.label ?? "Editor status"}>
    <div class="ui-status-group">{props.commands}</div>
    <div class="ui-status-group" data-details="">{props.children}</div>
  </footer>;
}
export const StatusText = (props: { children: JSX.Element }) => <span class="ui-status-text">{props.children}</span>;
export function StatusPicker(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { strong?: boolean; icon?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["strong", "icon", "children"]);
  return <button type="button" {...rest} class="ui-status-picker" data-strong={local.strong ? "" : undefined}>
    <Show when={local.strong}>{local.icon}</Show><span>{local.children}</span><Show when={!local.strong}>{local.icon}</Show>
  </button>;
}
