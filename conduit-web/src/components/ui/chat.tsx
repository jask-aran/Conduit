import { createEffect, createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { IconButton } from "./actions";
import { Tray } from "./tray";
import * as Icons from "./icons";
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
 * its reading width (measured from the tokens, never a tuned width). Otherwise, while open: on a phone a Tray risen over
 * the chat from its foot; with `above` (a pointer's) faded in over the transcript
 * just above the composer (`above` px over the chat's foot), the transcript left where it is, Esc or a press outside it putting it away. onWide: when that changes (it starts narrow), for the controls
 * that open it.
 */
export function ChatBeside(props: { panel: JSX.Element; open: boolean; onClose: () => void; label: string; /** Over the chat: its name, by its close. */ title?: string; above?: number;
  /** Its own buttons, in its head (by its close, over the chat). */
  actions?: JSX.Element;
  /** What leads its head in its title's place (jbot's tabs). */
  lead?: JSX.Element;
  /** false: never beside the chat, whatever the width (a tool in the dock: its panel only rides above the composer). */
  beside?: boolean; onWide?: (wide: boolean) => void; children: JSX.Element }) {
  let root!: HTMLDivElement;
  let need!: HTMLSpanElement;
  let panel!: HTMLElement;
  const [wide, setWide] = createSignal(false);
  onMount(() => {
    if (props.beside === false) return;
    const measure = () => { const next = root.clientWidth >= need.offsetWidth; if (next !== wide()) { setWide(next); props.onWide?.(next); } };
    // Measured when the observer first reports, after layout and before paint: a read at mount forced a layout of
    // the whole new chat in the middle of drawing it.
    const sizes = new ResizeObserver(measure);
    sizes.observe(root);
    onCleanup(() => sizes.disconnect());
  });
  const sheet = () => !wide() && props.above === undefined;
  const over = () => !wide() && props.open && props.above !== undefined;
  // Above the composer, Esc puts it away wherever the keyboard is (its control is outside it: the composer's ring); a
  // Tray minds its own.
  createEffect(() => {
    if (!over()) return;
    const away = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); props.onClose(); } };
    window.addEventListener("keydown", away, true);
    onCleanup(() => window.removeEventListener("keydown", away, true));
    // A press anywhere but the panel and the composer (which holds its control, and stays usable under it) puts it
    // away, as a menu's does.
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest || target.closest(".ui-chat-beside-panel") === panel || root.querySelector(".ui-composer-dock")?.contains(target)) return;
      props.onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    onCleanup(() => window.removeEventListener("pointerdown", outside, true));
  });
  return <div ref={root} class="ui-chat-beside" data-wide={wide() ? "" : undefined} data-open={props.open ? "" : undefined} data-above={props.above !== undefined ? "" : undefined} style={props.above !== undefined ? { "--chat-beside-above": `${props.above}px` } : undefined}>
    <span ref={need} class="ui-chat-beside-need" aria-hidden="true" />
    <div class="ui-chat-beside-main">{props.children}</div>
    {/* Over the chat it is frost, as a popover is, with its own close; beside it, part of the pane; a phone's, a Tray. */}
    <Show when={sheet()} fallback={<aside ref={panel} class={wide() ? "ui-chat-beside-panel" : "ui-chat-beside-panel ui-frost"} data-surface={wide() ? undefined : "frost"} data-lift={wide() ? undefined : "raised"}
      aria-label={props.label} inert={!wide() && !props.open ? true : undefined}>
      <Show when={!wide() || props.actions || props.lead}><div class="ui-chat-beside-head"><Show when={props.lead} fallback={<strong>{props.title}</strong>}><span class="ui-chat-beside-lead">{props.lead}</span></Show><span class="ui-chat-beside-actions">{props.actions}<Show when={!wide()}><IconButton kind="pane" close label="Close" onClick={() => props.onClose()}><Icons.Close /></IconButton></Show></span></div></Show>
      <div class="ui-chat-beside-body">{props.panel}</div>
    </aside>}>
      <Tray open={props.open} onClose={() => props.onClose()} label={props.label} title={props.title} lead={props.lead} actions={props.actions}>{props.panel}</Tray>
    </Show>
  </div>;
}
