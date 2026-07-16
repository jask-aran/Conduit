export const paletteCommands = [{
  id: "new-chat", label: "New chat", description: "Start a chat in the current folder", icon: "new-chat",
  keywords: ["create", "conversation"], shortcut: "⌘N", scope: "global", slash: null,
  isAvailable: () => true, run: (actions) => actions.newChat(),
}, {
  id: "attach", label: "Attach files", description: "Upload files to this chat", icon: "attach",
  keywords: ["upload", "file"], shortcut: null, scope: "chat",
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.attach(),
}, {
  id: "settings", label: "Open settings", description: "Configure Conduit", icon: "settings",
  keywords: ["preferences"], shortcut: null, scope: "global",
  isAvailable: () => true, run: (actions) => actions.settings(),
}, {
  id: "model", label: "Change model", description: "Choose Pi's model and thinking level", icon: "model",
  keywords: ["thinking", "reasoning"], shortcut: null, scope: "chat",
  isAvailable: () => true, run: (actions) => actions.model(),
}, {
  id: "rename", label: "Rename chat", description: "Change this chat's title", icon: "rename",
  keywords: ["title"], shortcut: null, scope: "chat", slash: null,
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.rename(),
}, {
  id: "move", label: "Move chat", description: "Move this chat to another folder", icon: "move",
  keywords: ["folder", "project"], shortcut: null, scope: "chat", slash: null,
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.move(),
}, {
  id: "stop", label: "Stop response", description: "Freeze and abort the current response", icon: "stop",
  keywords: ["abort", "cancel"], shortcut: null, scope: "chat",
  isAvailable: (context) => context.streaming, run: (actions) => actions.stop(),
}, {
  id: "regenerate", label: "Regenerate last response", description: "Fork and ask the last question again", icon: "regenerate",
  keywords: ["retry"], shortcut: null, scope: "chat",
  isAvailable: (context) => Boolean(context.canRegenerate), run: (actions) => actions.regenerate(),
}, {
  id: "continue", label: "Continue stopped response", description: "Experimentally continue the last partial answer", icon: "continue",
  keywords: ["resume"], shortcut: null, scope: "chat",
  isAvailable: (context) => context.canContinue, run: (actions) => actions.continue(),
}, {
  id: "copy", label: "Copy last response", description: "Copy source Markdown", icon: "copy",
  keywords: ["clipboard", "markdown"], shortcut: null, scope: "chat",
  isAvailable: (context) => Boolean(context.canCopy), run: (actions) => actions.copy(),
}, {
  id: "delete", label: "Delete chat", description: "Permanently delete this chat and its files", icon: "delete",
  keywords: ["remove", "trash"], shortcut: null, scope: "chat", slash: null, destructive: true,
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.delete(),
}];

export const composerCommands = [{
  id: "attach",
  slash: "attach",
  label: "Attach files",
  description: "Upload files to this chat",
  icon: "attach",
  keywords: ["upload", "file"],
  isAvailable: (context) => Boolean(context.chatId),
  run: (actions) => actions.attach(),
}];

export function availablePaletteCommands(context) {
  return paletteCommands.filter((command) => command.isAvailable(context));
}

export function availableComposerCommands(context) {
  return composerCommands.filter((command) => command.isAvailable(context));
}
