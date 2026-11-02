import { type JSX } from "solid-js";
import { Button, Input } from "./controls";

export function Browser(props: { compact?: boolean; sidebarWidth: number; children: JSX.Element }) {
  return <div class="ui-browser" data-compact={props.compact ? "" : undefined} style={{ "--browser-sidebar-width": `${props.sidebarWidth}px` }}>{props.children}</div>;
}
export const BrowserLayout = (props: { children: JSX.Element }) => <section class="ui-browser-layout" aria-label="Computer files">{props.children}</section>;
export const BrowserSidebar = (props: { children: JSX.Element }) => <aside class="ui-browser-sidebar">{props.children}</aside>;
export const BrowserPlaces = (props: { children: JSX.Element }) => <div class="ui-browser-places">{props.children}</div>;
export const BrowserMain = (props: { children: JSX.Element }) => <div class="ui-browser-main">{props.children}</div>;
export const BrowserToolbar = (props: { children: JSX.Element }) => <div class="ui-browser-toolbar">{props.children}</div>;
export const BrowserCount = (props: { children: JSX.Element }) => <span class="ui-browser-count">{props.children}</span>;
export const BrowserSummary = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-browser-summary" />;
export const BrowserSpacer = () => <span class="ui-browser-spacer" />;
export const BrowserMark = (props: JSX.HTMLAttributes<HTMLSpanElement>) => <span {...props} class="ui-browser-mark" />;
export const BrowserDivider = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-browser-divider" />;
export const BrowserGrid = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-browser-grid" />;
export const BrowserEntry = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <Button {...props} class="ui-browser-entry" variant="ghost" />;
export const BrowserPlace = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <Button {...props} class="ui-browser-place" variant="ghost" />;
/** Above the browser on a page of its own (the hub's): what else lives there, as a shelf of tiles (its harnesses). */
export const BrowserShelf = (props: { label: string; children: JSX.Element }) => <section class="ui-browser-shelf" aria-label={props.label}>{props.children}</section>;
/** The machine being browsed, leading the toolbar: its mark, its name, the chevron of the menu it opens (the hub's or a client's). */
export const BrowserMachine = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <Button {...props} class="ui-browser-machine" variant="ghost" />;
export const BrowserAddress = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <Input {...props} class="ui-browser-address" />;
