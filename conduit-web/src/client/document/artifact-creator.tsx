import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";
import { Actions, DashHeader, Group, GroupHeading, Note, PaneHome, Row } from "@/components/ui";
import { Button, Field, Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/menus";
import type { Project } from "../api/contracts";
import { ArtifactIcon } from "./artifact-rows";
import { ARTIFACT_KINDS } from "./artifact-kinds";
import { artifactsOf, makeArtifact, type Artifact, type ArtifactKind } from "./artifacts";

const KINDS = Object.keys(ARTIFACT_KINDS) as ArtifactKind[];

/** The project with the latest chat activity: the one the person was last in, where the creator was not told a project. */
const latest = (projects: Project[]) => projects.map((project) => ({ project, at: project.sessions.reduce((most, chat) => (chat.updatedAt ?? "") > most ? chat.updatedAt ?? "" : most, "") }))
  .sort((a, b) => b.at.localeCompare(a.at))[0]?.project.id ?? "";

/** The artifact creator, drawn in its tab (the view `artifact:new[:<project>]`): a hub refusal (a name already there, a folder on another device) stays on screen in the hub's words. */
export default function ArtifactCreator(props: { project?: string; projects: Project[]; onBack: () => void; onMade: (artifact: Artifact) => void }) {
  const [kind, setKind] = createSignal<ArtifactKind>(KINDS[0]!);
  const [project, setProject] = createSignal(props.project ?? latest(props.projects));
  // Untyped, the name is the first "Untitled" the project has room for, so Create works at once.
  const [typed, setTyped] = createSignal<string | null>(null);
  const untitled = () => {
    const taken = new Set(artifactsOf(project()).filter((item) => item.kind === kind()).map((item) => item.name.toLowerCase()));
    for (let n = 1; ; n += 1) { const name = n === 1 ? "Untitled" : `Untitled ${n}`; if (!taken.has(name.toLowerCase())) return name; }
  };
  const name = () => typed() ?? untitled();
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;
  onMount(() => { input?.focus(); input?.select(); });
  // The list arrives after the field is drawn: the default it brings is selected too, so typing replaces it.
  createEffect(on(untitled, () => { if (typed() === null && document.activeElement === input) queueMicrotask(() => input?.select()); }, { defer: true }));
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
      <For each={KINDS}>{(item) => <Row density="list" element="button" aria-pressed={kind() === item} current={kind() === item}
        lead={<ArtifactIcon kind={item} />} label={ARTIFACT_KINDS[item].label} detail={ARTIFACT_KINDS[item].says} onClick={() => setKind(item)} />}</For>
    </Group>
    <Field label="Project"><Select id="artifact-project" value={project()} disabled={busy()} onChange={(event) => { setProject(event.currentTarget.value); setError(""); }}>
      <For each={props.projects}>{(item) => <option value={item.id}>{item.name || item.slug}</option>}</For>
    </Select></Field>
    <Field label="Name"><Input ref={input} id="artifact-name" value={name()} disabled={busy()} onInput={(event) => { setTyped(event.currentTarget.value); setError(""); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} /></Field>
    <Show when={error()}><Note kind="card" tone="error">{error()}</Note></Show>
    <Actions kind="card"><Button variant="ghost" outline disabled={busy()} onClick={props.onBack}>Back</Button><Button disabled={!ready()} onClick={() => void create()}>Create</Button></Actions>
  </PaneHome>;
}
