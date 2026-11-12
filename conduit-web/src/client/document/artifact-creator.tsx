import { createEffect, createSignal, Show } from "solid-js";
import { Actions, Note, Segmented } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input } from "@/components/ui/controls";
import type { Project } from "../api/contracts";
import { ARTIFACT_KINDS, makeArtifact, type Artifact } from "./artifacts";

/** The artifact creator: open while it has a project; a hub refusal (a name already there, a folder on another device) keeps it open with the hub's words. */
export default function ArtifactCreator(props: { project: Project | null; onClose: () => void; onMade: (artifact: Artifact) => void }) {
  const [kind, setKind] = createSignal<Artifact["kind"]>(ARTIFACT_KINDS[0].kind);
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;
  createEffect(() => { if (props.project) { setName(""); setError(""); } });
  const says = () => ARTIFACT_KINDS.find((item) => item.kind === kind())?.says;
  const submit = async (event: Event) => {
    event.preventDefault();
    const project = props.project;
    if (!project || !name().trim() || busy()) return;
    setBusy(true);
    try {
      const made = await makeArtifact(project.id, { kind: kind(), name: name().trim() });
      props.onClose();
      props.onMade(made);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Dialog open={Boolean(props.project)} title="New Artifact" busy={busy()} onOpenChange={(open) => { if (!open) props.onClose(); }}
    onOpenAutoFocus={(event) => { event.preventDefault(); input?.focus(); }}>
    <CardForm onSubmit={submit}>
      <Segmented label="Kind" value={kind()} onChange={setKind} options={ARTIFACT_KINDS.map((item) => ({ value: item.kind, label: item.label }))} />
      <Note kind="card">{says()}</Note>
      <Field label="Name"><Input ref={input} id="artifact-name" required value={name()} disabled={busy()} onInput={(event) => { setName(event.currentTarget.value); setError(""); }} /></Field>
      <Show when={error()}><Note kind="card" tone="error">{error()}</Note></Show>
      <Actions><Button type="button" variant="ghost" outline disabled={busy()} onClick={props.onClose}>Cancel</Button><Button type="submit" disabled={busy() || !name().trim()}>Create</Button></Actions>
    </CardForm>
  </Dialog>;
}
