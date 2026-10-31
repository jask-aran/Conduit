import { Icons } from "@/components/ui";
import { createSignal, createEffect, For, Show } from "solid-js";
import { Button, Line, Lines, Rider, RiderActions, RiderMark } from "@/components/ui";

import type { Message } from "../api/contracts";
import { createLeaving, riderMotion, type CardExit } from "./composer-cards";

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
  busy: boolean;
  canInterrupt: boolean;
  onInterruptAndSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const lines = () => props.messages.map((message) => message.content || "").filter((text) => text.trim());
  const hint = () => props.busy ? "Sent when the current step finishes" : "Sends next";
  // Taken by the model or put back to edit, it drops into the composer;
  // discarded, it fades where it is.
  const [exit, setExit] = createSignal<CardExit>("drop");
  createEffect(() => { if (lines().length) setExit("drop"); });
  const shown = createLeaving(lines, (list) => list.length > 0, exit);

  return <Show when={shown.value().length}>
    <Rider label="Messages waiting for the agent" motion={riderMotion(shown.leaving())}>
      <RiderMark icon={props.busy ? <Icons.Steer /> : <Icons.Queued />} label={props.busy ? "Steering" : "Queued"} title={`${props.busy ? "Steering" : "Queued"}: ${hint()}`} />
      <Lines><For each={shown.value()}>{(text) => <Line text={text} />}</For></Lines>
      <RiderActions>
        <Show when={props.busy && props.canInterrupt}>
          <Button size="icon-sm" variant="ghost" aria-label="Interrupt and send now" title="Interrupt and send now" onClick={props.onInterruptAndSend}><Icons.Send /></Button>
        </Show>
        <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Edit in the composer" onClick={props.onEdit}><Icons.Edit /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Discard" title="Discard" onClick={() => { setExit("fade"); props.onDiscard(); }}><Icons.Close /></Button>
      </RiderActions>
    </Rider>
  </Show>;
}
