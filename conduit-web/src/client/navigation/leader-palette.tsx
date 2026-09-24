import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { COMMAND_IDS, getCommandDefinition } from "../commands/command-registry";
import { COMPOSER_SURFACE_CHANGE_EVENT, selectedComposerSurface, type ComposerSurfaceMode } from "../chat/composer-surface";
import { LEADER_MENU_PAUSE_MS, leaderMenu } from "../shortcuts/leader-menu";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { formatShortcutStroke, sameStroke, strokeIdentity } from "../shortcuts/shortcut-normalize";
import type { PendingShortcutSequence, ShortcutContext } from "../shortcuts/shortcut-types";
import "./leader-palette.css";

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
const contextLabel = (context: ShortcutContext) => CONTEXT_LABELS[context]
  ?? context.replace(/[-.]/g, " ").replace(/^\w/, (first) => first.toUpperCase());

type Row = { commandId: string; label: string; keys: string[] };
// Numbers first, in order, then letters, then the rest.
const rank = (key: string) => /^\d$/.test(key) ? 0 : /^[a-z]$/i.test(key) ? 1 : 2;

/**
 * The leader menu: what the leader (Ctrl+G) can do from where you are.
 *
 * A step back to look, so it dims the page and shows one small card at the
 * foot of the screen, in the composer's material and the question card's row
 * shape. The path of regions around focus is the heading, outermost first;
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
    return props.shortcuts.pendingSequence();
  });

  const [surface, setSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  onMount(() => {
    const changed = (event: Event) => setSurface((event as CustomEvent<ComposerSurfaceMode>).detail);
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, changed);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, changed));
  });

  // Shown after the pause, at once, or never; browsing the levels shows it
  // straight away, since that is looking.
  const [visible, setVisible] = createSignal(false);
  let pause: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => Boolean(pending()), (active) => {
    clearTimeout(pause);
    setVisible(false);
    if (!active || leaderMenu() === "never") return;
    if (leaderMenu() === "immediate") setVisible(true);
    else pause = setTimeout(() => setVisible(true), LEADER_MENU_PAUSE_MS);
  }));
  createEffect(on(() => pending()?.shown, (shown, previous) => {
    if (previous !== undefined && shown !== previous && leaderMenu() !== "never") { clearTimeout(pause); setVisible(true); }
  }));
  onCleanup(() => clearTimeout(pause));

  const secondKeys = (commandId: string, first: PendingShortcutSequence["firstStroke"]) => props.shortcuts.effectiveBindings(commandId)
    .filter((binding) => binding.strokes.length === 2 && sameStroke(binding.strokes[0], first))
    .map((binding) => binding.strokes[1]!);

  const rows = createMemo<Row[]>(() => {
    const current = pending();
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
  const browsable = () => (pending()?.levels.filter((level) => level.commandIds.length).length ?? 0) > 1;
  const goTo = () => [
    [COMMAND_IDS.focusSidebar, "Sidebar"],
    [COMMAND_IDS.focusMainPane, "Main"],
    [COMMAND_IDS.focusWorkspacePanel, "Workspace"],
  ].flatMap(([id, label]) => {
    const keys = props.shortcuts.formatEffectiveBinding(id!);
    return keys ? [{ keys, label: label! }] : [];
  });

  return <Show when={visible() && pending()}>
    <div class="leader-menu-scrim" aria-hidden="true" />
    <aside
      class="leader-menu composer-surface-material"
      data-composer-surface={surface()}
      data-shortcut-leader-palette="true"
      role="dialog"
      aria-label={`Leader: ${contextLabel(pending()!.levels[pending()!.shown]!.context)}`}
    >
      <div class="leader-menu-top">
        <kbd>{formatShortcutStroke(pending()!.firstStroke, props.shortcuts.environment)}</kbd>
        <nav class="leader-menu-path" aria-label="Where you are">
          <For each={[...pending()!.levels.entries()].reverse()}>{([index, level], position) => <>
            <Show when={position() > 0}><span class="leader-menu-separator" aria-hidden="true">›</span></Show>
            <button
              type="button"
              aria-current={index === pending()!.shown ? "true" : undefined}
              disabled={!level.commandIds.length}
              onClick={() => props.shortcuts.showPendingLevel(index)}
            >{contextLabel(level.context)}</button>
          </>}</For>
        </nav>
      </div>
      <Show when={!rows().length}><p class="leader-menu-empty">No leader keys here yet.</p></Show>
      <div class="leader-menu-rows" role="list">
        <For each={rows()}>{(row) =>
          <button type="button" class="leader-menu-row" role="listitem" onClick={() => props.shortcuts.runPendingCommand(row.commandId)}>
            <span class="leader-menu-keys"><For each={row.keys}>{(key) => <kbd>{key}</kbd>}</For></span>
            <span class="leader-menu-label">{row.label}</span>
          </button>
        }</For>
      </div>
      <div class="leader-menu-footer">
        <Show when={browsable()}><span><kbd>←</kbd><kbd>→</kbd> level</span></Show>
        <For each={goTo()}>{(item) => <span><kbd>{item.keys}</kbd> {item.label}</span>}</For>
        <span class="leader-menu-cancel"><kbd>Esc</kbd> cancel</span>
      </div>
    </aside>
  </Show>;
}
