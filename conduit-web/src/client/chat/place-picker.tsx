import { createMemo, createSignal, Show } from "solid-js";
import { FolderIcon } from "lucide-solid";
import { Button } from "@/components/ui";
import { Popover, PopoverContent, PopoverTrigger, SearchList } from "@/components/menus";
import type { Project } from "../api/contracts";
import { WorkspaceGlyph } from "../project/workspace-appearance";

export type PlaceOptions = { projects: Project[]; current?: Project | null; disabled?: boolean; onChoose: (project: Project) => void };

/** A place's own mark when it has one -- a workspace's identity today, any
 *  place's later -- else a folder. */
export function PlaceGlyph(props: { project?: Project | null }) {
  return <Show when={props.project?.workspaceAppearance || (props.project && isWorkspace(props.project))} fallback={<FolderIcon />}>
    <WorkspaceGlyph appearance={props.project!.workspaceAppearance} />
  </Show>;
}

export const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");

/**
 * The searchable list of places: the desktop +'s Project submenu.
 */
export function PlaceList(props: PlaceOptions & { onDone?: () => void }) {
  const root = createMemo(() => props.projects.find((project) => project.slug === "chat"));
  const placed = () => props.current && props.current.slug !== "chat" ? props.current : null;
  // Projects before workspaces, and "No folder" first when the chat is in one.
  const places = createMemo(() => [
    ...(placed() && root() ? [root()!] : []),
    ...props.projects
      .filter((project) => project.slug !== "chat" && project.state !== "cloning")
      .sort((left, right) => Number(isWorkspace(left)) - Number(isWorkspace(right)) || left.name.localeCompare(right.name)),
  ]);
  const choose = (project: Project) => {
    props.onDone?.();
    if (project.id !== props.current?.id) props.onChoose(project);
  };
  return <SearchList items={places()} placeholder="Search projects and workspaces" onChoose={choose}
    matches={(project, needle) => project.slug !== "chat" && project.name.toLowerCase().includes(needle)}
    isCurrent={(project) => project.id === props.current?.id}
    row={(project) => project.slug === "chat" ? { icon: <FolderIcon />, label: "No folder" }
      : { icon: <PlaceGlyph project={project} />, label: project.name, meta: isWorkspace(project) ? "Workspace" : "Project" }} />;
}

export type FolderOptions = { folders: Array<{ path: string; label: string }>; current: string; onChoose: (path: string) => void; onBrowse: () => void };

/**
 * The same button for a harness's own thread, which runs in a folder rather
 * than a place: the folders it has run in, and any other folder by browsing.
 */
export function FolderPicker(props: FolderOptions) {
  const [open, setOpen] = createSignal(false);
  const name = () => props.folders.find((folder) => folder.path === props.current)?.label || props.current.split("/").at(-1) || props.current;
  const rows = createMemo(() => [...props.folders, { path: "", label: "Other folder…" }]);
  const choose = (folder: { path: string }) => {
    setOpen(false);
    if (!folder.path) props.onBrowse();
    else if (folder.path !== props.current) props.onChoose(folder.path);
  };

  return <Popover open={open()} onOpenChange={setOpen} placement="top-start">
    <PopoverTrigger as={Button} variant="ghost" size="icon-sm" aria-label={`In ${name()}. Change folder`} title={props.current}>
      <FolderIcon />
    </PopoverTrigger>
    <PopoverContent aria-label="Choose folder">
      <SearchList items={rows()} placeholder="Search folders" onChoose={choose}
        matches={(folder, needle) => !folder.path || `${folder.label} ${folder.path}`.toLowerCase().includes(needle)}
        isCurrent={(folder) => folder.path === props.current}
        row={(folder) => ({ icon: folder.path ? <FolderIcon /> : undefined, label: folder.label, title: folder.path || undefined })} />
    </PopoverContent>
  </Popover>;
}
