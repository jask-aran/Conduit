import { For, Show } from "solid-js";

export type CommandHintMode = "browse" | "edit" | "rename" | "move" | "action-prefix";
export type CommandHintContext = "chat" | "generic";

type Hint = {
  label: string;
  keys?: string[];
};

const browseHints: Record<CommandHintContext, Hint[]> = {
  chat: [
    { label: "Edit chats", keys: ["⌘E"] },
    { label: "Rename", keys: ["⌥R", "⌘⇧R", "⌘K R"] },
    { label: "Delete", keys: ["⌘⇧D", "⌥⇧D", "⌘K D"] },
    { label: "Move", keys: ["⌘⇧M", "⌥⇧M", "⌘K M"] },
    { label: "Navigate", keys: ["↑", "↓"] },
    { label: "Open", keys: ["Enter"] },
    { label: "Close", keys: ["Esc"] },
  ],
  generic: [
    { label: "Navigate", keys: ["↑", "↓"] },
    { label: "Open", keys: ["Enter"] },
    { label: "Close", keys: ["Esc"] },
  ],
};

const hintsFor = (context: CommandHintContext, mode: CommandHintMode): Hint[] => {
  if (mode === "action-prefix") return [
    { label: "Delete", keys: ["D"] },
    { label: "Move", keys: ["M"] },
    { label: "Rename", keys: ["R"] },
    { label: "Cancel", keys: ["Esc"] },
  ];
  if (mode === "edit") return [
    { label: "Done", keys: ["⌘E"] },
    { label: "Select", keys: ["Click"] },
    { label: "Toggle", keys: ["Space"] },
    { label: "Delete", keys: ["D"] },
    { label: "Move", keys: ["M"] },
  ];
  if (mode === "rename") return [
    { label: "Save", keys: ["Enter"] },
    { label: "Cancel", keys: ["Esc"] },
  ];
  if (mode === "move") return [
    { label: "Move", keys: ["Enter"] },
    { label: "Back", keys: ["Esc"] },
    { label: "Navigate", keys: ["↑", "↓"] },
  ];
  return browseHints[context];
};

function HintItem(props: { hint: Hint }) {
  return <span class="command-hint-item">
    <For each={props.hint.keys || []}>{(key) => <kbd class="command-hint-key">{key}</kbd>}</For>
    <span class="command-hint-label">{props.hint.label}</span>
  </span>;
}

export function CommandHintBar(props: { context: CommandHintContext; mode: CommandHintMode }) {
  const hints = () => hintsFor(props.context, props.mode);
  const primaryCount = () => props.mode === "action-prefix" ? 4 : props.mode === "edit" ? 4 : props.mode === "browse" && props.context === "chat" ? 3 : 2;
  const primary = () => hints().slice(0, primaryCount());
  const secondary = () => hints().slice(primary().length);
  return <div class="command-hint-bar" role="note" aria-label="Keyboard shortcuts" data-mode={props.mode}>
    <div class="command-hint-items command-hint-primary">
      <For each={primary()}>{(hint) => <HintItem hint={hint} />}</For>
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
