import { duration, reducedMotion } from "@/components/ui/motion";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { splitPage } from "../dashboard/primitives/split-cursor";
import { COMMAND_IDS, getCommandDefinition } from "../commands/command-registry";
import { LEADER_MENU_PAUSE_MS, leaderMenu } from "../shortcuts/leader-menu";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { formatShortcutStroke, sameStroke, strokeIdentity } from "../shortcuts/shortcut-normalize";
import type { PendingShortcutSequence, ShortcutContext } from "../shortcuts/shortcut-types";
import { Keycap } from "../../components/ui/controls";
import { Crumbs, Leader, Spotlight } from "../../components/ui/leader";
import { OverlayHints, type Hint } from "../../components/ui/overlay";
import { Item, MenuNote, Section } from "../../components/ui/popover";

const CONTEXT_LABELS: Record<string, string> = {
  application: "Conduit",
  global: "Global",
  sidebar: "Sidebar",
  chat: "Chat",
  transcript: "Transcript",
  composer: "Composer",
  dashboard: "Dashboard",
  terminal: "Terminal",
  "workspace-panel": "Workspace panel",
};
// A dashboard says which it is: the Conduit dashboard, a project or a workspace.
const contextLabel = (context: ShortcutContext) => (context === "dashboard" ? splitPage() : undefined) ?? CONTEXT_LABELS[context]
  ?? context.replace(/[-.]/g, " ").replace(/^\w/, (first) => first.toUpperCase());

type Row = { commandId: string; label: string; keys: string[] };
// Numbers first, in order, then letters, then the rest.
const rank = (key: string) => /^\d$/.test(key) ? 0 : /^[a-z]$/i.test(key) ? 1 : 2;

/**
 * The leader menu: what the leader (Ctrl+G) can do from where you are.
 *
 * A step back to look, so it dims the page -- all but the region it is
 * about, which stays lit so where focus is reads at a glance -- and shows one
 * small card at the foot of the screen. The path of regions around focus is the heading, outermost first;
 * the list is the innermost region with keys, and ←/→ or Tab -- or a click on
 * the path -- moves it out to the others. A key an inner region claims is not
 * listed again further out, since the inner one is what it would run. By
 * default the menu waits for a pause (the Leader menu setting), so a leader
 * key someone knows never flashes it up.
 */
export function LeaderPalette(props: { shortcuts: ShortcutManager }) {
  const [revision, setRevision] = createSignal(0);
  onCleanup(props.shortcuts.subscribe(() => setRevision((value) => value + 1)));
  const pending = createMemo<PendingShortcutSequence | null>(() => {
    revision();
    // Only the leader opens this menu. Other chords -- chat search's Ctrl+K
    // then R, D or M -- are named by their own surface's rail.
    const current = props.shortcuts.pendingSequence();
    return current && current.firstStroke.code === "KeyG" ? current : null;
  });

  // Shown after the pause, at once, or never; browsing the levels shows it
  // straight away, since that is looking. It leaves the way it came, faded
  // and dropped back, holding what it showed while it goes.
  const [visible, setVisible] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [last, setLast] = createSignal<PendingShortcutSequence | null>(null);
  createEffect(() => { const current = pending(); if (current) setLast(current); });
  const shown = () => pending() ?? (leaving() ? last() : null);
  let pause: ReturnType<typeof setTimeout> | undefined;
  let leave: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => Boolean(pending()), (active) => {
    clearTimeout(pause);
    clearTimeout(leave);
    if (!active) {
      const wasVisible = visible();
      setVisible(false);
      if (wasVisible && !reducedMotion()) {
        setLeaving(true);
        leave = setTimeout(() => setLeaving(false), duration("--duration-quick"));
      }
      return;
    }
    setLeaving(false);
    setVisible(false);
    if (leaderMenu() === "never") return;
    if (leaderMenu() === "immediate") setVisible(true);
    else pause = setTimeout(() => setVisible(true), LEADER_MENU_PAUSE_MS);
  }));
  createEffect(on(() => pending()?.shown, (level, previous) => {
    if (previous !== undefined && level !== previous && leaderMenu() !== "never") { clearTimeout(pause); setVisible(true); }
  }));
  onCleanup(() => { clearTimeout(pause); clearTimeout(leave); });

  const secondKeys = (commandId: string, first: PendingShortcutSequence["firstStroke"]) => props.shortcuts.effectiveBindings(commandId)
    .filter((binding) => binding.strokes.length === 2 && sameStroke(binding.strokes[0], first))
    .map((binding) => binding.strokes[1]!);

  const rows = createMemo<Row[]>(() => {
    const current = shown();
    if (!current) return [];
    const claimed = new Set(current.levels.slice(0, current.shown)
      .flatMap((level) => level.commandIds.flatMap((id) => secondKeys(id, current.firstStroke).map(strokeIdentity))));
    return (current.levels[current.shown]?.commandIds ?? []).flatMap((commandId) => {
      const keys = secondKeys(commandId, current.firstStroke)
        .filter((stroke) => !claimed.has(strokeIdentity(stroke)))
        .map((stroke) => formatShortcutStroke(stroke, props.shortcuts.environment));
      return keys.length ? [{ commandId, label: getCommandDefinition(commandId).label, keys }] : [];
    }).sort((left, right) => rank(left.keys[0]!) - rank(right.keys[0]!) || left.keys[0]!.localeCompare(right.keys[0]!, undefined, { numeric: true }));
  });
  // The region the menu is about stays lit: the one on the path from focus
  // named by the level shown, cut out of the dim with its own corners. The
  // outermost level is the whole app, so nothing is cut out.
  const hole = createMemo(() => {
    const current = shown();
    const context = current?.levels[current.shown]?.context;
    if (!context || context === "application" || context === "global") return null;
    let region = document.activeElement instanceof Element ? document.activeElement.closest("[data-region]") : null;
    while (region && region.getAttribute("data-region") !== context) region = region.parentElement?.closest("[data-region]") ?? null;
    if (!region) return null;
    const box = region.getBoundingClientRect();
    return { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, radius: getComputedStyle(region).borderRadius };
  });
  const browsable = () => (shown()?.levels.filter((level) => level.commandIds.length).length ?? 0) > 1;
  const goTo = () => [
    [COMMAND_IDS.focusSidebar, "Sidebar"],
    [COMMAND_IDS.focusMainPane, "Main"],
    [COMMAND_IDS.focusWorkspacePanel, "Workspace"],
  ].flatMap(([id, label]) => {
    const keys = props.shortcuts.formatEffectiveBinding(id!);
    return keys ? [{ keys, label: label! }] : [];
  });

  return <Show when={(visible() || leaving()) && shown()}>
    <Spotlight fixed lit={hole() ?? undefined} motion={leaving() ? "leaving" : "entering"} />
    <Leader
      placement="foot"
      data-shortcut-leader-palette="true"
      label={`Leader: ${contextLabel(shown()!.levels[shown()!.shown]!.context)}`}
      motion={leaving() ? "leaving" : "entering"}
      path={<>
        <Keycap>{formatShortcutStroke(shown()!.firstStroke, props.shortcuts.environment)}</Keycap>
        <Crumbs label="Where you are" items={[...shown()!.levels.entries()].reverse().map(([index, level]) => ({
          label: contextLabel(level.context),
          current: index === shown()!.shown,
          disabled: !level.commandIds.length,
          onClick: () => props.shortcuts.showPendingLevel(index),
        }))} />
      </>}
      hints={<OverlayHints
        start={[
          ...(browsable() ? [[["←", "→"], "level"] satisfies Hint] : []),
          ...goTo().map((item): Hint => [[item.keys], item.label]),
        ]}
        end={[[["Esc"], "cancel"]]}
      />}
    >
      <Show when={rows().length} fallback={<MenuNote>No leader keys here yet.</MenuNote>}>
        <Section><For each={rows()}>{(row) =>
          <Item keysFirst keys={row.keys} onClick={() => props.shortcuts.runPendingCommand(row.commandId)}>{row.label}</Item>
        }</For></Section>
      </Show>
    </Leader>
  </Show>;
}
