import { HarnessMark, Icons } from "@/components/ui";
import { createMemo, createSignal, Show } from "solid-js";

import { Button } from "@/components/ui";
import { Popover, PopoverContent, PopoverTrigger, SearchList } from "@/components/menus";
import type { Project } from "../api/contracts";
import { WorkspaceGlyph } from "../project/workspace-appearance";

/** A place's own mark when it has one -- a workspace's identity today, any
 *  place's later -- else a folder; with no place at all, the chat mark. */
export function PlaceGlyph(props: { project?: Project | null }) {
  return <Show when={props.project?.workspaceAppearance || (props.project && isWorkspace(props.project))} fallback={props.project ? <Icons.Folder /> : <HarnessMark id="conduit" />}>
    <WorkspaceGlyph appearance={props.project!.workspaceAppearance} />
  </Show>;
}

export const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");

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
      <Icons.Folder />
    </PopoverTrigger>
    <PopoverContent aria-label="Choose folder">
      <SearchList items={rows()} placeholder="Search folders" onChoose={choose}
        matches={(folder, needle) => !folder.path || `${folder.label} ${folder.path}`.toLowerCase().includes(needle)}
        isCurrent={(folder) => folder.path === props.current}
        row={(folder) => ({ icon: folder.path ? <Icons.Folder /> : undefined, label: folder.label, title: folder.path || undefined })} />
    </PopoverContent>
  </Popover>;
}
