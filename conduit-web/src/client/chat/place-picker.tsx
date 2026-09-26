import { createMemo, createSignal, For, Show } from "solid-js";
import { CheckIcon, FolderIcon } from "lucide-solid";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/primitives";
import type { Project } from "../api/contracts";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import "./place-picker.css";

const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");

/**
 * The composer's folder button: puts the chat in a project or workspace, or
 * takes it out of one. A searchable list of places, as Claude's "Add to
 * project" is, without the menu in front of it.
 */
export function PlacePicker(props: {
  projects: Project[];
  /** The place the chat is in now; the "chat" root means no folder. */
  current?: Project | null;
  disabled?: boolean;
  onChoose: (project: Project) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const root = createMemo(() => props.projects.find((project) => project.slug === "chat"));
  const placed = () => props.current && props.current.slug !== "chat" ? props.current : null;
  const places = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return props.projects
      .filter((project) => project.slug !== "chat" && project.state !== "cloning")
      .filter((project) => !needle || project.name.toLowerCase().includes(needle))
      .sort((left, right) => Number(isWorkspace(left)) - Number(isWorkspace(right)) || left.name.localeCompare(right.name));
  });
  const choose = (project: Project) => {
    setOpen(false);
    setQuery("");
    if (project.id !== props.current?.id) props.onChoose(project);
  };

  return <Popover open={open()} onOpenChange={(value) => { setOpen(value); if (!value) setQuery(""); }} placement="top-start">
    <PopoverTrigger as={Button} class="composer-desktop-attachment composer-place-trigger" variant="ghost" size="icon-sm" disabled={props.disabled}
      aria-label={placed() ? `In ${placed()!.name}. Change folder` : "Add to a project or workspace"} title={placed() ? `In ${placed()!.name}` : "Add to project"} data-placed={placed() ? "true" : undefined}>
      <FolderIcon />
      <Show when={placed()}><span class="composer-place-name">{placed()!.name}</span></Show>
    </PopoverTrigger>
    <PopoverContent class="composer-place-menu" aria-label="Add to project">
      <input class="composer-place-search" placeholder="Search projects and workspaces" value={query()} onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && places()[0]) { event.preventDefault(); choose(places()[0]!); } }} autofocus />
      <div class="composer-place-list">
        <Show when={placed() && root()}>
          <button type="button" onClick={() => choose(root()!)}><span class="composer-place-lead" /><span>No folder</span></button>
        </Show>
        <For each={places()} fallback={<div class="composer-place-empty">No matches.</div>}>{(project) =>
          <button type="button" aria-current={project.id === props.current?.id ? "true" : undefined} onClick={() => choose(project)}>
            <span class="composer-place-lead"><Show when={isWorkspace(project)} fallback={<FolderIcon />}><WorkspaceGlyph appearance={project.workspaceAppearance} /></Show></span>
            <span class="composer-place-label">{project.name}</span>
            <small>{isWorkspace(project) ? "Workspace" : "Project"}</small>
            <Show when={project.id === props.current?.id}><CheckIcon class="composer-place-check" /></Show>
          </button>}
        </For>
      </div>
    </PopoverContent>
  </Popover>;
}
