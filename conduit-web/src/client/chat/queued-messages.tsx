import { createSignal, createEffect, For, Show } from "solid-js";
import { Button } from "@/components/primitives";
import { ChevronDownIcon, ChevronUpIcon, PencilIcon, SendHorizontalIcon, XIcon } from "lucide-solid";
import type { Message } from "../api/contracts";

/**
 * One queued line, clamped to a single line. The expander appears only when the
 * text is really clipped, measured rather than guessed from length: wrapping
 * depends on the rendered width, which a character count cannot know.
 */
function QueuedLine(props: { text: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [clipped, setClipped] = createSignal(false);
  let body!: HTMLParagraphElement;
  createEffect(() => {
    props.text;
    if (!expanded()) setClipped(body.scrollHeight > body.clientHeight + 1);
  });

  return <li class="queued-line" data-expanded={expanded() ? "true" : "false"}>
    <p class="queued-line-body" ref={body}>{props.text}</p>
    <Show when={clipped()}>
      <button
        type="button"
        class="queued-line-expander"
        aria-label={expanded() ? "Show less" : "Show more"}
        aria-expanded={expanded()}
        onClick={() => setExpanded((value) => !value)}
      >{expanded() ? <ChevronUpIcon /> : <ChevronDownIcon />}</button>
    </Show>
  </li>;
}

/**
 * Messages sent while the agent is working, sitting directly above the composer
 * until the model takes them.
 *
 * One row: what is waiting, and the ways out of that - take it to the model now
 * by stopping the turn, put it back in the composer, or drop it. The actions are
 * icons because the row is a status line, not a dialog; spelling them out cost
 * three lines of the transcript for three rarely-pressed buttons.
 *
 * It is in flow rather than floating, so the composer stack really is as tall as
 * it looks. The transcript reserves that measured height, which is what keeps
 * the card off the output it is about.
 */
export function QueuedMessages(props: {
  messages: Message[];
  surface: string;
  busy: boolean;
  canInterrupt: boolean;
  onInterruptAndSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const lines = () => props.messages.map((message) => message.content || "").filter((text) => text.trim());
  const hint = () => props.busy ? "Sent when the current step finishes" : "Sends next";

  return <Show when={lines().length}>
    <aside class="queued-float composer-surface-material" data-composer-surface={props.surface} aria-label="Messages waiting for the agent">
      <span class="queued-float-title" title={hint()}>{props.busy ? "Steering" : "Queued"}</span>
      <ul class="queued-float-list"><For each={lines()}>{(text) => <QueuedLine text={text} />}</For></ul>
      <div class="queued-float-actions">
        <Show when={props.busy && props.canInterrupt}>
          <Button size="icon-sm" variant="ghost" aria-label="Interrupt and send now" title="Interrupt and send now" onClick={props.onInterruptAndSend}><SendHorizontalIcon /></Button>
        </Show>
        <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Edit in the composer" onClick={props.onEdit}><PencilIcon /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Discard" title="Discard" onClick={props.onDiscard}><XIcon /></Button>
      </div>
    </aside>
  </Show>;
}
