import { BROWSER_SHORTCUT_CONFLICTS } from "./browser-conflicts.ts";
import {
  bindingStartsWith, sameBinding,
} from "./shortcut-normalize.ts";
import { effectiveShortcutBindings } from "./shortcut-preferences.ts";
import type {
  ShortcutBinding, ShortcutCommandDefinition, ShortcutConflict, ShortcutContext,
  ShortcutEnvironment, ShortcutOverrides,
} from "./shortcut-types.ts";

const applies = <T extends string>(values: T[] | undefined, value: T) => !values || values.includes(value);

export function browserShortcutConflicts(
  binding: ShortcutBinding,
  environment: ShortcutEnvironment,
): ShortcutConflict[] {
  return BROWSER_SHORTCUT_CONFLICTS
    .filter((record) => applies(record.browsers, environment.browser)
      && applies(record.platforms, environment.platform)
      && (sameBinding(record.binding, binding) || bindingStartsWith(binding, record.binding)))
    .map((record) => ({
      kind: record.kind,
      severity: "warning",
      owner: record.owner,
      action: record.action,
    }));
}

function bindingsCollide(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return sameBinding(left, right) || bindingStartsWith(left, right) || bindingStartsWith(right, left);
}

export function validateShortcutRegistry(commands: ShortcutCommandDefinition[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id)) errors.push(`Duplicate command ID: ${command.id}`);
    ids.add(command.id);
    for (const context of command.contexts) {
      for (const binding of command.defaultBindings) {
        for (const other of commands) {
          if (!other.contexts.includes(context)) continue;
          for (const otherBinding of other.defaultBindings) {
            if (other.id === command.id && otherBinding === binding) continue;
            if (!bindingsCollide(binding, otherBinding)) continue;
            const pair = [command.id, other.id].sort().join(" / ");
            const message = `Ambiguous shortcut in ${context}: ${pair}`;
            if (!errors.includes(message)) errors.push(message);
          }
        }
      }
    }
  }
  return errors;
}

export function conduitShortcutConflicts(options: {
  binding: ShortcutBinding;
  commandId: string;
  context: ShortcutContext;
  commands: ShortcutCommandDefinition[];
  overrides?: ShortcutOverrides;
}): ShortcutConflict[] {
  const overrides = options.overrides || {};
  const conflicts: ShortcutConflict[] = [];
  for (const command of options.commands) {
    if (command.id === options.commandId) continue;
    const matchingContexts = command.contexts.filter((context) => context === options.context);
    const reusedContexts = command.contexts.filter((context) => context !== options.context);
    const matchingBinding = effectiveShortcutBindings(command, overrides)
      .some((binding) => bindingsCollide(binding, options.binding));
    if (!matchingBinding) continue;
    if (matchingContexts.length) {
      conflicts.push({
        kind: "conduit",
        severity: "error",
        commandId: command.id,
        commandLabel: command.label,
        context: matchingContexts[0],
        owner: "Conduit",
        action: command.label,
      });
    } else if (reusedContexts.length) {
      conflicts.push({
        kind: "context-reuse",
        severity: "info",
        commandId: command.id,
        commandLabel: command.label,
        context: reusedContexts[0],
        owner: "Conduit",
        action: command.label,
      });
    }
  }
  return conflicts;
}

export function shortcutConflicts(options: {
  binding: ShortcutBinding;
  commandId: string;
  context: ShortcutContext;
  commands: ShortcutCommandDefinition[];
  environment: ShortcutEnvironment;
  overrides?: ShortcutOverrides;
}): ShortcutConflict[] {
  return [
    ...conduitShortcutConflicts(options),
    ...browserShortcutConflicts(options.binding, options.environment),
  ];
}
