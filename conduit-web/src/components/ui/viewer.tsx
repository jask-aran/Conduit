import { splitProps, type JSX } from "solid-js";

export const FileImage = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-image" />;
export const FileMedia = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-media" />;
export const FileCard = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-card" />;
export function FileBody(props: JSX.HTMLAttributes<HTMLDivElement> & { editing?: boolean; wrap?: boolean }) {
  const [local, rest] = splitProps(props, ["editing", "wrap"]);
  return <div {...rest} class="ui-file-body" data-editing={local.editing ? "" : undefined} data-wrap={local.wrap ? "" : undefined} />;
}
export const FileSwap = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} class="ui-file-swap" />;
export const FileScope = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-file-scope" />;
export function FileChanges(props: JSX.HTMLAttributes<HTMLElement> & { focused?: boolean }) {
  const [local, rest] = splitProps(props, ["focused"]);
  return <section {...rest} class="ui-file ui-file-changes" data-focused={local.focused ? "" : undefined} />;
}
export function FileEmptySide(props: JSX.HTMLAttributes<HTMLElement> & { focused?: boolean }) {
  const [local, rest] = splitProps(props, ["focused"]);
  return <section {...rest} class="ui-file ui-file-empty-side" data-focused={local.focused ? "" : undefined} />;
}
