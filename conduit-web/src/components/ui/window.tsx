import { createSignal, Show, type JSX } from "solid-js";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-solid";

/* `data-tauri-drag-region` makes only the element it marks drag the window, not what it holds. */
export const [windowDrags, setWindowDrags] = createSignal(false);
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
