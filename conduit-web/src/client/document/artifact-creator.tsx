import { createSignal, For, onMount, Show } from "solid-js";
import { Actions, DashHeader, Group, GroupHeading, Note, PaneHome, Row } from "@/components/ui";
import { Button, Field, Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/menus";
import type { Project } from "../api/contracts";
import { ArtifactIcon } from "./artifact-rows";
import { ARTIFACT_KINDS, makeArtifact, type Artifact } from "./artifacts";

/** The artifact creator, drawn in its tab (the view `artifact:new[:<project>]`): a hub refusal (a name already there, a folder on another device) stays on screen in the hub's words. */
export default function ArtifactCreator(props: { project?: string; projects: Project[]; onBack: () => void; onMade: (artifact: Artifact) => void }) {
  const [kind, setKind] = createSignal<Artifact["kind"]>(ARTIFACT_KINDS[0].kind);
  const [project, setProject] = createSignal(props.project ?? props.projects[0]?.id ?? "");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;
  onMount(() => input?.focus());
  const ready = () => Boolean(project() && name().trim()) && !busy();
  const create = async () => {
    if (!ready()) return;
    setBusy(true);
    try { props.onMade(await makeArtifact(project(), { kind: kind(), name: name().trim() })); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <PaneHome label="New artifact">
    <header><DashHeader title="New artifact" /></header>
    <Group kind="dash" id="Kind" heading={<GroupHeading>Kind</GroupHeading>}>
      <For each={ARTIFACT_KINDS}>{(item) => <Row density="list" element="button" aria-pressed={kind() === item.kind} current={kind() === item.kind}
        lead={<ArtifactIcon kind={item.kind} />} label={item.label} onClick={() => setKind(item.kind)} />}</For>
      <Note>{ARTIFACT_KINDS.find((item) => item.kind === kind())?.says}</Note>
    </Group>
    <Field label="Project"><Select id="artifact-project" value={project()} disabled={busy()} onChange={(event) => { setProject(event.currentTarget.value); setError(""); }}>
      <For each={props.projects}>{(item) => <option value={item.id}>{item.name || item.slug}</option>}</For>
    </Select></Field>
    <Field label="Name"><Input ref={input} id="artifact-name" value={name()} disabled={busy()} onInput={(event) => { setName(event.currentTarget.value); setError(""); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} /></Field>
    <Show when={error()}><Note kind="card" tone="error">{error()}</Note></Show>
    <Actions kind="card"><Button variant="ghost" outline disabled={busy()} onClick={props.onBack}>Back</Button><Button disabled={!ready()} onClick={() => void create()}>Create</Button></Actions>
  </PaneHome>;
}
