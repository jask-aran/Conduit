import { splitProps, type JSX } from "solid-js";

/** An image on a checker ground, contained within its scroll area. */
export const FileImage = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-image" />;
/** Audio, video or a document filling the file's remaining space. */
export const FileMedia = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-media" />;
/** A file's kind, metadata and optional library Button action, centred in its body. */
export const FileCard = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-card" />;
/** The editor's scrolling host; editing keeps scrolling inside the editor. */
export function FileBody(props: JSX.HTMLAttributes<HTMLDivElement> & { editing?: boolean; wrap?: boolean }) {
  const [local, rest] = splitProps(props, ["editing", "wrap"]);
  return <div {...rest} class="ui-file-body" data-editing={local.editing ? "" : undefined} data-wrap={local.wrap ? "" : undefined} />;
}
/** The draggable rule between a viewer's two sides. */
export const FileDivider = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-divider" />;
/** The control over the rule that trades the viewer's sides. */
export const FileSwap = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} class="ui-file-swap" />;
/** The quiet scope label beside a file's changes. */
export const FileScope = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-file-scope" />;
/** A file column holding a comparison rather than an editor. */
export function FileChanges(props: JSX.HTMLAttributes<HTMLElement> & { focused?: boolean }) {
  const [local, rest] = splitProps(props, ["focused"]);
  return <section {...rest} class="ui-file ui-file-changes" data-focused={local.focused ? "" : undefined} />;
}
/** An empty side in a split viewer, with room for its header and empty message. */
export function FileEmptySide(props: JSX.HTMLAttributes<HTMLElement> & { focused?: boolean }) {
  const [local, rest] = splitProps(props, ["focused"]);
  return <section {...rest} class="ui-file ui-file-empty-side" data-focused={local.focused ? "" : undefined} />;
}
/** The centred message below an empty side's header. */
export const FileEmpty = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-file-empty" />;
