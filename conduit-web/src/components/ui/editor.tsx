import { splitProps, type JSX } from "solid-js";

export function CodeSurface(props: JSX.HTMLAttributes<HTMLDivElement> & { editable?: boolean }) {
  const [local, rest] = splitProps(props, ["editable"]);
  return <div {...rest} class="ui-code-surface" data-editable={local.editable ? "" : undefined} />;
}
export const CodeContent = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-code-content" />;
export function CodeHost(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; comparison?: boolean }) {
  const [local, rest] = splitProps(props, ["comparison"]);
  return <div {...rest} class="ui-code-host" data-comparison={local.comparison ? "" : undefined} />;
}
export const AnnotationPopup = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-annotation" />;
export const reviewTooltipClass = "ui-review-tooltip";
export const reviewCommentClass = "ui-review-comment";
export const searchPanelClass = "ui-search-panel";
export const annotationHostSelector = ".ui-comparison-content, .ui-code-content";
export const Comparison = (props: JSX.HTMLAttributes<HTMLElement>) => <section {...props} class="ui-comparison" />;
export const ComparisonContent = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-comparison-content" />;
export const ComparisonSource = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-comparison-source" />;
export const TurnNavigation = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-turn-navigation" />;
export function DiffShell(props: JSX.HTMLAttributes<HTMLDivElement> & { collapsed?: boolean; width: number }) {
  const [local, rest] = splitProps(props, ["collapsed", "width"]);
  return <div {...rest} class="ui-diff-shell" data-collapsed={local.collapsed ? "" : undefined} style={{ "--navigator-width": `${local.width}px` }} />;
}
export const DiffRail = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-diff-rail" />;
export const DiffBody = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-diff-body" />;
export const AnnotationButton = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} class="ui-annotation-button" />;
export const AnnotationInput = (props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} class="ui-annotation-input" />;
