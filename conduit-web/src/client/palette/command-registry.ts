/**
 * Command palette registry (Cmd/Ctrl+K).
 *
 * Ported from the React app. Palette owns persistent application actions. Add a
 * static command to `paletteCommands`, or a dynamic list via `paletteSources`.
 * Nested lists (settings sections, chat search targets, and workspace views)
 * live behind page portals so the root browse/search view stays short; children
 * only appear on that page.
 *
 * Command shape:
 *   id, label, group, icon, keywords[], isAvailable(context), run(actions)
 * Optional: description, shortcut, destructive, searchValue, detail, checked,
 *   kind: "page", page (page id for drill-down)
 */

import type { ChatSummary, Project, Template } from "../api/contracts";
import {
  COMMAND_IDS, getCommandDefinition,
} from "../commands/command-registry.ts";

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
}

export interface PaletteActions {
  logout: () => void;
  newChat: (project?: Project | null, launch?: { templateId?: string }) => void;
  newFolder: () => void;
  newWorkspace: () => void;
  openRuntimeChat: () => void;
  attach: () => void;
  toggleDictation: () => void;
  toggleSidebar: () => void;
  toggleWorkspacePanel: () => void;
  openWorkspaceView: (view: "files" | "diff" | "artifacts" | "terminal") => void;
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
  updateApp: () => void;
  resetAppCache: () => void;
  delete: () => void;
  deleteFolder: () => void;
  settings: (section: string) => void;
  workspaceSettings?: (id: string) => void;
  openChat: (session: ChatSummary, project: Project) => void | Promise<void>;
  renameChat: (chat: ChatSummary, project: Project, name: string) => Promise<boolean>;
  moveChats: (targets: Array<{ chat: ChatSummary; project: Project }>, destination: Project) => Promise<string[]>;
  copyChatLinks: (targets: Array<{ chat: ChatSummary; project: Project }>) => Promise<boolean>;
  deleteChats: (targets: Array<{ chat: ChatSummary; project: Project }>) => Promise<string[]>;
  chooseModel: (spec: string) => void;
  chooseEffort: (level: string) => void;
  setChatProfile: (id: string) => void;
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
  entity?: "chat";
  chat?: ChatSummary;
  project?: Project;
  section?: string;
  kind?: "page";
  page?: string | null;
  isAvailable?: (context: PaletteContext) => boolean;
  run: (actions: PaletteActions) => void;
}

export interface PaletteGroup { id: string; heading: string; }
export interface PalettePage {
  id: string;
  commandId: string;
  label: string;
  description: string;
  icon: string;
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
  { id: "ui", label: "UI", keywords: ["interface", "appearance", "renderer", "markdown", "sidebar", "chats"] },
  { id: "shortcuts", label: "Shortcuts", keywords: ["keyboard", "keys", "bindings", "commands", "browser"] },
  { id: "profiles", label: "Profiles", keywords: ["template", "tools", "workspace", "general", "agent"] },
  { id: "workspaces", label: "Workspaces", keywords: ["workspace", "folder", "default", "profile"] },
  { id: "models", label: "Models", keywords: ["model", "llm", "provider"] },
  { id: "runtime", label: "Runtime", keywords: ["processes", "pool", "idle", "generation"] },
  { id: "search", label: "Search", keywords: ["web", "brave", "exa", "research", "provider", "api key"] },
  { id: "auth", label: "Auth", keywords: ["password", "login", "sessions", "logout", "security"] },
  { id: "general", label: "General", keywords: ["preferences", "default", "profile"] },
];

function palettePage(
  id: string,
  commandId: string,
  details: Pick<PalettePage, "prefix" | "placeholder" | "heading">,
): PalettePage {
  const command = getCommandDefinition(commandId);
  return {
    id,
    commandId,
    label: command.label,
    description: command.description,
    icon: command.icon,
    keywords: command.keywords,
    group: command.group,
    ...details,
  };
}

/** Drill-down pages. Root browse shows a portal; page view shows children only. */
export const PALETTE_PAGES: Record<string, PalettePage> = {
  settings: palettePage("settings", COMMAND_IDS.openSettings, {
    prefix: "Settings ›",
    placeholder: "Search settings…",
    heading: "Settings",
  }),
  "chat-search": palettePage("chat-search", COMMAND_IDS.searchChats, {
    prefix: "Search ›",
    placeholder: "Search chats and folders…",
    heading: "Chats",
  }),
  workspace: palettePage("workspace", COMMAND_IDS.openWorkspaceViews, {
    prefix: "Workspace ›",
    placeholder: "Search workspace views…",
    heading: "Workspace views",
  }),
};

const hasChat = (context: PaletteContext) => Boolean(context.chatId);
const isNamedFolder = (context: PaletteContext) => Boolean(context.project && context.project.slug !== "chat");

interface PaletteCommandRuntime {
  isAvailable: (context: PaletteContext) => boolean;
  run: (actions: PaletteActions) => void;
}

const paletteCommandRuntime: Record<string, PaletteCommandRuntime> = {
  [COMMAND_IDS.logout]: { isAvailable: () => true, run: (actions) => actions.logout() },
  [COMMAND_IDS.newChat]: { isAvailable: () => true, run: (actions) => actions.newChat() },
  [COMMAND_IDS.newFolder]: { isAvailable: () => true, run: (actions) => actions.newFolder() },
  [COMMAND_IDS.newWorkspace]: { isAvailable: () => true, run: (actions) => actions.newWorkspace() },
  [COMMAND_IDS.openRuntimeChat]: { isAvailable: () => true, run: (actions) => actions.openRuntimeChat() },
  [COMMAND_IDS.attachFiles]: { isAvailable: hasChat, run: (actions) => actions.attach() },
  [COMMAND_IDS.toggleDictation]: { isAvailable: hasChat, run: (actions) => actions.toggleDictation() },
  [COMMAND_IDS.toggleSidebar]: { isAvailable: () => true, run: (actions) => actions.toggleSidebar() },
  [COMMAND_IDS.toggleWorkspacePanel]: { isAvailable: hasChat, run: (actions) => actions.toggleWorkspacePanel() },
  [COMMAND_IDS.copyTranscript]: { isAvailable: hasChat, run: (actions) => actions.copyTranscript() },
  [COMMAND_IDS.renameChat]: { isAvailable: hasChat, run: (actions) => actions.rename() },
  [COMMAND_IDS.moveChat]: { isAvailable: hasChat, run: (actions) => actions.move() },
  [COMMAND_IDS.renameFolder]: { isAvailable: isNamedFolder, run: (actions) => actions.renameFolder() },
  [COMMAND_IDS.stopResponse]: { isAvailable: (context) => context.streaming, run: (actions) => actions.stop() },
  [COMMAND_IDS.regenerateResponse]: { isAvailable: (context) => Boolean(context.canRegenerate), run: (actions) => actions.regenerate() },
  [COMMAND_IDS.continueResponse]: { isAvailable: (context) => context.canContinue, run: (actions) => actions.continue() },
  [COMMAND_IDS.copyResponse]: { isAvailable: (context) => Boolean(context.canCopy), run: (actions) => actions.copy() },
  [COMMAND_IDS.retryConnection]: {
    isAvailable: (context) => Boolean(context.connectivity) && context.connectivity !== "online",
    run: (actions) => actions.retryConnection(),
  },
  [COMMAND_IDS.reload]: { isAvailable: (context) => context.connectivity === "offline", run: (actions) => actions.reload() },
  [COMMAND_IDS.updateApp]: { isAvailable: () => true, run: (actions) => actions.updateApp() },
  [COMMAND_IDS.resetAppCache]: { isAvailable: () => true, run: (actions) => actions.resetAppCache() },
  [COMMAND_IDS.deleteChat]: { isAvailable: hasChat, run: (actions) => actions.delete() },
  [COMMAND_IDS.deleteFolder]: { isAvailable: isNamedFolder, run: (actions) => actions.deleteFolder() },
};

function stablePaletteCommand(commandId: string, runtime: PaletteCommandRuntime): PaletteCommand {
  const command = getCommandDefinition(commandId);
  return {
    id: command.id,
    group: command.group,
    label: command.label,
    description: command.description,
    icon: command.icon,
    keywords: command.keywords,
    destructive: command.destructive,
    isAvailable: runtime.isAvailable,
    run: runtime.run,
  };
}

/** Static palette actions. Prefer this list for one-shot app operations. */
export const paletteCommands: PaletteCommand[] = Object.entries(paletteCommandRuntime)
  .map(([commandId, runtime]) => stablePaletteCommand(commandId, runtime));

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

const WORKSPACE_VIEWS = [
  { id: "files", label: "Files", description: "Browse the project files", icon: "workspace-panel", keywords: ["tree", "folder", "project"] },
  { id: "diff", label: "Source Control", description: "Inspect working-tree changes", icon: "workspace-panel", keywords: ["git", "diff", "changes"] },
  { id: "artifacts", label: "Artifacts", description: "Browse outputs and interactive artifacts", icon: "workspace-panel", keywords: ["outputs", "preview"] },
  { id: "terminal", label: "Terminal", description: "Open a server-owned shell for this session", icon: "terminal", keywords: ["shell", "console", "pty"] },
] as const;

function workspaceViewCommands(): PaletteCommand[] {
  return WORKSPACE_VIEWS.map((view) => ({
    id: `workspace:${view.id}`,
    group: "navigation",
    page: "workspace",
    label: view.label,
    description: view.description,
    icon: view.icon,
    keywords: ["workspace", view.label, ...view.keywords],
    searchValue: `workspace ${view.label} ${view.keywords.join(" ")}`,
    isAvailable: hasChat,
    run: (actions) => actions.openWorkspaceView(view.id),
  }));
}

function chatCommands(context: PaletteContext): PaletteCommand[] {
  const projects = Array.isArray(context.projects) ? context.projects : [];
  const rows: { project: Project; session: ChatSummary }[] = [];
  for (const project of projects) {
    for (const session of project.sessions || []) {
      rows.push({ project, session });
    }
  }
  rows.sort((left, right) => String(right.session.createdAt || "").localeCompare(String(left.session.createdAt || ""))
    || String(right.session.id || "").localeCompare(String(left.session.id || "")));
  return rows.map(({ project, session }) => ({
    id: `open-chat:${session.id}`,
    group: "navigation",
    page: "chat-search",
    entity: "chat",
    chat: session,
    project,
    section: chatDateSection(session.createdAt),
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

export function chatDateSection(value?: string): string {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "Older";
  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startOfToday - startOfDate) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
}

function folderCommands(context: PaletteContext): PaletteCommand[] {
  const projects = Array.isArray(context.projects) ? context.projects : [];
  return projects.map((project) => ({
    id: `new-chat-in:${project.id}`,
    group: "navigation",
    page: "chat-search",
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
  id: "workspace-views",
  page: "workspace",
  commands: workspaceViewCommands,
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
  page: "chat-search",
  commands: chatCommands,
}, {
  id: "folders",
  page: "chat-search",
  commands: folderCommands,
}];

function thinkingCommandLabel(level: string): string {
  if (level === "xhigh") return "Thinking · XHigh";
  const pretty = `${level?.[0]?.toUpperCase() || ""}${level?.slice(1) || ""}`;
  return `Thinking · ${pretty || level}`;
}

function pagePortalCommands(): PaletteCommand[] {
  return Object.values(PALETTE_PAGES).map((page) => ({
    id: page.commandId,
    kind: "page",
    page: page.id,
    group: page.group || "commands",
    label: page.label,
    description: page.description,
    icon: page.icon,
    keywords: page.keywords || [],
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
 *   never leak into root search — enter a page portal (or use its shortcut) to
 *   search within it.
 * - page set: only that page's children
 */
export function resolvePaletteCommands(context: PaletteContext, options: { page?: string | null } = {}): PaletteCommand[] {
  const requestedPage = options.page || null;
  // `goto` remains a compatibility alias for older callers. It is not a
  // visible page portal.
  const page = requestedPage === "goto" ? "chat-search" : requestedPage;

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
