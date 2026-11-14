import { createSignal, For, Show, type JSX } from "solid-js";
import { Actions, Icons, Row, StatusDot } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { ARTIFACT_KINDS } from "./artifact-kinds";
import { artifactsOf, artifactsRead, artifactView, copyArtifactMarkdown, countPapers, deleteArtifact, exportArtifactMarkdown, paperCounted, renameArtifact, type Artifact } from "./artifacts";

/** An artifact's mark in a row: its kind's. */
export const ArtifactIcon = (props: { kind: Artifact["kind"] }) => { const Icon = ARTIFACT_KINDS[props.kind].icon; return <Icon />; };

/*
 * A project's artifacts as the sidebar's rows, under its chats, each with its menu and what the menu opens. Loaded
 * when a project is first opened, so the app's first load carries none of it. `empty`: what stands there once the
 * hub has said the project has none (the sidebar's "No chats", which a project with artifacts and no chats does not say).
 */
export default function ArtifactRows(props: { project: string; empty?: JSX.Element; current?: string | null; placement: "bottom-start" | "right-start"; phone: boolean; onOpen: (artifact: Artifact, beside?: boolean) => void }) {
  const [renaming, setRenaming] = createSignal<Artifact | null>(null), [name, setName] = createSignal(""), [deleting, setDeleting] = createSignal<Artifact | null>(null);
  const failed = (error: Error) => { toast.error(error.message); };
  const rename = (event: Event) => {
    event.preventDefault();
    const artifact = renaming();
    if (artifact && name().trim()) void renameArtifact(artifact.id, name().trim()).then(() => setRenaming(null), failed);
  };
  const remove = () => { const artifact = deleting(); setDeleting(null); if (artifact) void deleteArtifact(artifact.id).catch(failed); };
  return <>
    <Show when={artifactsRead(props.project) && !artifactsOf(props.project).length}>{props.empty}</Show>
    <For each={artifactsOf(props.project)}>{(artifact) => <ContextMenu placement={props.placement}>
      <ContextMenuTrigger density="nav" element="button" as={Row} indent current={props.current === artifactView(artifact.id)}
        lead={artifact.working ? <StatusDot label="Its thread is working" tone="active" spinning /> : <ArtifactIcon kind={artifact.kind} />}
        meta={artifact.open ? <span aria-label={`${artifact.open} open ${artifact.open === 1 ? "comment" : "comments"}`}>{artifact.open}</span> : undefined}
        draggable="true" data-doc-view={artifactView(artifact.id)} onClick={() => props.onOpen(artifact)}>{artifact.name}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuSection>
          <MenuRow icon={<ArtifactIcon kind={artifact.kind} />} onSelect={() => props.onOpen(artifact)}>Open</MenuRow>
          <Show when={!props.phone}><MenuRow icon={<Icons.Split />} onSelect={() => props.onOpen(artifact, true)}>Open beside</MenuRow></Show>
          <MenuRow icon={<Icons.Edit />} onSelect={() => { setName(artifact.name); setRenaming(artifact); }}>Rename</MenuRow>
          <Show when={artifact.kind === "paper"}><><MenuRow icon={<Icons.Copy />} onSelect={() => void copyArtifactMarkdown(artifact).then(() => toast.success("Copied as Markdown"), failed)}>Copy as Markdown</MenuRow>
            <MenuRow icon={<Icons.Download />} onSelect={() => void exportArtifactMarkdown(artifact).catch(failed)}>Download Markdown</MenuRow><MenuRow icon={<Icons.FileText />} picked={paperCounted()} onSelect={() => countPapers(!paperCounted())}>Count blocks and words</MenuRow></></Show>
        </MenuSection>
        <MenuSection>
          <MenuRow destructive icon={<Icons.Delete />} onSelect={() => setDeleting(artifact)}>Delete</MenuRow>
        </MenuSection>
      </ContextMenuContent>
    </ContextMenu>}</For>
    <Dialog open={Boolean(renaming())} title="Rename artifact" onOpenChange={(open) => { if (!open) setRenaming(null); }}>
      <CardForm onSubmit={rename}><Field label="Name"><Input id="artifact-rename" value={name()} onInput={(event) => setName(event.currentTarget.value)} /></Field>
        <Actions><Button type="button" variant="ghost" outline onClick={() => setRenaming(null)}>Cancel</Button><Button type="submit" disabled={!name().trim()}>Rename</Button></Actions></CardForm>
    </Dialog>
    <Dialog alert open={Boolean(deleting())} title="Delete this artifact?" description={`This deletes the file ${deleting()?.path ?? ""} from the project's folder.`} onOpenChange={(open) => { if (!open) setDeleting(null); }}
      actions={<><Button variant="ghost" outline onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={remove}>Delete</Button></>} />
  </>;
}
