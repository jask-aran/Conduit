import {
  createEffect, createMemo, createSignal, For, onCleanup, Show,
} from "solid-js";
import {
  AlertTriangleIcon, KeyboardIcon, PlusIcon, RotateCcwIcon, SearchIcon, XIcon,
} from "lucide-solid";
import { Button, Input } from "@/components/primitives";
import { shortcutConflicts } from "../shortcuts/shortcut-conflicts";
import { shortcutEnvironmentLabel } from "../shortcuts/shortcut-environment";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import {
  formatShortcutBinding, normalizeKeyboardEvent, sameBinding, shortcutBinding,
} from "../shortcuts/shortcut-normalize";
import type {
  ShortcutBinding, ShortcutCommandDefinition, ShortcutConflict, ShortcutStroke,
} from "../shortcuts/shortcut-types";
import "./shortcuts-settings.css";

const GROUP_LABELS: Record<string, string> = {
  commands: "Application",
  "chat-management": "Chat search",
  danger: "Danger zone",
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
      if (!normalized) return true;
      const bindings = props.manager.effectiveBindings(command.id)
        .map((binding) => formatShortcutBinding(binding, props.manager.environment));
      return [
        command.label, command.description, command.group, ...command.keywords,
        ...command.contexts, ...bindings,
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

  const beginRecording = (commandId: string, bindingIndex: number | null) => {
    setRecording({ commandId, bindingIndex });
    setCaptured([]);
    setStatus("Press one shortcut. Press a second shortcut to create a sequence.");
  };
  const cancelRecording = () => {
    setRecording(null);
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

  return <section class="shortcuts-settings" aria-labelledby="shortcuts-settings-title">
    <div class="shortcuts-intro">
      <div>
        <p class="shortcuts-environment"><KeyboardIcon />{shortcutEnvironmentLabel(props.manager.environment)}</p>
        <p>Browser-owned shortcuts can run before Conduit receives them. A captured shortcut only proves that it reached this page now.</p>
      </div>
      <Button variant="outline" size="sm" onClick={resetAll} disabled={!hasOverrides()}>
        <RotateCcwIcon /> Reset all
      </Button>
    </div>

    <label class="shortcuts-search">
      <SearchIcon />
      <Input
        type="search"
        aria-label="Search shortcuts"
        placeholder="Search commands, contexts, or keys…"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
    </label>

    <p class="sr-only" aria-live="polite">{status()}</p>
    <Show when={groups().length} fallback={<p class="shortcuts-empty">No shortcuts match “{query()}”.</p>}>
      <div class="shortcut-groups">
        <For each={groups()}>{([group, items]) => <section class="shortcut-group">
          <h3>{GROUP_LABELS[group] || contextLabel(group)}</h3>
          <div class="shortcut-command-list">
            <For each={items}>{(command) => {
              const bindings = () => {
                revision();
                return props.manager.effectiveBindings(command.id);
              };
              const isRecording = () => recording()?.commandId === command.id;
              return <article class="shortcut-command" data-recording={isRecording() || undefined}>
                <div class="shortcut-command-copy">
                  <div class="shortcut-command-title">
                    <strong>{command.label}</strong>
                    <Show when={overridden(command.id)}><span class="shortcut-override-badge">Custom</span></Show>
                  </div>
                  <p>{command.description}</p>
                  <div class="shortcut-contexts">
                    <For each={command.contexts}>{(context) => <span>{contextLabel(context)}</span>}</For>
                  </div>
                </div>
                <div class="shortcut-bindings">
                  <Show when={bindings().length} fallback={<span class="shortcut-unassigned">Not assigned</span>}>
                    <For each={bindings()}>{(binding, index) => <span class="shortcut-binding">
                      <button
                        type="button"
                        class="shortcut-keycap"
                        aria-label={`Replace ${formatShortcutBinding(binding, props.manager.environment)} for ${command.label}`}
                        onClick={() => beginRecording(command.id, index())}
                      >
                        {formatShortcutBinding(binding, props.manager.environment)}
                      </button>
                      <button
                        type="button"
                        class="shortcut-clear"
                        aria-label={`Clear ${formatShortcutBinding(binding, props.manager.environment)} from ${command.label}`}
                        title="Clear shortcut"
                        onClick={() => clearBinding(command, index())}
                      ><XIcon /></button>
                    </span>}</For>
                  </Show>
                  <button type="button" class="shortcut-add" onClick={() => beginRecording(command.id, null)}>
                    <PlusIcon /> Add
                  </button>
                  <Show when={overridden(command.id)}>
                    <button type="button" class="shortcut-reset" onClick={() => resetCommand(command)}>Reset</button>
                  </Show>
                </div>

                <Show when={isRecording()}>
                  <div class="shortcut-recorder-panel">
                    <div
                      ref={recorder}
                      class="shortcut-recorder-capture"
                      role="application"
                      tabIndex={0}
                      aria-label={`Record shortcut for ${command.label}`}
                      onKeyDown={recordKey}
                    >
                      <span class="shortcut-recorder-dot" aria-hidden="true" />
                      <Show when={candidate()} fallback={<span>Press a shortcut</span>}>
                        {(binding) => <kbd>{formatShortcutBinding(binding(), props.manager.environment)}</kbd>}
                      </Show>
                    </div>
                    <p class="shortcut-recorder-help">Press up to two shortcuts. Backspace clears. Escape or Tab cancels.</p>
                    <Show when={duplicateBinding()}>
                      <p class="shortcut-conflict" data-severity="error" role="alert"><AlertTriangleIcon />This command already has that shortcut.</p>
                    </Show>
                    <For each={conflicts()}>{(conflict) =>
                      <p class="shortcut-conflict" data-severity={conflict.severity} role={conflict.severity === "error" ? "alert" : undefined}>
                        <AlertTriangleIcon />{conflictMessage(conflict)}
                      </p>
                    }</For>
                    <div class="shortcut-recorder-actions">
                      <Button variant="ghost" size="sm" onClick={cancelRecording}>Cancel</Button>
                      <Button size="sm" disabled={!candidate() || saveBlocked()} onClick={saveRecording}>Save shortcut</Button>
                    </div>
                  </div>
                </Show>
              </article>;
            }}</For>
          </div>
        </section>}</For>
      </div>
    </Show>
  </section>;
}
