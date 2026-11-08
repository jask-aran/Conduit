import { For, Show, type JSX } from "solid-js";
import { Button, Keycap } from "./controls";
import * as Icons from "./icons";
import { Overlay, OverlayHead } from "./overlay";
import { type Motion } from "./shared";

/**
 * TourCard: one step of a guided tour that teaches by doing (the keyboard tour). The leader's language: a small
 * raised frost card that floats in a corner without covering the page, the region it is about lit by a Spotlight
 * round it (the caller's). Its head is the tour's name and how far along it is; its body the step's title, a
 * sentence or two, then its tasks -- what to press, as keycaps, each ticked when seen -- and the keys it only
 * mentions; its foot Back, Skip and End, and Next once the step is done (or has nothing to wait for).
 *
 * It never takes focus: the keys it teaches belong to where the person is, so a press on it keeps focus there.
 * Its buttons are still buttons, reached by Tab, for leaving it by keyboard.
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
    <Overlay embedded label={props.label} class="ui-tour" motion={props.motion}>
      <OverlayHead><span class="ui-title">{props.label}</span><small class="ui-count ui-tour-count">{props.step} / {props.steps}</small></OverlayHead>
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
      <div class="ui-tour-foot">
        <Show when={props.onBack}><Button variant="ghost" size="sm" onClick={() => props.onBack?.()}>Back</Button></Show>
        <Show when={props.onSkip && !props.done}><Button variant="ghost" size="sm" onClick={() => props.onSkip?.()}>Skip</Button></Show>
        <span class="ui-tour-foot-end">
          <Button variant="ghost" size="sm" onClick={() => props.onEnd()}>End tour</Button>
          <Show when={props.onNext}><Button variant={props.done ? "primary" : "secondary"} size="sm" onClick={() => props.onNext?.()}>{props.nextLabel ?? "Next"}</Button></Show>
        </span>
      </div>
    </Overlay>
  </div>;
}
