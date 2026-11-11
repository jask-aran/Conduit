import { createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { Ledge, LedgeStack, PanelBody, PanelHead, Tray } from "./tray";
import { ChatDrawingProvider, createChatDrawing } from "./chat-drawing";
import { cn } from "@/lib/utils";

export function ChatView(props: JSX.HTMLAttributes<HTMLElement> & { empty?: boolean; sending?: boolean; opening?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "empty", "sending", "opening", "children"]);
  // Held unseen (opening) while a TranscriptList in it is still drawing what is on screen too, then faded in.
  const { drawing, pending } = createChatDrawing();
  return <section aria-label="Conversation" {...rest} class={cn("ui-chat", local.class)} data-empty={local.empty ? "" : undefined}
    data-sending={local.sending ? "" : undefined} data-opening={local.opening || pending() ? "" : undefined}>
    <ChatDrawingProvider value={drawing}>{local.children}</ChatDrawingProvider>
  </section>;
}

export function ChatScroller(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; motionRef?: (element: HTMLDivElement) => void; viewportRef?: (element: HTMLDivElement) => void; columnRef?: (element: HTMLDivElement) => void; over?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["class", "ref", "motionRef", "viewportRef", "columnRef", "over", "children"]);
  return <div ref={local.ref} {...rest} class={cn("ui-chat-scroller", local.class)}>
    <div ref={local.motionRef} class="ui-chat-motion">
      <div ref={local.viewportRef} class="ui-chat-viewport" data-slot="message-scroller-viewport" tabIndex={-1} aria-label="Transcript">
        <div ref={local.columnRef} class="ui-chat-column">{local.children}</div>
      </div>
      {local.over}
    </div>
  </div>;
}

export const ChatEmpty = (props: { children?: JSX.Element }) => <div class="ui-chat-empty">{props.children}</div>;

export function ComposerDock(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div {...rest} class={cn("ui-composer-dock", local.class)} />;
}

export function ChatBeside(props: { panel: JSX.Element; open: boolean; onClose: () => void; label: string; title?: string; above?: number;
  actions?: JSX.Element;
  lead?: JSX.Element;
  foldLead?: (folded: () => boolean) => JSX.Element;
  beside?: boolean; onWide?: (wide: boolean) => void;
  over?: JSX.Element; children: JSX.Element }) {
  let root!: HTMLDivElement;
  let need!: HTMLSpanElement;
  const [wide, setWide] = createSignal(false);
  onMount(() => {
    if (props.beside === false) return;
    const measure = () => { const next = root.clientWidth >= need.offsetWidth; if (next !== wide()) { setWide(next); props.onWide?.(next); } };
    // Measured when the observer first reports: a read at mount would force a layout of the whole new chat mid-draw.
    const sizes = new ResizeObserver(measure);
    sizes.observe(root);
    onCleanup(() => sizes.disconnect());
  });
  return <div ref={root} class="ui-chat-beside" data-wide={wide() ? "" : undefined} data-open={props.open ? "" : undefined}>
    <span ref={need} class="ui-chat-beside-need" aria-hidden="true" />
    <div class="ui-chat-beside-main">{props.children}</div>
    <Show when={wide()} fallback={props.above !== undefined
      ? <LedgeStack above={props.above} keep={() => root.querySelector(".ui-composer-dock")}>
          {props.over}
          <Ledge open={props.open} onClose={() => props.onClose()} label={props.label} title={props.title} lead={props.lead} foldLead={props.foldLead} actions={props.actions}>{props.panel}</Ledge>
        </LedgeStack>
      : <Tray open={props.open} onClose={() => props.onClose()} label={props.label} title={props.title} lead={props.lead} foldLead={props.foldLead} actions={props.actions}>{props.panel}</Tray>}>
      <Show when={props.open}>
        <aside class="ui-chat-beside-panel" aria-label={props.label}>
          <Show when={props.actions || props.lead || props.foldLead}><PanelHead title={props.title} lead={props.lead} foldLead={props.foldLead} actions={props.actions} /></Show>
          <PanelBody>{props.panel}</PanelBody>
        </aside>
      </Show>
    </Show>
  </div>;
}
