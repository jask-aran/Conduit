import { splitProps, type JSX } from "solid-js";
import { Input } from "./controls";

/** The editor's column, with a header, code and status bar. */
export function CodeSurface(props: JSX.HTMLAttributes<HTMLDivElement> & { editable?: boolean }) {
  const [local, rest] = splitProps(props, ["editable"]);
  return <div {...rest} class="ui-code-surface" data-editable={local.editable ? "" : undefined} />;
}
/** The code and its selection popup share this positioned frame. */
export const CodeContent = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-code-content" />;
/** CodeMirror's mount point; its ref and document data attributes pass through. */
export function CodeHost(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; comparison?: boolean }) {
  const [local, rest] = splitProps(props, ["comparison"]);
  return <div {...rest} class="ui-code-host" data-comparison={local.comparison ? "" : undefined} />;
}
/** Find and replace fields followed by their controls, scrolling as one row. */
export const SearchBar = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-search-bar" />;
/** A find or replace input; CodeMirror's main-field attribute passes through. */
export const SearchField = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <span class="ui-search-field"><Input {...props} /></span>;
/** The fixed run of find and replace actions. */
export const SearchActions = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-search-actions" />;
/** A comment form placed at the end of a code selection. */
export const AnnotationPopup = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-annotation" />;
/** A comment's note, shown above its marked code. */
export const ReviewTooltip = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-review-tooltip" />;
/** The tooltip class for CodeMirror's plain DOM tooltip content. */
export const reviewTooltipClass = "ui-review-tooltip";
/** The mark class for CodeMirror's comment decorations. */
export const reviewCommentClass = "ui-review-comment";
/** The panel class for CodeMirror's plain DOM search panel root. */
export const searchPanelClass = "ui-search-panel";
/** The positioned host selector used to place a code selection's comment. */
export const annotationHostSelector = ".ui-comparison-content, .ui-code-content";
/** A comparison's header, code and status bar. */
export const Comparison = (props: JSX.HTMLAttributes<HTMLElement>) => <section {...props} class="ui-comparison" />;
/** The comparison's positioned code frame and comment overlay. */
export const ComparisonContent = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-comparison-content" />;
/** Removed and added line counts, in that order. */
export const ComparisonCounts = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-comparison-counts" />;
/** Scope, turn and endpoints in a comparison's status bar. */
export const ComparisonSource = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-comparison-source" />;
/** The previous turn, turn picker and next turn in one row. */
export const TurnNavigation = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-turn-navigation" />;
/** The changed-file navigator, its grid edge and the comparison. */
export function DiffShell(props: JSX.HTMLAttributes<HTMLDivElement> & { collapsed?: boolean; width: number }) {
  const [local, rest] = splitProps(props, ["collapsed", "width"]);
  return <div {...rest} class="ui-diff-shell" data-collapsed={local.collapsed ? "" : undefined} style={{ "--navigator-width": `${local.width}px` }} />;
}
/** The collapsed navigator's open button. */
export const DiffRail = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-diff-rail" />;
/** The comparison column beside the changed-file navigator. */
export const DiffBody = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-diff-body" />;
/** A resize separator in the grid column between navigator and comparison. */
export function SplitEdge(props: JSX.HTMLAttributes<HTMLDivElement> & { resizing?: boolean; "aria-valuemin"?: number; "aria-valuemax"?: number; "aria-valuenow"?: number }) {
  const [local, rest] = splitProps(props, ["resizing"]);
  return <div role="separator" aria-orientation="vertical" {...rest} class="ui-split-edge" data-resizing={local.resizing ? "" : undefined} />;
}
/** A comment popup's action button. */
export const AnnotationButton = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} class="ui-annotation-button" />;
/** A comment popup's resizable note field. */
export const AnnotationInput = (props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} class="ui-annotation-input" />;
