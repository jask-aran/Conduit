import { type JSX } from "solid-js";
import { Button, Input } from "./controls";

export function Browser(props: { compact?: boolean; sidebarWidth: number; children: JSX.Element }) {
  return <div class="ui-browser" data-compact={props.compact ? "" : undefined} style={{ "--browser-sidebar-width": `${props.sidebarWidth}px` }}>{props.children}</div>;
}
export const BrowserLayout = (props: { children: JSX.Element }) => <section class="ui-browser-layout" aria-label="Computer files">{props.children}</section>;
export const BrowserSidebar = (props: { children: JSX.Element }) => <aside class="ui-browser-sidebar">{props.children}</aside>;
export const BrowserHeading = (props: { children: JSX.Element }) => <h2 class="ui-browser-heading">{props.children}</h2>;
export const BrowserPlaces = (props: { children: JSX.Element }) => <div class="ui-browser-places">{props.children}</div>;
export const BrowserMain = (props: { children: JSX.Element }) => <div class="ui-browser-main">{props.children}</div>;
export const BrowserToolbar = (props: { children: JSX.Element }) => <div class="ui-browser-toolbar">{props.children}</div>;
export const BrowserActions = (props: { children: JSX.Element }) => <div class="ui-browser-actions" role="toolbar" aria-label="Folder actions">{props.children}</div>;
export const BrowserSearch = (props: { children: JSX.Element }) => <label class="ui-browser-search">{props.children}</label>;
export const BrowserCount = (props: { children: JSX.Element }) => <span class="ui-browser-count">{props.children}</span>;
export const BrowserSummary = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-browser-summary" />;
export const BrowserSpacer = () => <span class="ui-browser-spacer" />;
export const BrowserColumns = (props: { children: JSX.Element }) => <div class="ui-browser-columns">{props.children}</div>;
export const BrowserMark = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-browser-mark" />;
export const BrowserEmpty = (props: { children: JSX.Element }) => <div class="ui-browser-empty">{props.children}</div>;
export const BrowserLoading = (props: { children: JSX.Element }) => <div class="ui-browser-loading" role="status">{props.children}</div>;
export const BrowserError = (props: { children: JSX.Element }) => <p class="ui-browser-error" role="alert">{props.children}</p>;
export const BrowserDivider = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-browser-divider" />;
export const BrowserGrid = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-browser-grid" />;
export const BrowserEntry = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <Button {...props} class="ui-browser-entry" variant="ghost" />;
export const BrowserPlace = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <Button {...props} class="ui-browser-place" variant="ghost" />;
export const BrowserAddress = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <Input {...props} class="ui-browser-address" />;
