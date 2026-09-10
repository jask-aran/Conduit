import { createSignal, createEffect, For, Show } from "solid-js";
import { Button } from "@/components/primitives";
import { ChevronDownIcon, ChevronUpIcon, SquareIcon, XIcon } from "lucide-solid";
import type { Message } from "../api/contracts";

type QueuedItem = { key: string; text: string; steering: boolean };

/**
 * One queued message, clamped to a single line. The expander only appears when
 * the text is actually clipped, so a short message carries no affordance it
 * does not need.
 */
function QueuedLine(props: { item: QueuedItem }) {
  const [expanded, setExpanded] = createSignal(false);
  const [clipped, setClipped] = createSignal(false);
  let body!: HTMLParagraphElement;
  // Measured rather than guessed from length: wrapping depends on the rendered
  // width, which a character count cannot know.
  createEffect(() => {
    props.item.text;
    if (!expanded()) setClipped(body.scrollHeight > body.clientHeight + 1);
  });

  return <li class="queued-message" data-expanded={expanded() ? "true" : "false"}>
    <span class="queued-message-kind">{props.item.steering ? "Steering" : "Queued"}</span>
    <p class="queued-message-body" ref={body}>{props.item.text}</p>
    <Show when={clipped()}>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={expanded() ? "Show less" : "Show more"}
        aria-expanded={expanded()}
        onClick={() => setExpanded((value) => !value)}
      >{expanded() ? <ChevronUpIcon /> : <ChevronDownIcon />}</Button>
    </Show>
  </li>;
}

/**
 * Messages sent while the agent is working, shown above the composer until the
 * model takes them. Steering reaches the model as soon as the running tool call
 * settles; interrupting stops the turn instead of waiting for it.
 */
export function QueuedMessages(props: {
  messages: Message[];
  busy: boolean;
  canInterrupt: boolean;
  onInterrupt: () => void;
  onClear: () => void;
}) {
  const items = (): QueuedItem[] => props.messages
    .map((message) => ({ key: message.id, text: message.content || "", steering: message.queueMode !== "follow_up" }))
    .filter((item) => item.text.trim());

  return <Show when={items().length}>
    <section class="queued-messages" aria-label="Messages waiting for the agent">
      <ul class="queued-message-list">
        <For each={items()}>{(item) => <QueuedLine item={item} />}</For>
      </ul>
      <div class="queued-messages-actions">
        <Show when={props.busy && props.canInterrupt}>
          <Button size="sm" variant="outline" onClick={props.onInterrupt}>
            <SquareIcon />Interrupt
          </Button>
        </Show>
        <Button size="icon-sm" variant="ghost" aria-label="Return queued messages to the composer" onClick={props.onClear}>
          <XIcon />
        </Button>
      </div>
    </section>
  </Show>;
}
