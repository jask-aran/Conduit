import { createSignal, onCleanup, onMount, splitProps, type JSX } from "solid-js";
import { cn } from "@/lib/utils";

/*
 * A chat in its pane (DESIGN Transcript): the transcript scrolling under the pane's header, the composer docked over
 * its foot. The app keeps the behaviour (following the tail, measuring the composer into --transcript-composer-inset,
 * the panel motion) and reaches the layers through the refs.
 */

/** A chat: its ChatScroller, then its ComposerDock. empty: nothing said yet, the composer centred under the welcome
 *  (on a phone, at the foot); sending: the first send waiting on its agent, docked, with no welcome; opening: a chat
 *  still arriving (reattaching), its transcript withheld. */
export function ChatView(props: JSX.HTMLAttributes<HTMLElement> & { empty?: boolean; sending?: boolean; opening?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "empty", "sending", "opening"]);
  return <section aria-label="Conversation" {...rest} class={cn("ui-chat", local.class)} data-empty={local.empty ? "" : undefined}
    data-sending={local.sending ? "" : undefined} data-opening={local.opening ? "" : undefined} />;
}

/** The transcript's scroller: it takes the header's height back, so text scrolls to the pane's top edge under the
 *  header, and the reading column restates it as its top padding. Its layers: the root (ref), the motion shell the
 *  panel motion moves (motionRef, the column's width container), the viewport that scrolls (viewportRef) and the
 *  reading column (columnRef), which holds children. over: what floats over the viewport in the motion shell (a
 *  jump to the latest, a way out of an edit). */
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

/** The composer docked over the foot of what scrolls above it (a chat's transcript, a phone dashboard's page), on a
 *  phone on its own gradient clear of the safe area. Only its children take the pointer. */
export function ComposerDock(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div {...rest} class={cn("ui-composer-dock", local.class)} />;
}

/**
 * A chat with a panel of its own (jbot's): beside the transcript where the pane has room for both, the transcript at
 * its reading width (measured from the tokens, never a tuned width). Otherwise, while open: on a phone risen over the
 * chat from its foot, a scrim over the rest that closes it; with `swap` (a desktop: the dock, a narrow pane) in the
 * chat's place, the chat kept where it was underneath. onWide: when that changes (it starts narrow), for the
 * controls that open it.
 */
export function ChatBeside(props: { panel: JSX.Element; open: boolean; onClose: () => void; label: string; swap?: boolean; onWide?: (wide: boolean) => void; children: JSX.Element }) {
  let root!: HTMLDivElement;
  let need!: HTMLSpanElement;
  const [wide, setWide] = createSignal(false);
  onMount(() => {
    const measure = () => { const next = root.clientWidth >= need.offsetWidth; if (next !== wide()) { setWide(next); props.onWide?.(next); } };
    // Measured when the observer first reports, after layout and before paint: a read at mount forced a layout of
    // the whole new chat in the middle of drawing it.
    const sizes = new ResizeObserver(measure);
    sizes.observe(root);
    onCleanup(() => sizes.disconnect());
  });
  const over = () => !wide() && props.open;
  return <div ref={root} class="ui-chat-beside" data-wide={wide() ? "" : undefined} data-open={props.open ? "" : undefined} data-swap={props.swap ? "" : undefined}
    onKeyDown={(event) => { if (event.key === "Escape" && over()) { event.stopPropagation(); props.onClose(); } }}>
    <span ref={need} class="ui-chat-beside-need" aria-hidden="true" />
    <div class="ui-chat-beside-main">{props.children}</div>
    <div class="ui-chat-beside-scrim" aria-hidden="true" onClick={() => props.onClose()} />
    <aside class="ui-chat-beside-panel" aria-label={props.label} inert={!wide() && !props.open ? true : undefined}>{props.panel}</aside>
  </div>;
}
