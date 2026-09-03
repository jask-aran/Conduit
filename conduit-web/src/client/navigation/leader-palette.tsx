import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { getCommandDefinition } from "../commands/command-registry";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { formatShortcutStroke, sameStroke } from "../shortcuts/shortcut-normalize";
import type { PendingShortcutSequence, ShortcutContext } from "../shortcuts/shortcut-types";
import "./leader-palette.css";

type LeaderTarget = {
  label: string;
  keys: string[];
};

const contextLabel = (context: ShortcutContext | undefined) => {
  if (context === "workspace-panel") return "Workspace";
  if (context === "application") return "Global";
  return "Chat";
};

export function LeaderPalette(props: { shortcuts: ShortcutManager }) {
  const [shortcutRevision, setShortcutRevision] = createSignal(0);
  onCleanup(props.shortcuts.subscribe(() => setShortcutRevision((value) => value + 1)));

  const pendingSequence = createMemo<PendingShortcutSequence | null>(() => {
    shortcutRevision();
    const pending = props.shortcuts.pendingSequence();
    return pending?.context === "application"
      || pending?.context === "chat"
      || pending?.context === "composer"
      || pending?.context === "workspace-panel"
      ? pending
      : null;
  });

  const targets = createMemo<LeaderTarget[]>(() => {
    const pending = pendingSequence();
    if (!pending) return [];
    return pending.commandIds.flatMap((commandId) => {
      const command = getCommandDefinition(commandId);
      if (!command.contexts.includes(pending.context)) return [];
      const keys = props.shortcuts.effectiveBindings(commandId)
        .filter((binding) => binding.strokes.length === 2 && sameStroke(binding.strokes[0], pending.firstStroke))
        .map((binding) => formatShortcutStroke(binding.strokes[1]!, props.shortcuts.environment));
      return keys.length ? [{ label: command.label, keys }] : [];
    });
  });

  return <Show when={targets().length > 0}>
    <aside
      class="leader-palette"
      data-shortcut-leader-palette="true"
      data-context={pendingSequence()?.context}
      role="status"
      aria-live="polite"
      aria-label={`${contextLabel(pendingSequence()?.context)} leader commands`}
    >
      <div class="leader-palette-heading">
        <span class="leader-palette-title">Leader</span>
        <kbd>{pendingSequence() ? formatShortcutStroke(pendingSequence()!.firstStroke, props.shortcuts.environment) : ""}</kbd>
        <span class="leader-palette-context">{contextLabel(pendingSequence()?.context)}</span>
      </div>
      <div class="leader-palette-targets" role="list" aria-label="Available commands">
        <For each={targets()}>{(target) =>
          <div class="leader-palette-target" role="listitem">
            <span class="leader-palette-keys" aria-label={target.keys.join(" or ")}>
              <For each={target.keys}>{(key) => <kbd>{key}</kbd>}</For>
            </span>
            <span class="leader-palette-target-label">{target.label}</span>
          </div>
        }</For>
      </div>
      <div class="leader-palette-cancel"><kbd>Esc</kbd><span>Cancel</span></div>
    </aside>
  </Show>;
}
