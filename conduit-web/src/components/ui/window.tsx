import { createSignal, Show, type JSX } from "solid-js";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-solid";

/*
 * The window's own chrome, for a desktop client whose native caption is off (Settings › Desktop › Title bar):
 *   TitleBar        Conduit's bar across the top: lead, middle and end slots; its empty space drags the window
 *   WindowControls  minimise, maximise (restore once maximised) and close -- a row at a bar's end ("bar", Windows'
 *                   own widths, close washing red), or a stack at the top of the tool rail ("rail")
 * Dragging is the shell's: `data-tauri-drag-region` marks what drags, and only that element, not what it holds.
 */
/** Whether the window has no caption of its own, so the app's own empty chrome (a pane's header, the tool rail, the
 *  sidebar's head) drags it: set by the desktop client; false everywhere else. */
export const [windowDrags, setWindowDrags] = createSignal(false);
/** The attribute that makes an element drag the window, while it should. */
export const dragRegion = () => windowDrags() ? "" : undefined;
export function TitleBar(props: { lead?: JSX.Element; middle?: JSX.Element; end?: JSX.Element }) {
  return <header class="ui-title-bar" data-tauri-drag-region="">
    <div class="ui-title-bar-lead" data-tauri-drag-region="">{props.lead}</div>
    <div class="ui-title-bar-middle" data-tauri-drag-region="">{props.middle}</div>
    <div class="ui-title-bar-end" data-tauri-drag-region="">{props.end}</div>
  </header>;
}

export function WindowControls(props: { kind: "bar" | "rail"; maximized?: boolean; onMinimize: () => void; onMaximize: () => void; onClose: () => void }) {
  return <div class="ui-window-controls" data-kind={props.kind} role="group" aria-label="Window">
    <button type="button" tabIndex={-1} aria-label="Minimise" title="Minimise" onClick={() => props.onMinimize()}><MinusIcon /></button>
    <button type="button" tabIndex={-1} aria-label={props.maximized ? "Restore" : "Maximise"} title={props.maximized ? "Restore" : "Maximise"} onClick={() => props.onMaximize()}>
      <Show when={props.maximized} fallback={<SquareIcon />}><CopyIcon /></Show>
    </button>
    <button type="button" tabIndex={-1} data-close="" aria-label="Close" title="Close" onClick={() => props.onClose()}><XIcon /></button>
  </div>;
}
