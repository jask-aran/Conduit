import { splitProps, type JSX } from "solid-js";
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
