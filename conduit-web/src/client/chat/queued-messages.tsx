import { createSignal, createEffect, For, Show } from "solid-js";
import { Button } from "@/components/primitives";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-solid";
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
 * Messages sent while the agent is working, floating above the composer until
 * the model takes them.
 *
 * Sending during a turn steers: the agent reads it as soon as the running tool
 * call settles. The actions here are the ways out of that - take it to the
 * model now by stopping the turn, put it back in the composer, or drop it.
 */
export function QueuedMessages(props: {
  messages: Message[];
  busy: boolean;
  canInterrupt: boolean;
  onInterruptAndSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const lines = () => props.messages.map((message) => message.content || "").filter((text) => text.trim());

  return <Show when={lines().length}>
    <aside class="queued-float" aria-label="Messages waiting for the agent">
      <header class="queued-float-head">
        <span class="queued-float-title">{props.busy ? "Steering the agent" : "Waiting to send"}</span>
        <span class="queued-float-hint">{props.busy ? "Sent when the current step finishes" : "Sends next"}</span>
      </header>
      <ul class="queued-float-list"><For each={lines()}>{(text) => <QueuedLine text={text} />}</For></ul>
      <footer class="queued-float-actions">
        <Show when={props.busy && props.canInterrupt}>
          <Button size="sm" variant="default" onClick={props.onInterruptAndSend}>Interrupt and send now</Button>
        </Show>
        <Button size="sm" variant="ghost" onClick={props.onEdit}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={props.onDiscard}>Discard</Button>
      </footer>
    </aside>
  </Show>;
}
