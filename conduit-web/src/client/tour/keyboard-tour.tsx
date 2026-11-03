import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { toast } from "@/components/ui/notifications";
import { Spotlight } from "../../components/ui/leader";
import { TourCard, type TourTask } from "../../components/ui/tour";
import { COMMAND_IDS } from "../commands/command-registry";
import { leaderMenu } from "../shortcuts/leader-menu";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { readTourMemory, tourReduce, writeTourMemory, type TourEvent, type TourState } from "./tour-machine";
import { setLeaderLevels, TOUR_STEPS, type LeaderChange, type TourEnv, type TourTaskDef } from "./tour-steps";

/*
 * The keyboard tour: teaches the keys by having them pressed. One state machine (tour-machine.ts) holds where it is;
 * this hears what the person does -- the shortcut manager's commands (onCommand) and pending leader (subscribe),
 * focus, and the lists' own keys -- only while a step is shown, and turns each into the task it completes. No polling:
 * every change it draws follows one of those events, a resize, or the Spotlight's region resizing.
 *
 * Leaving it: End tour on its card (a button, so Tab reaches it too). Escape is never the tour's: it is one of the
 * keys being taught, and stays the region's. Desktop only: on a phone the card hides and the entries are gone.
 */

const memory = readTourMemory();
const [tourState, setTourState] = createSignal<TourState>(memory.state);
let offered = memory.offered;
const remember = () => writeTourMemory({ state: tourState(), offered });
function dispatch(event: TourEvent) {
  const next = tourReduce(tourState(), event, TOUR_STEPS.length);
  if (next === tourState()) return;
  setTourState(next);
  remember();
}

const phoneQuery = typeof matchMedia === "function" ? matchMedia(PHONE_LAYOUT_QUERY) : null;
const [phone, setPhone] = createSignal(Boolean(phoneQuery?.matches));
phoneQuery?.addEventListener("change", (event) => setPhone(event.matches));

/** The tour's entries (the palette's command, Settings › Shortcuts' button) show only where keys mean something. */
export const keyboardTourAvailable = () => !phone();
export const keyboardTourActive = () => { const state = tourState(); return state.kind === "waiting" || state.kind === "done"; };
/** Start the tour, or resume it where it was left; once finished, it starts over. */
export function startKeyboardTour() { if (!phone()) dispatch({ type: "start" }); }

/**
 * Once per device, after the person first uses a go-to chord or the leader (never on load: only a key they pressed
 * brings it), `offer` is called to suggest the tour. Not when the tour was already taken, nor on a phone.
 */
export function watchForTourOffer(shortcuts: ShortcutManager, offer: () => void): () => void {
  if (offered || tourState().kind !== "idle") return () => {};
  const goTo = new Set<string>([COMMAND_IDS.focusSidebar, COMMAND_IDS.focusMainPane, COMMAND_IDS.focusWorkspacePanel]);
  let leaderOpen = false;
  const fire = () => {
    if (offered || phone() || tourState().kind !== "idle") return;
    offered = true;
    remember();
    stop();
    offer();
  };
  const stops = [
    shortcuts.onCommand((id) => { if (goTo.has(id)) fire(); }),
    // The leader once it closes, so the offer does not land on top of its menu.
    shortcuts.subscribe(() => {
      const pending = shortcuts.pendingSequence();
      const leader = Boolean(pending && shortcuts.leader && pending.firstStroke.code === shortcuts.leader.code);
      if (leaderOpen && !pending) fire();
      leaderOpen = leader;
    }),
  ];
  function stop() { for (const release of stops.splice(0)) release(); }
  return stop;
}

/* A step whose tasks are all seen shows them ticked for a beat, then moves on. */
const TOUR_BEAT_MS = 1200;
/* Overlays that are the step's subject: the tour's dim gives way to theirs (the leader's own Spotlight, a palette's scrim). */
const OVERLAY_CONTEXTS = ["palette.root", "palette.page", "chat-search.browse", "chat-search.edit", "chat-search.move", "chat-search.rename", "model-selector", "settings"];

export function KeyboardTour(props: { shortcuts: ShortcutManager; env: TourEnv }) {
  const [tick, setTick] = createSignal(0);
  const bump = () => setTick((value) => value + 1);
  // A boolean of its own, so the listeners below stay put while the state moves from task to task.
  const active = createMemo(() => keyboardTourActive() && !phone());
  const current = createMemo(() => { const state = tourState(); return state.kind === "waiting" || state.kind === "done" ? state : null; });
  const step = createMemo(() => { const state = current(); return state ? TOUR_STEPS[state.step] : undefined; });
  const done = () => current()?.done ?? [];
  const available = (task: TourTaskDef) => !task.available || task.available(props.env);
  const required = () => step()?.tasks.filter(available).map((task) => task.id) ?? [];
  const seen = (task: TourTaskDef) => { if (available(task)) dispatch({ type: "task", id: task.id, required: required() }); };

  // A go-to's task is seen when focus arrives where it goes after it ran (a press that went nowhere is not it).
  const armed = new Set<string>();
  const checkArrival = () => {
    const target = document.activeElement;
    if (!target) return;
    for (const task of step()?.tasks ?? []) if (task.focus && armed.has(task.id) && task.focus.in(target)) { armed.delete(task.id); seen(task); }
  };
  createEffect(on(step, () => armed.clear()));

  createEffect(() => {
    if (!active()) return;
    const tasks = () => step()?.tasks ?? [];
    let leaderBefore = props.shortcuts.pendingSequence();
    let lastKey = "";
    const stops = [
      props.shortcuts.onCommand((id) => {
        for (const task of tasks()) {
          if (task.commands?.includes(id)) seen(task);
          if (task.focus?.after.includes(id)) armed.add(task.id);
        }
        // Already there (a go-to pressed where focus was): no focusin follows.
        queueMicrotask(checkArrival);
        bump();
      }),
      props.shortcuts.subscribe(() => {
        const leader = (sequence: typeof leaderBefore) => sequence && props.shortcuts.leader && sequence.firstStroke.code === props.shortcuts.leader.code ? sequence : null;
        const now = leader(props.shortcuts.pendingSequence()), before = leader(leaderBefore);
        leaderBefore = now;
        const levels = now ? now.levels.filter((level) => level.commandIds.length).length : null;
        if (now) setLeaderLevels(levels);
        const change: LeaderChange = { opened: Boolean(now && !before), browsed: Boolean(now && before && now.shown !== before.shown), closed: Boolean(before && !now), levels };
        if (change.opened || change.browsed || change.closed) for (const task of tasks()) if (task.leader?.(change)) seen(task);
        bump();
      }),
    ];
    const onKey = (event: KeyboardEvent) => {
      lastKey = event.key;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".ui-tour-placement")) return;
      for (const task of tasks()) if (task.key?.(event, target)) seen(task);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const from = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (target && lastKey === "Tab") for (const task of tasks()) if (task.tab?.(target, from)) seen(task);
      checkArrival();
      bump();
    };
    // A press is the person's own way somewhere: a go-to pressed before it no longer explains where focus lands.
    const onPointer = () => { armed.clear(); lastKey = ""; };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", bump);
    onCleanup(() => {
      for (const release of stops) release();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", bump);
    });
  });

  // What can be done here changes with the page (a chat opened, a dock closed): the tasks seen may now be all of it.
  createEffect(on(tick, () => { if (current()?.kind === "waiting") dispatch({ type: "check", required: required() }); }));

  createEffect(() => {
    const state = current();
    if (state?.kind !== "done" || state.step >= TOUR_STEPS.length - 1) return;
    const timer = setTimeout(() => dispatch({ type: "next" }), TOUR_BEAT_MS);
    onCleanup(() => clearTimeout(timer));
  });

  // The region the step is about, lit; nothing while an overlay it teaches is up (it brings its own dim).
  const overlayUp = () => { tick(); return Boolean(props.shortcuts.pendingSequence()) || OVERLAY_CONTEXTS.some((context) => props.shortcuts.isContextActive(context)); };
  const litElement = createMemo(() => { tick(); const def = step(); return def && !overlayUp() ? def.light(props.env, done()) : null; });
  createEffect(() => {
    const element = litElement();
    if (!element) return;
    const observer = new ResizeObserver(bump);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  const lit = createMemo(() => {
    tick();
    const element = litElement();
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { box, rect: { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, radius: getComputedStyle(element).borderRadius } };
  });
  // The card sits in the corner away from the lit region.
  const placement = () => { const box = lit()?.box; return box && box.left + box.width / 2 > window.innerWidth / 2 ? "start" : "end"; };

  const tasks = (): TourTask[] => {
    tick();
    return (step()?.tasks ?? []).map((task) => ({
      label: task.label, keys: task.keys(props.shortcuts),
      state: done().includes(task.id) ? "done" : available(task) ? "waiting" : "absent",
    }));
  };
  const note = () => {
    tick();
    const def = step();
    if (!def) return null;
    const parts = [def.note?.(props.env, props.shortcuts) ?? null];
    if (def.id === "leader" && leaderMenu() === "never") parts.push("Your leader menu is set to never show (Settings › Shortcuts): the keys still work.");
    return parts.filter(Boolean).join(" ") || null;
  };
  const last = () => (current()?.step ?? 0) >= TOUR_STEPS.length - 1;
  const settled = () => { tick(); return current()?.kind === "done" || required().length === 0; };
  const finish = () => {
    dispatch({ type: "next" });
    toast("That was the keyboard tour", { description: "Keyboard tour in the command palette runs it again." });
  };

  return <Show when={active() && step()}>{(def) => <>
    <Show when={lit()}>{(region) => <Spotlight class="ui-tour-spotlight" lit={region().rect} motion="entering" />}</Show>
    <TourCard label="Keyboard tour" step={(current()?.step ?? 0) + 1} steps={TOUR_STEPS.length} title={def().title}
      tasks={tasks()} also={def().also?.(props.shortcuts)} note={note()} done={settled()} placement={placement()} motion="entering"
      nextLabel={last() ? "Finish" : "Next"}
      onBack={(current()?.step ?? 0) > 0 ? () => dispatch({ type: "back" }) : undefined}
      onSkip={() => last() ? finish() : dispatch({ type: "next" })}
      onNext={settled() ? () => last() ? finish() : dispatch({ type: "next" }) : undefined}
      onEnd={() => dispatch({ type: "end" })}>
      {def().body(props.shortcuts)}
    </TourCard>
  </>}</Show>;
}
