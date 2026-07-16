export const commands = [{
  id: "new-chat", label: "New chat", description: "Start a chat in the current folder", icon: "new-chat",
  keywords: ["create", "conversation"], shortcut: "⌘N", scope: "global", slash: null,
  isAvailable: () => true, run: (actions) => actions.newChat(),
}, {
  id: "attach", label: "Attach files", description: "Upload files to this chat", icon: "attach",
  keywords: ["upload", "file"], shortcut: null, scope: "chat", slash: "attach",
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.attach(),
}, {
  id: "attachments", label: "Open attachments", description: "View and manage this chat's files", icon: "attachments",
  keywords: ["uploads", "files"], shortcut: null, scope: "chat", slash: "attachments",
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.attachments(),
}, {
  id: "settings", label: "Open settings", description: "Configure Conduit", icon: "settings",
  keywords: ["preferences"], shortcut: null, scope: "global", slash: "settings",
  isAvailable: () => true, run: (actions) => actions.settings(),
}, {
  id: "model", label: "Change model", description: "Choose Pi's model and thinking level", icon: "model",
  keywords: ["thinking", "reasoning"], shortcut: null, scope: "chat", slash: "model",
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
  keywords: ["abort", "cancel"], shortcut: null, scope: "chat", slash: "stop",
  isAvailable: (context) => context.streaming, run: (actions) => actions.stop(),
}, {
  id: "regenerate", label: "Regenerate last response", description: "Fork and ask the last question again", icon: "regenerate",
  keywords: ["retry"], shortcut: null, scope: "chat", slash: "regenerate",
  isAvailable: (context) => Boolean(context.canRegenerate), run: (actions) => actions.regenerate(),
}, {
  id: "continue", label: "Continue stopped response", description: "Experimentally continue the last partial answer", icon: "continue",
  keywords: ["resume"], shortcut: null, scope: "chat", slash: "continue",
  isAvailable: (context) => context.canContinue, run: (actions) => actions.continue(),
}, {
  id: "copy", label: "Copy last response", description: "Copy source Markdown", icon: "copy",
  keywords: ["clipboard", "markdown"], shortcut: null, scope: "chat", slash: "copy",
  isAvailable: (context) => Boolean(context.canCopy), run: (actions) => actions.copy(),
}, {
  id: "delete", label: "Delete chat", description: "Permanently delete this chat and its files", icon: "delete",
  keywords: ["remove", "trash"], shortcut: null, scope: "chat", slash: null, destructive: true,
  isAvailable: (context) => Boolean(context.chatId), run: (actions) => actions.delete(),
}];

export function availableCommands(context, { slashOnly = false } = {}) {
  return commands.filter((command) => (!slashOnly || command.slash) && command.isAvailable(context));
}
