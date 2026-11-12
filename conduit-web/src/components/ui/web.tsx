import { Show, splitProps, type JSX } from "solid-js";
import * as Icons from "./icons";

export const WebView = (props: { label: string; children: JSX.Element }) => <section class="ui-web" aria-label={props.label}>{props.children}</section>;

/** A page in a frame filling what holds it; what it may do is the caller's `sandbox`. The frame says the interface is dark, so a page drawn for a dark
 *  one stands on the pane's ground and any other (one that names no colours: black on nothing) gets the browser's own light canvas, never dark on dark. */
export const WebPage = (props: JSX.IframeHTMLAttributes<HTMLIFrameElement> & { title: string }) => <iframe {...props} class="ui-web-page" />;

export type AgentPointerState = { x: number; y: number; phase: "move" | "down" | "up" | "click" | "type" | "scroll"; label?: string; key: number; resting?: boolean };
export const AgentPointer = (props: { pointer: AgentPointerState; by?: string }) =>
  <div class="ui-agent-pointer" aria-hidden="true" data-phase={props.pointer.phase} data-resting={props.pointer.resting ? "" : undefined}
    style={{ transform: `translate(${props.pointer.x}px, ${props.pointer.y}px)` }}>
    <Show when={props.pointer.phase !== "move" ? props.pointer.key : 0} keyed>{(_key) => <span class="ui-agent-pointer-ring" />}</Show>
    <Icons.Pointer class="ui-agent-pointer-mark" />
    <Show when={props.pointer.label || props.by}><span class="ui-agent-pointer-label">{props.pointer.label || props.by}</span></Show>
  </div>;

export function WebScreen(props: JSX.HTMLAttributes<HTMLDivElement> & { canvas?: (element: HTMLCanvasElement) => void; live?: boolean; state?: JSX.Element; tone?: "quiet" | "error"; pointer?: AgentPointerState | null; pointerBy?: string }) {
  const [local, rest] = splitProps(props, ["canvas", "live", "state", "tone", "pointer", "pointerBy"]);
  return <div tabIndex={0} {...rest} class="ui-web-screen" data-live={local.live ? "" : undefined}>
    <canvas ref={local.canvas} class="ui-web-frame" aria-hidden="true" />
    <Show when={local.pointer}>{(pointer) => <AgentPointer pointer={pointer()} by={local.pointerBy} />}</Show>
    <Show when={local.state}><div class="ui-web-state" data-tone={local.tone ?? "quiet"} role={local.tone === "error" ? "alert" : "status"}>{local.state}</div></Show>
  </div>;
}
