import { For, Show, type JSX } from "solid-js";
import { Button, Keycap } from "./controls";
import * as Icons from "./icons";
import { Card } from "./card";
import { type Motion } from "./shared";

/**
 * TourCard: one step of a guided tour that teaches by doing (the keyboard tour): a small raised frost Card in a corner,
 * the region it is about lit by the caller's Spotlight. Its body: the step's title, a sentence, its tasks as keycaps
 * (each ticked when seen); its actions Back, Skip, End, and Next once the step is done.
 * It never takes focus: the keys it teaches belong to where the person is. Its buttons are still reached by Tab.
 */
export type TourTask = { label: string; keys: string[]; state: "waiting" | "done" | "absent" };

export function TourCard(props: {
  label: string; step: number; steps: number; title: string; children: JSX.Element;
  tasks?: TourTask[]; also?: { label: string; keys: string[] }[]; note?: JSX.Element;
  done?: boolean; placement?: "start" | "end"; nextLabel?: string; motion?: Motion;
  onBack?: () => void; onSkip?: () => void; onNext?: () => void; onEnd: () => void;
}) {
  const keys = (list: string[]) => <span class="ui-tour-keys"><For each={list}>{(key) => <Keycap>{key}</Keycap>}</For></span>;
  return <div class="ui-tour-placement" data-placement={props.placement ?? "end"} role="region" aria-label={props.label}
    onMouseDown={(event) => event.preventDefault()}>
    <Card embedded label={props.label} class="ui-tour" title={props.label} detail={`${props.step} / ${props.steps}`} motion={props.motion} actions={<>
      <Show when={props.onBack}><Button variant="ghost" size="sm" onClick={() => props.onBack?.()}>Back</Button></Show>
      <Show when={props.onSkip && !props.done}><Button variant="ghost" size="sm" onClick={() => props.onSkip?.()}>Skip</Button></Show>
      <Button variant="ghost" size="sm" onClick={() => props.onEnd()}>End tour</Button>
      <Show when={props.onNext}><Button variant={props.done ? "primary" : "secondary"} size="sm" onClick={() => props.onNext?.()}>{props.nextLabel ?? "Next"}</Button></Show>
    </>}>
      <div class="ui-tour-body" aria-live="polite">
        <h3 class="ui-tour-title">{props.title}</h3>
        <p class="ui-tour-text">{props.children}</p>
        <Show when={props.tasks?.length}><ul class="ui-tour-tasks"><For each={props.tasks}>{(task) =>
          <li data-state={task.state}><span class="ui-tour-mark ui-size-icon-sm" aria-hidden="true"><Show when={task.state === "done"}><Icons.Check /></Show></span>
            <span class="ui-tour-task">{task.label}<Show when={task.state === "done"}><span class="ui-live-note"> (done)</span></Show></span>{keys(task.keys)}</li>
        }</For></ul></Show>
        <Show when={props.also?.length}><ul class="ui-tour-tasks" data-also=""><For each={props.also}>{(item) =>
          <li><span class="ui-tour-task">{item.label}</span>{keys(item.keys)}</li>
        }</For></ul></Show>
        <Show when={props.note}><p class="ui-tour-note">{props.note}</p></Show>
      </div>
    </Card>
  </div>;
}
