import { createMemo, createSignal, Show } from "solid-js";
import { FolderIcon } from "lucide-solid";
import { Button, Popover, PopoverContent, PopoverSearchList, PopoverTrigger } from "@/components/primitives";
import type { Project } from "../api/contracts";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import "./place-picker.css";

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
 * The composer's folder button: puts the chat in a project or workspace, or
 * takes it out of one. A searchable list of places, as Claude's "Add to
 * project" is, without the menu in front of it.
 */
export function PlacePicker(props: PlaceOptions) {
  const [open, setOpen] = createSignal(false);
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
    setOpen(false);
    if (project.id !== props.current?.id) props.onChoose(project);
  };

  return <Popover open={open()} onOpenChange={setOpen} placement="top-start">
    <PopoverTrigger as={Button} class="composer-desktop-attachment composer-place-trigger" variant="ghost" size="icon-sm" disabled={props.disabled}
      aria-label={placed() ? `In ${placed()!.name}. Change folder` : "Add to a project or workspace"} title={placed() ? `In ${placed()!.name}` : "Add to project"} data-placed={placed() ? "true" : undefined}>
      <PlaceGlyph project={placed()} />
    </PopoverTrigger>
    <PopoverContent class="composer-place-menu" aria-label="Add to project">
      <PopoverSearchList items={places()} placeholder="Search projects and workspaces" onChoose={choose}
        matches={(project, needle) => project.slug !== "chat" && project.name.toLowerCase().includes(needle)}
        isCurrent={(project) => project.id === props.current?.id}>{(project) => <>
        <span class="composer-place-lead"><Show when={project.slug !== "chat"}><PlaceGlyph project={project} /></Show></span>
        <span class="composer-place-label">{project.slug === "chat" ? "No folder" : project.name}</span>
        <Show when={project.slug !== "chat"}><small>{isWorkspace(project) ? "Workspace" : "Project"}</small></Show>
      </>}</PopoverSearchList>
    </PopoverContent>
  </Popover>;
}
