import { Show, splitProps, type JSX } from "solid-js";
import * as Icons from "./icons";

/*
 * Web: a web page in a pane (the hub's browser, roadmap #7) -- its bar (a ToolBar of IconButtons and a LeadInput kind web)
 * over its WebScreen, the page drawn live. Shapes only: the stream, the input it sends and what the bar does are the
 * caller's (client/browser/browser-pane.tsx).
 */

/** The page's column: the bar, then the screen taking the rest of the pane. */
export const WebView = (props: { label: string; children: JSX.Element }) => <section class="ui-web" aria-label={props.label}>{props.children}</section>;

/**
 * The live page: a canvas the caller draws each frame into (`canvas`), shown whole in the pane on the ground, taking
 * the pointer and, once focused, the keys. `state` is said over it while there is no frame to show (starting, gone) --
 * `tone` error when it cannot be shown at all.
 */
/**
 * AgentPointer: where an agent acts on a page, drawn over the screen (the page's own frames carry no cursor). It glides
 * to each place (--duration-gentle), rings out on a press or click, names what it does beside it ("Click", "Type"), and
 * fades once the agent has been still a while. x, y: on the screen, CSS px from its top left. key: changes on each
 * announcement, so the same place twice still rings.
 */
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
