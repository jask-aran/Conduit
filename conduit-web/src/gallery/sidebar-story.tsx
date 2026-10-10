import { createSignal } from "solid-js";
import type { ChatSummary, Project } from "../client/api/contracts";
import { Sidebar } from "../client/navigation/sidebar";
import { PROJECTS } from "./seed";

/* The app's own sidebar, open as the phone's drawer, over seeded projects and chats. Not wired to a server. */

const at = (hours: number) => new Date(Date.UTC(2026, 9, 10, 20 - hours)).toISOString();
const chat = (projectId: string, id: string, title: string, hours: number): ChatSummary =>
  ({ id, projectId, title, status: "active", harnessId: "conduit", createdAt: at(hours), updatedAt: at(hours), lastUserMessageAt: at(hours) }) as ChatSummary;
const TITLES = ["Lorem ipsum file", "Plan the trip", "Fix the build", "Quarterly numbers", "Rename the folders"];
export const projects = (): Project[] => [
  { id: "chat", slug: "chat", name: "Chats", kind: "unstructured", origin: "managed", workingRoot: "/home/you/chat", sessions: TITLES.slice(0, 4).map((title, index) => chat("chat", `c${index}`, title, index * 3 + 1)) } as Project,
  ...PROJECTS.map((project, p) => ({ ...project, sessions: TITLES.slice(0, 2 + (p % 3)).map((title, index) => chat(project.id, `${project.id}-${index}`, title, p * 5 + index * 2 + 2)) })),
];

const noop = () => {};
const later = async () => {};
const runtime = new Proxy({ stale: () => false, connectivity: () => "online", getProcess: () => undefined }, { get: (target, key: string) => key in target ? (target as never)[key] : () => undefined }) as never;

export function SidebarScreen() {
  const [open, setOpen] = createSignal(true);
  const named = {
    projects: projects(), catalogueLoaded: true, projectId: "chat", selectedId: "c0", dashboard: false, project: false, computer: false, terminal: false,
    runtime, connectivity: "online", workspaceSuggestions: [], workspacePolicy: null, pwaUpdating: false, sidebarPins: [], chatLimit: 8,
    get mobileOpen() { return open(); }, onMobileOpenChange: (value: boolean) => setOpen(value || true),
  };
  // Every handler not named does nothing; async ones resolve.
  const props = new Proxy(named, { get: (target, key: string) => key in target ? (target as never)[key] : key.startsWith("on") ? (key.match(/^on(Add|Rename|Move|Delete|Copy|New|Open(Chat|Project)$|Stop|Toggle)/) ? later : noop) : undefined });
  return <div class="g-sidebar-screen"><Sidebar {...(props as never)} /></div>;
}
