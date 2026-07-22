/**
 * Command palette registry (Cmd/Ctrl+K).
 *
 * Ported from the React app. Palette owns persistent application actions. Add a
 * static command to `paletteCommands`, or a dynamic list via `paletteSources`.
 * Nested lists (settings sections, go-to targets) live behind page portals so
 * the root browse/search view stays short; children only appear on that page.
 *
 * Command shape:
 *   id, label, group, icon, keywords[], isAvailable(context), run(actions)
 * Optional: description, shortcut, destructive, searchValue, detail, checked,
 *   kind: "page", page (page id for drill-down)
 */

import type { ChatSummary, Project, Template } from "../api/contracts";

/** Server-provided Pi slash command. Deferred: `context.commands` stays [] until
 *  composer-slash parity populates it, so the `pi-commands` source is inert. */
export interface PiCommand {
  name: string;
  description?: string;
  source?: string;
  dispatch?: "insert" | "prompt";
}

export interface PaletteContext {
  chatId: string | null;
  project?: Project;
  projects: Project[];
  templates: Template[];
  templateId: string | null;
  chatStatus: string;
  streaming: boolean;
  connectivity: string;
  effort: string;
  thinkingLevels: string[];
  canRegenerate: boolean;
  canContinue: boolean;
  canCopy: boolean;
  commands: PiCommand[];
}

export interface PaletteActions {
  logout: () => void;
  newChat: (project?: Project | null, launch?: { templateId?: string }) => void;
  newFolder: () => void;
  newWorkspace: () => void;
  openRuntimeChat: () => void;
  attach: () => void;
  toggleSidebar: () => void;
  toggleWorkspacePanel: () => void;
  copyTranscript: () => void;
  rename: () => void;
  move: () => void;
  renameFolder: () => void;
  stop: () => void;
  regenerate: () => void;
  continue: () => void;
  copy: () => void;
  retryConnection: () => void;
  reload: () => void;
  delete: () => void;
  deleteFolder: () => void;
  settings: (section: string) => void;
  workspaceSettings?: (id: string) => void;
  openChat: (session: ChatSummary, project: Project) => void;
  chooseModel: (spec: string) => void;
  chooseEffort: (level: string) => void;
  setChatProfile: (id: string) => void;
  insertCommand?: (text: string) => void;
  sendText?: (text: string) => void;
}

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  description?: string;
  icon: string;
  keywords: string[];
  shortcut?: string | null;
  destructive?: boolean;
  checked?: boolean;
  detail?: string;
  searchValue?: string;
  kind?: "page";
  page?: string | null;
  isAvailable?: (context: PaletteContext) => boolean;
  run: (actions: PaletteActions) => void;
}

export interface PaletteGroup { id: string; heading: string; }
export interface PalettePage {
  id: string;
  label: string;
  description: string;
  icon: string;
  shortcut: string;
  keywords: string[];
  group: string;
  prefix: string;
  placeholder: string;
  heading: string;
}

export const PALETTE_GROUPS: PaletteGroup[] = [
  { id: "commands", heading: "Commands" },
  { id: "settings", heading: "Settings" },
  { id: "navigation", heading: "Go to" },
  { id: "profiles", heading: "Profiles" },
  { id: "thinking", heading: "Thinking level" },
  { id: "danger", heading: "Danger zone" },
];

/** Only sections the Solid Settings surface renders. Target's `diagnostics` is
 *  omitted (no Solid surface yet) to avoid a dead drill-down entry. */
export const SETTINGS_SECTIONS = [
  { id: "profiles", label: "Profiles", keywords: ["template", "tools", "workspace", "general", "agent"] },
  { id: "workspaces", label: "Workspaces", keywords: ["workspace", "folder", "default", "profile"] },
  { id: "models", label: "Models", keywords: ["model", "llm", "provider"] },
  { id: "runtime", label: "Runtime", keywords: ["processes", "pool", "idle", "generation"] },
  { id: "auth", label: "Auth", keywords: ["password", "login", "sessions", "logout", "security"] },
  { id: "general", label: "General", keywords: ["preferences", "default", "profile"] },
];

/** Drill-down pages. Root browse shows a portal; page view shows children only. */
export const PALETTE_PAGES: Record<string, PalettePage> = {
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

const hasChat = (context: PaletteContext) => Boolean(context.chatId);
const isNamedFolder = (context: PaletteContext) => Boolean(context.project && context.project.slug !== "chat");

/** Static palette actions. Prefer this list for one-shot app operations. */
export const paletteCommands: PaletteCommand[] = [{
  id: "logout",
  group: "danger",
  label: "Sign out",
  description: "Ends this browser's Conduit session",
  icon: "logout",
  keywords: ["logout", "sign out", "session", "auth"],
  isAvailable: () => true,
  run: (actions) => actions.logout(),
}, {
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
  id: "toggle-workspace-panel",
  group: "commands",
  label: "Toggle workspace panel",
  description: "Browse project files and working-tree changes",
  icon: "workspace-panel",
  keywords: ["files", "diff", "inspector", "right panel"],
  shortcut: "⌘.",
  isAvailable: hasChat,
  run: (actions) => actions.toggleWorkspacePanel(),
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
  isAvailable: (context) => Boolean(context.connectivity) && context.connectivity !== "online",
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

const NAV_CHAT_LIMIT = 25;

function settingsSectionCommands(context: PaletteContext): PaletteCommand[] {
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
    run: (actions) => section.id === "workspaces" && context.project?.kind === "workspace"
      ? actions.workspaceSettings?.(context.project.id)
      : actions.settings(section.id),
  }));
}

function chatCommands(context: PaletteContext): PaletteCommand[] {
  const projects = Array.isArray(context.projects) ? context.projects : [];
  const rows: { project: Project; session: ChatSummary }[] = [];
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

function folderCommands(context: PaletteContext): PaletteCommand[] {
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

interface PaletteSource {
  id: string;
  page: string | null;
  commands: (context: PaletteContext) => PaletteCommand[];
}

/**
 * Dynamic palette sources. `page` sources only appear on their drill-down page
 * or when the root search is active. Root-only sources (thinking) always show.
 */
export const paletteSources: PaletteSource[] = [{
  id: "settings-sections",
  page: "settings",
  commands: settingsSectionCommands,
}, {
  id: "profiles",
  page: null,
  commands(context) {
    const templates = (Array.isArray(context.templates) ? context.templates : [])
      .filter((template) => template.defaultable !== false);
    const draft = context.chatStatus === "draft" && context.templateId !== "runtime";
    return templates.flatMap((template) => {
      const rows: PaletteCommand[] = [{
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
  id: "pi-commands",
  page: null,
  // Deferred: inert until composer-slash parity populates `context.commands`.
  commands(context) {
    const commands = Array.isArray(context.commands) ? context.commands : [];
    return commands
      .filter((command) => command && typeof command.name === "string" && command.name)
      .map((command) => ({
        id: `pi-command:${command.name}`,
        group: "commands",
        label: `/${command.name}`,
        description: command.description || `Run the ${command.name} command`,
        icon: "command",
        keywords: ["command", "slash", command.name, command.source || ""],
        searchValue: `command ${command.name} ${command.description || ""}`,
        isAvailable: (ctx) => Boolean(ctx.chatId),
        run: (actions) => command.dispatch === "insert"
          ? actions.insertCommand?.(`/${command.name}`)
          : actions.sendText?.(`/${command.name}`),
      }));
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

function thinkingCommandLabel(level: string): string {
  if (level === "xhigh") return "Thinking · XHigh";
  const pretty = `${level?.[0]?.toUpperCase() || ""}${level?.slice(1) || ""}`;
  return `Thinking · ${pretty || level}`;
}

function pagePortalCommands(): PaletteCommand[] {
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

function filterAvailable(items: PaletteCommand[], context: PaletteContext): PaletteCommand[] {
  return items.filter((command) => !command.isAvailable || command.isAvailable(context));
}

/**
 * Resolve commands for the palette.
 * - page null: root only (static actions, portals, root sources). Page children
 *   never leak into root search — enter Settings… / Go to… (or a shortcut that
 *   opens that page) to search within them.
 * - page set: only that page's children
 */
export function resolvePaletteCommands(context: PaletteContext, options: { page?: string | null } = {}): PaletteCommand[] {
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

export function groupPaletteCommands(commands: PaletteCommand[]): (PaletteGroup & { items: PaletteCommand[] })[] {
  const buckets = new Map<string, PaletteCommand[]>(PALETTE_GROUPS.map((group) => [group.id, []]));
  for (const command of commands) {
    const groupId = command.destructive ? "danger" : (command.group || "commands");
    if (!buckets.has(groupId)) buckets.set(groupId, []);
    buckets.get(groupId)!.push(command);
  }
  return PALETTE_GROUPS
    .map((group) => ({ ...group, items: buckets.get(group.id) || [] }))
    .filter((group) => group.items.length > 0);
}

export function commandSearchValue(command: PaletteCommand): string {
  if (command.searchValue) return command.searchValue;
  return [command.id, command.label, ...(command.keywords || [])].filter(Boolean).join(" ");
}
