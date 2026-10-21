import { createMemo, createSignal, onCleanup } from "solid-js";
import { OverlayHints, type Hint as KeyHint } from "@/components/ui/overlay";
import { COMMAND_IDS, getCommandDefinition } from "../commands/command-registry";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import {
  formatShortcutBinding, formatShortcutStroke, sameStroke,
} from "../shortcuts/shortcut-normalize";
import type { PendingShortcutSequence } from "../shortcuts/shortcut-types";

export type CommandHintMode = "browse" | "edit" | "rename" | "action-prefix" | "model-selector";
export type CommandHintContext = "chat" | "generic";

type Hint = {
  commandId?: string;
  label: string;
  keys?: string[];
};

const fixedHint = (label: string, ...keys: string[]): Hint => ({ label, keys });
const commandHint = (commandId: string, label: string): Hint => ({ commandId, label });

const genericBrowseHints = [
  fixedHint("Navigate", "↑", "↓"),
  fixedHint("Open", "Enter"),
  fixedHint("Close", "Esc"),
];

export function CommandHintBar(props: {
  context: CommandHintContext;
  mode: CommandHintMode;
  scoped: boolean;
  selectedCount: number | null;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  pendingSequence?: PendingShortcutSequence | null;
  shortcuts: ShortcutManager;
  onToggleEdit?: () => void;
  onDeleteSelected?: () => void;
}) {
  const [shortcutRevision, setShortcutRevision] = createSignal(0);
  onCleanup(props.shortcuts.subscribe(() => setShortcutRevision((value) => value + 1)));

  const commandKeys = (commandId: string) => {
    shortcutRevision();
    return props.shortcuts.effectiveBindings(commandId)
      .map((binding) => formatShortcutBinding(binding, props.shortcuts.environment))
      // One binding per hint: the rail names a key, not every alias for it.
      .slice(0, 1);
  };
  const pendingHints = () => {
    const pending = props.pendingSequence;
    if (!pending) return [];
    return pending.commandIds.flatMap((commandId) => {
      const keys = props.shortcuts.effectiveBindings(commandId)
        .filter((binding) => binding.strokes.length === 2
          && sameStroke(binding.strokes[0], pending.firstStroke))
        .map((binding) => formatShortcutStroke(binding.strokes[1]!, props.shortcuts.environment));
      if (!keys.length) return [];
      const command = getCommandDefinition(commandId);
      const label = commandId === COMMAND_IDS.renameHighlightedChat
        ? "Rename"
        : commandId === COMMAND_IDS.deleteHighlightedChat
            ? "Delete"
            : command.label;
      return [{ commandId, label, keys }];
    });
  };
  const hints = createMemo<Hint[]>(() => {
    shortcutRevision();
    if (props.mode === "action-prefix") return [
      ...pendingHints(),
      fixedHint("Cancel", "Esc"),
    ];
    if (props.mode === "edit") return [
      commandHint(COMMAND_IDS.toggleChatEdit, "Done"),
      fixedHint("Select", "Click"),
      fixedHint("Toggle", "Space"),
      commandHint(COMMAND_IDS.deleteSelectedChats, "Delete"),
    ];
    if (props.mode === "rename") return [
      fixedHint("Save", "Enter"),
      fixedHint("Cancel", "Esc"),
    ];
    if (props.mode === "model-selector") return [
      fixedHint("Navigate", "↑", "↓"),
      commandHint(COMMAND_IDS.toggleModelScope, "Scope / un-scope"),
      fixedHint("Select model", "Enter"),
      fixedHint("Close", "Esc"),
    ];
    // Actions first; the keys that move through the tree sit at the end.
    if (props.context === "chat") return [
      commandHint(COMMAND_IDS.toggleChatEdit, "Edit"),
      commandHint(COMMAND_IDS.renameHighlightedChat, "Rename"),
      commandHint(COMMAND_IDS.deleteHighlightedChat, "Delete"),
      fixedHint("Expand", "→"),
      fixedHint("Search in", "/"),
      fixedHint("Project", "Ctrl", "Enter"),
      fixedHint("Preview", "Ctrl", "P"),
      fixedHint("Open", "Enter"),
      fixedHint(props.scoped ? "Out" : "Close", "Esc"),
    ];
    return genericBrowseHints;
  });
  const resolvedHints = createMemo(() => hints().map((hint) =>
    hint.commandId && !hint.keys ? { ...hint, keys: commandKeys(hint.commandId) } : hint));
  const primaryCount = () => props.mode === "action-prefix"
    ? resolvedHints().length
    : props.mode === "edit"
      ? 4
      : props.mode === "model-selector"
        ? 4
      : props.mode === "browse" && props.context === "chat"
        ? 4
        : 2;
  const primary = () => resolvedHints().slice(0, primaryCount());
  const secondary = () => resolvedHints().slice(primary().length);
  const hintAction = (hint: Hint) => {
    if (props.context !== "chat") return undefined;
    if (hint.commandId === COMMAND_IDS.toggleChatEdit) return props.onToggleEdit;
    if (hint.label === "Preview") return props.onTogglePreview;
    if (props.mode === "edit" && hint.commandId === COMMAND_IDS.deleteSelectedChats) return props.onDeleteSelected;
    return undefined;
  };

  // The view's actions first, then the keys that move through it, at the end; an action is its hint's button too.
  const keyHint = (hint: Hint): KeyHint => [hint.keys || [], hint.label, hintAction(hint)];
  return <OverlayHints count={props.selectedCount !== null ? `${props.selectedCount} selected` : undefined}
    start={primary().map(keyHint)} end={secondary().map(keyHint)} />;
}
