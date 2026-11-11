import { Icons } from "@/components/ui";
import { createSignal, createEffect, For, Show } from "solid-js";
import { Button, Line, Lines, Rider, RiderMark, Actions } from "@/components/ui";

import type { Message } from "../api/contracts";
import { createLeaving, riderMotion, type CardExit } from "./composer-cards";

/** In flow rather than floating: the transcript reserves the composer stack's measured height, which keeps the card
 *  off the output it is about. */
export function QueuedMessages(props: {
  messages: Message[];
  busy: boolean;
  canInterrupt: boolean;
  onInterruptAndSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const lines = () => props.messages.map((message) => message.content || "").filter((text) => text.trim());
  const hint = () => props.busy ? "Sent when the current step finishes" : "Sends next";
  const [exit, setExit] = createSignal<CardExit>("drop");
  createEffect(() => { if (lines().length) setExit("drop"); });
  const shown = createLeaving(lines, (list) => list.length > 0, exit);

  return <Show when={shown.value().length}>
    <Rider label="Messages waiting for the agent" motion={riderMotion(shown.leaving())}>
      <RiderMark icon={props.busy ? <Icons.Steer /> : <Icons.Queued />} label={props.busy ? "Steering" : "Queued"} title={`${props.busy ? "Steering" : "Queued"}: ${hint()}`} />
      <Lines><For each={shown.value()}>{(text) => <Line text={text} />}</For></Lines>
      <Actions kind="rider">
        <Show when={props.busy && props.canInterrupt}>
          <Button size="icon-sm" variant="ghost" aria-label="Interrupt and send now" title="Interrupt and send now" onClick={props.onInterruptAndSend}><Icons.Send /></Button>
        </Show>
        <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Edit in the composer" onClick={props.onEdit}><Icons.Edit /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Discard" title="Discard" onClick={() => { setExit("fade"); props.onDiscard(); }}><Icons.Close /></Button>
      </Actions>
    </Rider>
  </Show>;
}
