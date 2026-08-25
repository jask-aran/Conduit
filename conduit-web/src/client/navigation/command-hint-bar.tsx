import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { COMMAND_IDS, getCommandDefinition } from "../commands/command-registry";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import {
  formatShortcutBinding, formatShortcutStroke, sameStroke,
} from "../shortcuts/shortcut-normalize";
import type { PendingShortcutSequence } from "../shortcuts/shortcut-types";

export type CommandHintMode = "browse" | "edit" | "rename" | "move" | "action-prefix" | "model-selector";
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

function HintContents(props: { hint: Hint }) {
  return <>
    <For each={props.hint.keys || []}>{(key) => <kbd class="command-hint-key">{key}</kbd>}</For>
    <span class="command-hint-label">{props.hint.label}</span>
  </>;
}

function HintItem(props: { hint: Hint; onClick?: () => void }) {
  return <Show
    when={props.onClick}
    fallback={<span class="command-hint-item"><HintContents hint={props.hint} /></span>}
  >
    <button type="button" class="command-hint-item command-hint-action" onClick={() => props.onClick?.()}>
      <HintContents hint={props.hint} />
    </button>
  </Show>;
}

export function CommandHintBar(props: {
  context: CommandHintContext;
  mode: CommandHintMode;
  pendingSequence?: PendingShortcutSequence | null;
  shortcuts: ShortcutManager;
  onToggleEdit?: () => void;
  onDeleteSelected?: () => void;
  onMoveSelected?: () => void;
}) {
  const [shortcutRevision, setShortcutRevision] = createSignal(0);
  onCleanup(props.shortcuts.subscribe(() => setShortcutRevision((value) => value + 1)));

  const commandKeys = (commandId: string) => {
    shortcutRevision();
    return props.shortcuts.effectiveBindings(commandId)
      .map((binding) => formatShortcutBinding(binding, props.shortcuts.environment));
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
        : commandId === COMMAND_IDS.moveHighlightedChat
          ? "Move"
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
      commandHint(COMMAND_IDS.moveSelectedChats, "Move"),
    ];
    if (props.mode === "rename") return [
      fixedHint("Save", "Enter"),
      fixedHint("Cancel", "Esc"),
    ];
    if (props.mode === "move") return [
      fixedHint("Move", "Enter"),
      fixedHint("Back", "Esc"),
      fixedHint("Navigate", "↑", "↓"),
    ];
    if (props.mode === "model-selector") return [
      fixedHint("Navigate", "↑", "↓"),
      fixedHint("Select / deselect", "Enter"),
      fixedHint("Close", "Esc"),
    ];
    if (props.context === "chat") return [
      commandHint(COMMAND_IDS.toggleChatEdit, "Edit chats"),
      commandHint(COMMAND_IDS.renameHighlightedChat, "Rename"),
      commandHint(COMMAND_IDS.deleteHighlightedChat, "Delete"),
      commandHint(COMMAND_IDS.moveHighlightedChat, "Move"),
      ...genericBrowseHints,
    ];
    return genericBrowseHints;
  });
  const resolvedHints = createMemo(() => hints().map((hint) =>
    hint.commandId && !hint.keys ? { ...hint, keys: commandKeys(hint.commandId) } : hint));
  const primaryCount = () => props.mode === "action-prefix"
    ? resolvedHints().length
    : props.mode === "edit"
      ? 5
      : props.mode === "browse" && props.context === "chat"
        ? 4
        : 2;
  const primary = () => resolvedHints().slice(0, primaryCount());
  const secondary = () => resolvedHints().slice(primary().length);
  const hintAction = (hint: Hint) => {
    if (props.context !== "chat") return undefined;
    if (hint.commandId === COMMAND_IDS.toggleChatEdit) return props.onToggleEdit;
    if (props.mode === "edit" && hint.commandId === COMMAND_IDS.deleteSelectedChats) return props.onDeleteSelected;
    if (props.mode === "edit" && hint.commandId === COMMAND_IDS.moveSelectedChats) return props.onMoveSelected;
    return undefined;
  };

  return <div class="command-hint-bar" role="note" aria-label="Keyboard shortcuts" data-mode={props.mode}>
    <div class="command-hint-items command-hint-primary">
      <For each={primary()}>{(hint) => <HintItem hint={hint} onClick={hintAction(hint)} />}</For>
    </div>
    <div class="command-hint-items command-hint-secondary">
      <For each={secondary()}>{(hint) => <HintItem hint={hint} />}</For>
    </div>
    <Show when={secondary().length}>
      <details class="command-hint-more">
        <summary>More shortcuts</summary>
        <div class="command-hint-more-list">
          <For each={secondary()}>{(hint) => <HintItem hint={hint} />}</For>
        </div>
      </details>
    </Show>
  </div>;
}
