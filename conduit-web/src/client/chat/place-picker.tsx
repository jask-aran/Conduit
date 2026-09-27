import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { FolderIcon } from "lucide-solid";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/primitives";
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
  // The rows as the keyboard walks them: "No folder" first when placed.
  const rows = createMemo(() => [...(placed() && root() ? [root()!] : []), ...places()]);
  // The cursor, -1 while it rests in the search. The search keeps focus, so
  // typing still filters while the arrows walk the list.
  const [active, setActive] = createSignal(-1);
  let list: HTMLDivElement | undefined;
  createEffect(on(query, () => setActive(query().trim() ? 0 : -1), { defer: true }));
  createEffect(on(active, (index) => list?.querySelectorAll<HTMLElement>(".menu-row")[index]?.scrollIntoView({ block: "nearest" })));
  const move = (step: number) => {
    const count = rows().length;
    if (count) setActive((index) => index < 0 ? (step > 0 ? 0 : count - 1) : (index + step + count) % count);
  };
  const choose = (project: Project) => {
    setOpen(false);
    setQuery("");
    setActive(-1);
    if (project.id !== props.current?.id) props.onChoose(project);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
    else if (event.key === "Enter") {
      const row = rows()[active()] ?? (query().trim() ? places()[0] : undefined);
      if (row) { event.preventDefault(); choose(row); }
    }
  };

  return <Popover open={open()} onOpenChange={(value) => { setOpen(value); if (!value) { setQuery(""); setActive(-1); } }} placement="top-start">
    <PopoverTrigger as={Button} class="composer-desktop-attachment composer-place-trigger" variant="ghost" size="icon-sm" disabled={props.disabled}
      aria-label={placed() ? `In ${placed()!.name}. Change folder` : "Add to a project or workspace"} title={placed() ? `In ${placed()!.name}` : "Add to project"} data-placed={placed() ? "true" : undefined}>
      <PlaceGlyph project={placed()} />
    </PopoverTrigger>
    <PopoverContent class="composer-place-menu" aria-label="Add to project">
      <input class="composer-place-search" placeholder="Search projects and workspaces" value={query()} onInput={(event) => setQuery(event.currentTarget.value)}
        role="combobox" aria-expanded="true" aria-controls="composer-place-list" aria-activedescendant={active() >= 0 ? `composer-place-${active()}` : undefined}
        onKeyDown={onKeyDown} autofocus />
      <div class="composer-place-list" id="composer-place-list" role="listbox" ref={list}>
        <For each={rows()} fallback={<div class="composer-place-empty">No matches.</div>}>{(project, index) =>
          <button type="button" class="menu-row" role="option" id={`composer-place-${index()}`} tabIndex={-1}
            aria-selected={active() === index()} data-highlighted={active() === index() || undefined} data-checked={project.id === props.current?.id || undefined}
            onPointerMove={() => setActive(index())} onClick={() => choose(project)}>
            <span class="composer-place-lead"><Show when={project.slug !== "chat"}><PlaceGlyph project={project} /></Show></span>
            <span class="composer-place-label">{project.slug === "chat" ? "No folder" : project.name}</span>
            <Show when={project.slug !== "chat"}><small>{isWorkspace(project) ? "Workspace" : "Project"}</small></Show>
          </button>}
        </For>
      </div>
    </PopoverContent>
  </Popover>;
}
