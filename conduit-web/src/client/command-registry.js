/**
 * Command palette + composer slash registries.
 *
 * Palette owns persistent application actions (Cmd/Ctrl+K). Add a static
 * command to `paletteCommands`, or a dynamic list via `paletteSources`.
 * Nested lists (settings sections, go-to targets) live behind page portals so
 * the root browse/search view stays short; children only appear on that page.
 * Composer slash stays minimal (`/attach` only) and never routes through cmdk.
 *
 * Command shape:
 *   id, label, group, icon, keywords[], isAvailable(context), run(actions)
 * Optional: description, shortcut, destructive, searchValue, detail, checked,
 *   kind: "page", page (page id for drill-down)
 */

export const PALETTE_GROUPS = [
  { id: "commands", heading: "Commands" },
  { id: "settings", heading: "Settings" },
  { id: "navigation", heading: "Go to" },
  { id: "profiles", heading: "Profiles" },
  { id: "thinking", heading: "Thinking level" },
  { id: "danger", heading: "Danger zone" },
];

export const SETTINGS_SECTIONS = [
  { id: "models", label: "Models", keywords: ["model", "llm", "provider"] },
  { id: "profiles", label: "Profiles", keywords: ["template", "tools", "workspace", "general", "agent"] },
  { id: "runtime", label: "Runtime", keywords: ["processes", "pool", "idle", "generation"] },
  { id: "general", label: "General", keywords: ["preferences"] },
  { id: "appearance", label: "Appearance", keywords: ["theme", "display", "ui"] },
  { id: "connections", label: "Connections", keywords: ["auth", "api", "keys"] },
  { id: "about", label: "About", keywords: ["version", "help"] },
];

/** Drill-down pages. Root browse shows a portal; page view shows children only. */
export const PALETTE_PAGES = {
  settings: {
    id: "settings",
    label: "Settings…",
    description: "Configure models, runtime, and preferences",
    icon: "settings",
    shortcut: "⌘,",
    keywords: ["preferences", "configure"],
    group: "commands",
    prefix: "Settings ›",
    placeholder: "Search settings…",
    heading: "Settings",
  },
  goto: {
    id: "goto",
    label: "Go to…",
    description: "Open a chat or start one in a folder",
    icon: "chat",
    shortcut: "⌘⇧O",
    keywords: ["open", "navigate", "jump", "chat", "folder"],
    group: "commands",
    prefix: "Go to ›",
    placeholder: "Search chats and folders…",
    heading: "Go to",
  },
};

const hasChat = (context) => Boolean(context.chatId);
const isNamedFolder = (context) => Boolean(context.project && context.project.slug !== "chat");

/** Static palette actions. Prefer this list for one-shot app operations. */
export const paletteCommands = [{
  id: "new-chat",
  group: "commands",
  label: "New chat",
  description: "Start a chat in the current folder",
  icon: "new-chat",
  keywords: ["create", "conversation"],
  shortcut: "⌘⇧C",
  isAvailable: () => true,
  run: (actions) => actions.newChat(),
}, {
  id: "new-folder",
  group: "commands",
  label: "New folder",
  description: "Create a managed working directory and chat scope",
  icon: "new-folder",
  keywords: ["project", "create", "directory", "folder"],
  isAvailable: () => true,
  run: (actions) => actions.newFolder(),
}, {
  id: "new-workspace",
  group: "commands",
  label: "New workspace",
  description: "Link an existing directory or clone a repository",
  icon: "new-folder",
  keywords: ["project", "create", "directory", "workspace", "clone", "link"],
  isAvailable: () => true,
  run: (actions) => actions.newWorkspace?.(),
}, {
  id: "runtime-chat",
  group: "commands",
  label: "Open runtime chat",
  description: "Admin chat for templates and Pi packages",
  icon: "profile",
  keywords: ["admin", "template", "plugin", "install", "runtime"],
  isAvailable: () => true,
  run: (actions) => actions.openRuntimeChat?.(),
}, {
  id: "attach",
  group: "commands",
  label: "Attach files",
  description: "Upload files to this chat",
  icon: "attach",
  keywords: ["upload", "file"],
  isAvailable: hasChat,
  run: (actions) => actions.attach(),
}, {
  id: "toggle-sidebar",
  group: "commands",
  label: "Toggle sidebar",
  description: "Show or hide the navigation sidebar",
  icon: "sidebar",
  keywords: ["panel", "nav", "menu"],
  shortcut: "⌘B",
  isAvailable: () => true,
  run: (actions) => actions.toggleSidebar(),
}, {
  id: "copy-transcript",
  group: "commands",
  label: "Copy transcript",
  description: "Copy the full chat transcript",
  icon: "copy-transcript",
  keywords: ["clipboard", "export", "full"],
  isAvailable: hasChat,
  run: (actions) => actions.copyTranscript(),
}, {
  id: "rename",
  group: "commands",
  label: "Rename chat",
  description: "Change this chat's title",
  icon: "rename",
  keywords: ["title"],
  isAvailable: hasChat,
  run: (actions) => actions.rename(),
}, {
  id: "move",
  group: "commands",
  label: "Move chat",
  description: "Move this chat to another folder",
  icon: "move",
  keywords: ["folder", "project"],
  isAvailable: hasChat,
  run: (actions) => actions.move(),
}, {
  id: "rename-folder",
  group: "commands",
  label: "Rename folder",
  description: "Change the current folder's display name",
  icon: "rename",
  keywords: ["project", "title"],
  isAvailable: isNamedFolder,
  run: (actions) => actions.renameFolder(),
}, {
  id: "stop",
  group: "commands",
  label: "Stop response",
  description: "Freeze and abort the current response",
  icon: "stop",
  keywords: ["abort", "cancel"],
  isAvailable: (context) => context.streaming,
  run: (actions) => actions.stop(),
}, {
  id: "regenerate",
  group: "commands",
  label: "Regenerate last response",
  description: "Fork and ask the last question again",
  icon: "regenerate",
  keywords: ["retry"],
  isAvailable: (context) => Boolean(context.canRegenerate),
  run: (actions) => actions.regenerate(),
}, {
  id: "continue",
  group: "commands",
  label: "Continue stopped response",
  description: "Experimentally continue the last partial answer",
  icon: "continue",
  keywords: ["resume"],
  isAvailable: (context) => context.canContinue,
  run: (actions) => actions.continue(),
}, {
  id: "copy",
  group: "commands",
  label: "Copy last response",
  description: "Copy source Markdown",
  icon: "copy",
  keywords: ["clipboard", "markdown"],
  isAvailable: (context) => Boolean(context.canCopy),
  run: (actions) => actions.copy(),
}, {
  id: "retry-connection",
  group: "commands",
  label: "Retry connection",
  description: "Reconnect to the Conduit server",
  icon: "retry",
  keywords: ["reconnect", "offline", "server"],
  isAvailable: (context) => context.connectivity && context.connectivity !== "online",
  run: (actions) => actions.retryConnection(),
}, {
  id: "reload",
  group: "commands",
  label: "Reload Conduit",
  description: "Refresh the application",
  icon: "reload",
  keywords: ["refresh", "restart"],
  isAvailable: (context) => context.connectivity === "offline",
  run: (actions) => actions.reload(),
}, {
  id: "delete",
  group: "danger",
  label: "Delete chat",
  description: "Permanently delete this chat and its files",
  icon: "delete",
  keywords: ["remove", "trash"],
  destructive: true,
  isAvailable: hasChat,
  run: (actions) => actions.delete(),
}, {
  id: "delete-folder",
  group: "danger",
  label: "Delete folder",
  description: "Permanently delete this folder and its chats",
  icon: "delete",
  keywords: ["remove", "trash", "project"],
  destructive: true,
  isAvailable: isNamedFolder,
  run: (actions) => actions.deleteFolder(),
}];

export const composerCommands = [{
  id: "attach",
  slash: "attach",
  label: "Attach files",
  description: "Upload files to this chat",
  icon: "attach",
  keywords: ["upload", "file"],
  isAvailable: hasChat,
  run: (actions) => actions.attach(),
}];

const NAV_CHAT_LIMIT = 25;

function settingsSectionCommands() {
  return SETTINGS_SECTIONS.map((section) => ({
    id: `settings:${section.id}`,
    group: "settings",
    page: "settings",
    label: section.label,
    description: `Open the ${section.label} settings section`,
    icon: "settings",
    keywords: ["settings", "preferences", section.label, ...section.keywords],
    searchValue: `settings ${section.label} ${section.keywords.join(" ")}`,
    isAvailable: () => true,
    run: (actions) => actions.settings(section.id),
  }));
}

function chatCommands(context) {
  const projects = Array.isArray(context.projects) ? context.projects : [];
  const rows = [];
  for (const project of projects) {
    for (const session of project.sessions || []) {
      if (session.id === context.chatId) continue;
      rows.push({ project, session });
    }
  }
  return rows.slice(0, NAV_CHAT_LIMIT).map(({ project, session }) => ({
    id: `open-chat:${session.id}`,
    group: "navigation",
    page: "goto",
    label: session.title || "Untitled chat",
    detail: project.name,
    description: `Open chat in ${project.name}`,
    icon: "chat",
    keywords: ["open", "goto", "chat", "session", project.name, project.slug],
    searchValue: `open chat ${session.title || ""} ${project.name}`,
    isAvailable: () => true,
    run: (actions) => actions.openChat(session, project),
  }));
}

function folderCommands(context) {
  const projects = Array.isArray(context.projects) ? context.projects : [];
  return projects.map((project) => ({
    id: `new-chat-in:${project.id}`,
    group: "navigation",
    page: "goto",
    label: `New chat in ${project.name}`,
    detail: project.slug === "chat" ? "Default chats" : "Folder",
    description: `Start a chat in ${project.name}`,
    icon: "new-chat",
    keywords: ["new", "create", "folder", "project", project.name, project.slug],
    searchValue: `new chat in ${project.name} ${project.slug}`,
    isAvailable: () => true,
    run: (actions) => actions.newChat(project),
  }));
}

/**
 * Dynamic palette sources. `page` sources only appear on their drill-down page
 * or when the root search is active. Root-only sources (thinking) always show.
 */
export const paletteSources = [{
  id: "settings-sections",
  page: "settings",
  commands: () => settingsSectionCommands(),
}, {
  id: "profiles",
  page: null,
  commands(context) {
    const templates = (Array.isArray(context.templates) ? context.templates : [])
      .filter((template) => template.defaultable !== false);
    const draft = context.chatStatus === "draft" && context.templateId !== "runtime";
    return templates.flatMap((template) => {
      const rows = [{
        id: `new-chat-profile:${template.id}`,
        group: "profiles",
        label: `New ${template.label || template.id} chat`,
        description: template.description || `Start a chat with the ${template.label || template.id} profile`,
        icon: "new-chat",
        keywords: ["new", "profile", "template", template.id, template.label],
        searchValue: `new chat profile ${template.label || ""} ${template.id}`,
        isAvailable: () => true,
        run: (actions) => actions.newChat(null, { templateId: template.id }),
      }];
      if (draft) {
        rows.push({
          id: `set-profile:${template.id}`,
          group: "profiles",
          label: `Use ${template.label || template.id} profile`,
          description: template.description || "Apply this profile to the current draft",
          icon: "profile",
          checked: context.templateId === template.id,
          keywords: ["profile", "template", "switch", template.id, template.label],
          searchValue: `use profile ${template.label || ""} ${template.id}`,
          isAvailable: () => true,
          run: (actions) => actions.setChatProfile(template.id),
        });
      }
      return rows;
    });
  },
}, {
  id: "thinking-levels",
  page: null,
  commands(context) {
    const levels = Array.isArray(context.thinkingLevels) ? context.thinkingLevels : [];
    return levels.map((level) => ({
      id: `thinking:${level}`,
      group: "thinking",
      label: thinkingCommandLabel(level),
      description: "Set the thinking level for this chat",
      icon: "thinking",
      keywords: ["thinking", "reasoning", "effort", level],
      searchValue: `thinking ${level} reasoning effort`,
      checked: level === context.effort,
      isAvailable: () => true,
      run: (actions) => actions.chooseEffort(level),
    }));
  },
}, {
  id: "chats",
  page: "goto",
  commands: chatCommands,
}, {
  id: "folders",
  page: "goto",
  commands: folderCommands,
}];

function thinkingCommandLabel(level) {
  if (level === "xhigh") return "Thinking · XHigh";
  const pretty = `${level?.[0]?.toUpperCase() || ""}${level?.slice(1) || ""}`;
  return `Thinking · ${pretty || level}`;
}

function pagePortalCommands() {
  return Object.values(PALETTE_PAGES).map((page) => ({
    id: `page:${page.id}`,
    kind: "page",
    page: page.id,
    group: page.group || "commands",
    label: page.label,
    description: page.description,
    icon: page.icon,
    keywords: page.keywords || [],
    shortcut: page.shortcut || null,
    searchValue: [page.label, page.description, ...(page.keywords || [])].join(" "),
    isAvailable: () => true,
    run: () => {},
  }));
}

function filterAvailable(items, context) {
  return items.filter((command) => !command.isAvailable || command.isAvailable(context));
}

/**
 * Resolve commands for the palette.
 * - page null: root only (static actions, portals, root sources). Page children
 *   never leak into root search — enter Settings… / Go to… (or a shortcut that
 *   opens that page) to search within them.
 * - page set: only that page's children
 */
export function resolvePaletteCommands(context = {}, options = {}) {
  const page = options.page || null;

  if (page) {
    return paletteSources
      .filter((source) => source.page === page)
      .flatMap((source) => filterAvailable(source.commands(context) || [], context));
  }

  const staticCommands = filterAvailable(paletteCommands, context);
  const portals = pagePortalCommands();
  const rootSources = paletteSources
    .filter((source) => !source.page)
    .flatMap((source) => filterAvailable(source.commands(context) || [], context));

  return [...staticCommands, ...portals, ...rootSources];
}

export function availablePaletteCommands(context, options) {
  return resolvePaletteCommands(context, options);
}

export function groupPaletteCommands(commands) {
  const buckets = new Map(PALETTE_GROUPS.map((group) => [group.id, []]));
  for (const command of commands) {
    const groupId = command.destructive ? "danger" : (command.group || "commands");
    if (!buckets.has(groupId)) buckets.set(groupId, []);
    buckets.get(groupId).push(command);
  }
  return PALETTE_GROUPS
    .map((group) => ({ ...group, items: buckets.get(group.id) || [] }))
    .filter((group) => group.items.length > 0);
}

export function commandSearchValue(command) {
  if (command.searchValue) return command.searchValue;
  return [command.id, command.label, ...(command.keywords || [])].filter(Boolean).join(" ");
}

export function availableComposerCommands(context) {
  return composerCommands.filter((command) => command.isAvailable(context));
}
