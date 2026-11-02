import { Show, splitProps, type JSX } from "solid-js";
import * as Icons from "./icons";

/*
 * Web: a web page in a pane (the hub's browser, roadmap #7) -- its bar (a ToolBar of ToolButtons and the WebAddress)
 * over its WebScreen, the page drawn live. Shapes only: the stream, the input it sends and what the bar does are the
 * caller's (client/browser/browser-pane.tsx).
 */

/** The page's column: the bar, then the screen taking the rest of the pane. */
export const WebView = (props: { label: string; children: JSX.Element }) => <section class="ui-web" aria-label={props.label}>{props.children}</section>;

/** The page's address in the bar, edited in place (Enter goes there): a globe, or a lock when the page is https. */
export function WebAddress(props: JSX.InputHTMLAttributes<HTMLInputElement> & { secure?: boolean; ref?: (element: HTMLInputElement) => void }) {
  const [local, rest] = splitProps(props, ["secure"]);
  return <label class="ui-web-address">{local.secure ? <Icons.Lock /> : <Icons.Browser />}<input type="text" spellcheck={false} autocomplete="off" {...rest} /></label>;
}

/**
 * The live page: a canvas the caller draws each frame into (`canvas`), shown whole in the pane on the ground, taking
 * the pointer and, once focused, the keys. `state` is said over it while there is no frame to show (starting, gone) --
 * `tone` error when it cannot be shown at all.
 */
export function WebScreen(props: JSX.HTMLAttributes<HTMLDivElement> & { canvas?: (element: HTMLCanvasElement) => void; live?: boolean; state?: JSX.Element; tone?: "quiet" | "error" }) {
  const [local, rest] = splitProps(props, ["canvas", "live", "state", "tone"]);
  return <div tabIndex={0} {...rest} class="ui-web-screen" data-live={local.live ? "" : undefined}>
    <canvas ref={local.canvas} class="ui-web-frame" aria-hidden="true" />
    <Show when={local.state}><div class="ui-web-state" data-tone={local.tone ?? "quiet"} role={local.tone === "error" ? "alert" : "status"}>{local.state}</div></Show>
  </div>;
}
