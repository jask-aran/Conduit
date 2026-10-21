import { Icons } from "@/components/ui";
import {
  createEffect, createMemo, createSignal, For, onCleanup, Show,
} from "solid-js";

import { Button, Input, Keycap, LiveNote, SettingGroup, SettingLine, SettingNote, SettingRecorder, SettingValue } from "@/components/ui";
import { Select } from "@/components/menus";
import { desktopShell } from "../platform/installed-client";
import { shortcutConflicts } from "../shortcuts/shortcut-conflicts";
import { shortcutEnvironmentLabel } from "../shortcuts/shortcut-environment";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import {
  formatShortcutBinding, formatShortcutStroke, normalizeKeyboardEvent, sameBinding, sameStroke, shortcutBinding,
} from "../shortcuts/shortcut-normalize";
import type {
  ShortcutBinding, ShortcutCommandDefinition, ShortcutConflict, ShortcutStroke,
} from "../shortcuts/shortcut-types";
import { LEADER_MENU_OPTIONS, leaderMenu, saveLeaderMenu, type LeaderMenuMode } from "../shortcuts/leader-menu";

const GROUP_LABELS: Record<string, string> = {
  commands: "Application",
  "chat-management": "Chat search",
  danger: "Danger zone",
  desktop: "System-wide",
  navigation: "Navigation",
  "workspace-panel": "Workspace panel",
};

interface RecordingTarget {
  commandId: string;
  bindingIndex: number | null;
}

function uniqueConflicts(conflicts: ShortcutConflict[]): ShortcutConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = [
      conflict.kind, conflict.severity, conflict.commandId, conflict.context,
      conflict.owner, conflict.action,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextLabel(context: string): string {
  return context
    .replace("chat-search.", "Chat search · ")
    .replace("palette.", "Palette · ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

export function ShortcutsSettings(props: { manager: ShortcutManager }) {
  const [query, setQuery] = createSignal("");
  const [revision, setRevision] = createSignal(0);
  const [recording, setRecording] = createSignal<RecordingTarget | null>(null);
  const [captured, setCaptured] = createSignal<ShortcutStroke[]>([]);
  const [status, setStatus] = createSignal("");
  let recorder!: HTMLDivElement;

  onCleanup(props.manager.subscribe(() => setRevision((value) => value + 1)));

  const commands = createMemo(() => {
    revision();
    const normalized = query().trim().toLocaleLowerCase();
    return props.manager.commands.filter((command) => {
      if (!command.configurable) return false;
      // A system-wide key is something only the desktop shell can hold, so it
      // is not offered where nothing could act on it.
      if (!desktopShell && command.contexts.every((context) => context === "global")) return false;
      if (!normalized) return true;
      const effective = props.manager.effectiveBindings(command.id);
      const bindings = effective.map((binding) => formatShortcutBinding(binding, props.manager.environment));
      return [
        command.label, command.description, command.group, ...command.keywords,
        ...command.contexts, ...bindings,
        // A two-key shortcut starts with the leader.
        ...(effective.some((binding) => binding.strokes.length === 2 && props.manager.leader && sameStroke(binding.strokes[0], props.manager.leader)) ? ["leader"] : []),
      ].join(" ").toLocaleLowerCase().includes(normalized);
    });
  });
  const groups = createMemo(() => {
    const grouped = new Map<string, ShortcutCommandDefinition[]>();
    for (const command of commands()) {
      const items = grouped.get(command.group) || [];
      items.push(command);
      grouped.set(command.group, items);
    }
    return [...grouped.entries()];
  });
  const hasOverrides = createMemo(() => {
    revision();
    return Object.keys(props.manager.shortcutOverrides()).length > 0;
  });
  const activeCommand = createMemo(() => {
    const target = recording();
    return target ? props.manager.commands.find((command) => command.id === target.commandId) || null : null;
  });
  const candidate = createMemo<ShortcutBinding | null>(() => {
    const strokes = captured();
    return strokes.length ? shortcutBinding(...strokes as [ShortcutStroke] | [ShortcutStroke, ShortcutStroke]) : null;
  });
  const duplicateBinding = createMemo(() => {
    const target = recording();
    const binding = candidate();
    if (!target || !binding) return false;
    return props.manager.effectiveBindings(target.commandId)
      .some((existing, index) => index !== target.bindingIndex && sameBinding(existing, binding));
  });
  const conflicts = createMemo(() => {
    const command = activeCommand();
    const binding = candidate();
    if (!command || !binding) return [];
    const all = command.contexts.flatMap((context) => shortcutConflicts({
      binding,
      commandId: command.id,
      context,
      commands: props.manager.commands,
      environment: props.manager.environment,
      overrides: props.manager.shortcutOverrides(),
    }));
    return uniqueConflicts(all);
  });
  const saveBlocked = createMemo(() => duplicateBinding()
    || conflicts().some((conflict) => conflict.severity === "error"));

  createEffect(() => {
    if (!recording()) return;
    const release = props.manager.activateContext("shortcut-recorder", {
      exclusive: true,
      onEscape: cancelRecording,
      ownsEditableTarget: true,
    });
    queueMicrotask(() => recorder?.focus());
    onCleanup(release);
  });

  // Closing the recorder hands focus back to what opened it, or the line's + once that keycap is gone,
  // so Esc and Tab carry on from the line rather than from the page's top.
  let opener: HTMLElement | null = null;
  const refocus = (commandId: string) => {
    const label = props.manager.commands.find((command) => command.id === commandId)?.label;
    const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>(`[aria-label="Add a shortcut for ${CSS.escape(label || "")}"]`);
    opener = null;
    target?.focus();
  };
  const beginRecording = (commandId: string, bindingIndex: number | null) => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRecording({ commandId, bindingIndex });
    setCaptured([]);
    setStatus("Press one shortcut. Press a second shortcut to create a sequence.");
  };
  const cancelRecording = () => {
    const target = recording();
    setRecording(null);
    if (target) refocus(target.commandId);
    setCaptured([]);
    setStatus("Shortcut change canceled.");
  };
  const recordKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRecording();
      return;
    }
    if (event.key === "Tab") {
      cancelRecording();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      setCaptured([]);
      setStatus("Captured shortcut cleared.");
      return;
    }
    const stroke = normalizeKeyboardEvent(event, props.manager.environment);
    if (!stroke) return;
    event.preventDefault();
    event.stopPropagation();
    setCaptured((current) => current.length >= 2 ? [stroke] : [...current, stroke]);
    queueMicrotask(() => {
      const binding = candidate();
      setStatus(binding
        ? `Captured ${formatShortcutBinding(binding, props.manager.environment)}.`
        : "Press a shortcut.");
    });
  };
  const saveRecording = () => {
    const target = recording();
    const binding = candidate();
    if (!target || !binding || saveBlocked()) return;
    const bindings = [...props.manager.effectiveBindings(target.commandId)];
    if (target.bindingIndex === null) bindings.push(binding);
    else bindings[target.bindingIndex] = binding;
    props.manager.setOverride(target.commandId, bindings);
    setRecording(null);
    refocus(target.commandId);
    setCaptured([]);
    setStatus("Shortcut saved.");
  };
  const clearBinding = (command: ShortcutCommandDefinition, index: number) => {
    const next = props.manager.effectiveBindings(command.id)
      .filter((_binding, bindingIndex) => bindingIndex !== index);
    props.manager.setOverride(command.id, next);
    setStatus(`${command.label} shortcut cleared.`);
  };
  const resetCommand = (command: ShortcutCommandDefinition) => {
    props.manager.resetOverride(command.id);
    setStatus(`${command.label} restored to defaults.`);
  };
  const resetAll = () => {
    props.manager.resetAllOverrides();
    setRecording(null);
    setCaptured([]);
    setStatus("All shortcuts restored to defaults.");
  };
  const overridden = (commandId: string) => {
    revision();
    return Object.hasOwn(props.manager.shortcutOverrides(), commandId);
  };
  const conflictMessage = (conflict: ShortcutConflict) => {
    if (conflict.kind === "conduit") {
      return `${conflict.commandLabel || conflict.action} already uses this shortcut in ${contextLabel(conflict.context || "")}.`;
    }
    if (conflict.kind === "context-reuse") {
      return `${conflict.commandLabel || conflict.action} uses this shortcut in a separate context. This reuse is allowed.`;
    }
    return `${conflict.owner} may use this shortcut for ${conflict.action} before Conduit receives it.`;
  };

  return <>
    <SettingGroup title="Keyboard">
      <SettingLine plain label="Keys for" state={shortcutEnvironmentLabel(props.manager.environment)}>
        <Button variant="ghost" size="sm" onClick={resetAll} disabled={!hasOverrides()}><Icons.Reset /> Reset all</Button></SettingLine>
      <SettingLine label="Leader menu" state={<Show when={props.manager.leader}>{(stroke) => <Keycap>{formatShortcutStroke(stroke(), props.manager.environment)}</Keycap>}</Show>}>
        <Select id="leader-menu" aria-label="When the leader menu shows" value={leaderMenu()} onChange={(event) => saveLeaderMenu(event.currentTarget.value as LeaderMenuMode)}>
          <For each={LEADER_MENU_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </Select>
      </SettingLine>
      <Input type="search" aria-label="Search shortcuts" placeholder="Search commands, contexts, or keys…" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
    </SettingGroup>

    <LiveNote>{status()}</LiveNote>
    <Show when={groups().length} fallback={<SettingNote tone="quiet">No shortcuts match “{query()}”.</SettingNote>}>
      <For each={groups()}>{([group, items]) => <SettingGroup title={GROUP_LABELS[group] || contextLabel(group)}>
        <For each={items}>{(command) => {
          const bindings = () => {
            revision();
            return props.manager.effectiveBindings(command.id);
          };
          const isRecording = () => recording()?.commandId === command.id;
          // Where it applies is a description, so it is the row's title.
          return <>
            <SettingLine plain label={command.label} state={overridden(command.id) ? "custom" : undefined} title={command.contexts.map(contextLabel).join(" · ")}>
              <Show when={bindings().length} fallback={<SettingValue>Not assigned</SettingValue>}>
                <For each={bindings()}>{(binding, index) => <Keycap label={`${formatShortcutBinding(binding, props.manager.environment)} for ${command.label}`}
                  onClick={() => beginRecording(command.id, index())} onRemove={() => clearBinding(command, index())}>{formatShortcutBinding(binding, props.manager.environment)}</Keycap>}</For>
              </Show>
              <Button variant="ghost" size="icon-sm" aria-label={`Add a shortcut for ${command.label}`} title="Add a shortcut" onClick={() => beginRecording(command.id, null)}><Icons.Add /></Button>
              <Show when={overridden(command.id)}>
                <Button variant="ghost" size="icon-sm" aria-label={`Reset ${command.label} to its defaults`} title="Reset to default" onClick={() => resetCommand(command)}><Icons.Reset /></Button>
              </Show>
            </SettingLine>

            <Show when={isRecording()}>
              <SettingRecorder ref={(element) => { recorder = element; }} label={`Record shortcut for ${command.label}`} onKeyDown={recordKey}
                keys={candidate() ? [formatShortcutBinding(candidate()!, props.manager.environment)] : undefined}
                saveDisabled={saveBlocked()} onSave={saveRecording} onCancel={cancelRecording} />
              <Show when={duplicateBinding()}><SettingNote tone="error">This command already has that shortcut.</SettingNote></Show>
              <For each={conflicts()}>{(conflict) => <SettingNote tone={conflict.severity === "error" ? "error" : "quiet"}>{conflictMessage(conflict)}</SettingNote>}</For>
            </Show>
          </>;
        }}</For>
      </SettingGroup>}</For>
    </Show>
  </>;
}
