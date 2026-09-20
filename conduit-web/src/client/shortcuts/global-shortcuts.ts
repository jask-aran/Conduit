import { normalizeModifiers } from "./shortcut-normalize.ts";
import type {
  ShortcutBinding, ShortcutCommandDefinition, ShortcutOverrides,
} from "./shortcut-types.ts";
import { effectiveShortcutBindings } from "./shortcut-preferences.ts";

export interface GlobalShortcut {
  accelerator: string;
  commandId: string;
}

/**
 * What the OS can be asked for, which is less than the window accepts.
 *
 * A system-wide key is taken from every other application at once, so a bare
 * letter is not offered: without a modifier the binding would swallow typing
 * everywhere. Two-stroke sequences are refused for the same reason -- the OS
 * hands over one chord, and holding the first stroke to see whether a second
 * arrives would mean watching every keystroke on the machine.
 */
export function globalAccelerator(binding: ShortcutBinding): string | null {
  if (binding.strokes.length !== 1) return null;
  const stroke = binding.strokes[0]!;
  const modifiers = normalizeModifiers(stroke.modifiers);
  if (!modifiers.length) return null;
  const parts = modifiers.map((modifier) => {
    if (modifier === "primary") return "CommandOrControl";
    if (modifier === "control") return "Control";
    if (modifier === "alt") return "Alt";
    return "Shift";
  });
  // The physical key travels as its code, which is what the shell's parser
  // reads, so a rebound key means the same position on every layout.
  return [...parts, stroke.code].join("+");
}

/**
 * The set the shell should be holding, derived from the same registry and the
 * same overrides the window dispatches from -- there is no second list of keys
 * to keep in step. A binding the OS cannot express is dropped here rather than
 * sent and refused, and the first claim on an accelerator wins so the shell is
 * never asked to register one chord twice.
 */
export function globalShortcuts(
  commands: ShortcutCommandDefinition[],
  overrides: ShortcutOverrides,
): GlobalShortcut[] {
  const claimed = new Set<string>();
  const shortcuts: GlobalShortcut[] = [];
  for (const command of commands) {
    if (!command.contexts.includes("global")) continue;
    for (const binding of effectiveShortcutBindings(command, overrides)) {
      const accelerator = globalAccelerator(binding);
      if (!accelerator || claimed.has(accelerator)) continue;
      claimed.add(accelerator);
      shortcuts.push({ accelerator, commandId: command.id });
    }
  }
  return shortcuts;
}
