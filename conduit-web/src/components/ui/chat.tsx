import { createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { Ledge, LedgeStack, PanelBody, PanelHead, Tray } from "./tray";
import { ChatDrawingProvider, createChatDrawing } from "./chat-drawing";
import { cn } from "@/lib/utils";

/* A chat in its pane (DESIGN Transcript). The app keeps the behaviour (following the tail, measuring the composer into
 * --transcript-composer-inset, the panel motion) and reaches the layers through the refs. */

/** A chat: its ChatScroller, then its ComposerDock. empty: the composer centred under the welcome (on a phone, at the
 *  foot); sending: the first send waiting on its agent; opening: still arriving, its transcript withheld. */
export function ChatView(props: JSX.HTMLAttributes<HTMLElement> & { empty?: boolean; sending?: boolean; opening?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "empty", "sending", "opening", "children"]);
  // Held unseen (opening) while a TranscriptList in it is still drawing what is on screen too, then faded in.
  const { drawing, pending } = createChatDrawing();
  return <section aria-label="Conversation" {...rest} class={cn("ui-chat", local.class)} data-empty={local.empty ? "" : undefined}
    data-sending={local.sending ? "" : undefined} data-opening={local.opening || pending() ? "" : undefined}>
    <ChatDrawingProvider value={drawing}>{local.children}</ChatDrawingProvider>
  </section>;
}

/** The transcript's scroller: text scrolls up under the header to the pane's top edge. Layers: root (ref), the motion
 *  shell the panel motion moves (motionRef, the column's width container), the viewport (viewportRef) and the reading
 *  column (columnRef). over: what floats over the viewport (a jump to the latest). */
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

/** An empty chat's greeting in the reading column (a Welcome), keeping room for the centred composer. */
export const ChatEmpty = (props: { children?: JSX.Element }) => <div class="ui-chat-empty">{props.children}</div>;

/** The composer docked over the foot of what scrolls above it; only its children take the pointer. */
export function ComposerDock(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div {...rest} class={cn("ui-composer-dock", local.class)} />;
}

/** A chat with a panel of its own (jbot's): beside the transcript where the pane has room for both at its reading width
 *  (measured from the tokens). Otherwise, while open: on a phone a Tray; with `above` (a pointer's), a Ledge faded in
 *  `above` px over the chat's foot. onWide: when that changes (it starts narrow). */
export function ChatBeside(props: { panel: JSX.Element; open: boolean; onClose: () => void; label: string; /** Over the chat: its name, by its close. */ title?: string; above?: number;
  /** Its own buttons, in its head (by its close, over the chat). */
  actions?: JSX.Element;
  /** What leads its head in its title's place (jbot's tabs); foldLead, one that folds when the head has no room. */
  lead?: JSX.Element;
  foldLead?: (folded: () => boolean) => JSX.Element;
  /** false: never beside the chat, whatever the width (a tool in the dock: its panel only rides above the composer). */
  beside?: boolean; onWide?: (wide: boolean) => void;
  /** Over the chat above the composer: another Ledge (a fit one) stacked above the panel's, in one LedgeStack. */
  over?: JSX.Element; children: JSX.Element }) {
  let root!: HTMLDivElement;
  let need!: HTMLSpanElement;
  const [wide, setWide] = createSignal(false);
  onMount(() => {
    if (props.beside === false) return;
    const measure = () => { const next = root.clientWidth >= need.offsetWidth; if (next !== wide()) { setWide(next); props.onWide?.(next); } };
    // Measured when the observer first reports: a read at mount forced a layout of the whole new chat mid-draw.
    const sizes = new ResizeObserver(measure);
    sizes.observe(root);
    onCleanup(() => sizes.disconnect());
  });
  return <div ref={root} class="ui-chat-beside" data-wide={wide() ? "" : undefined} data-open={props.open ? "" : undefined}>
    <span ref={need} class="ui-chat-beside-need" aria-hidden="true" />
    <div class="ui-chat-beside-main">{props.children}</div>
    {/* Beside the chat, part of the pane; over it, a Tray (a phone's) or a Ledge above the composer (a pointer's). */}
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
