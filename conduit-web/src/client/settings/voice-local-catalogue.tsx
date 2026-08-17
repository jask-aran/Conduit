import { For, Show } from "solid-js";
import { Field, FieldGroup, FieldLabel } from "@/components/primitives";
import type { VoiceBackendPathStatus, VoiceExecutionCatalogueView, VoiceExecutionProfile, VoiceLocalSelection } from "../api/contracts";

type CatalogueModel = VoiceExecutionCatalogueView["models"][number];
type CatalogueArtifact = VoiceExecutionCatalogueView["artifacts"][number];
type CatalogueBackendPath = VoiceExecutionCatalogueView["backendPaths"][number];

export interface VoiceLocalCatalogueProps {
  catalogue: VoiceExecutionCatalogueView;
  selection: VoiceLocalSelection | null;
  selectedModel: CatalogueModel | null;
  selectedArtifact: CatalogueArtifact | null;
  selectedBackendPath: CatalogueBackendPath | null;
  backendStatus: VoiceBackendPathStatus | null;
  profiles: VoiceExecutionProfile[];
  busy: boolean;
  installingModelId: string | null;
  resolvedProfileId: string;
  dirty: boolean;
  onFamilyChange: (modelId: string) => void;
  onArtifactChange: (artifactId: string) => void;
  onBackendChange: (backendPathId: string) => void;
  onTimingChange: (profileId: string) => void;
}

const executionLabel = (execution: VoiceExecutionProfile["execution"]) => execution === "live" ? "Live" : execution === "eager" ? "During pauses" : "After Stop";
const executionDescription = (execution: VoiceExecutionProfile["execution"]) => execution === "live"
  ? "Text appears while you speak and may revise."
  : execution === "eager"
    ? "Each pause commits a phrase."
    : "Nothing appears until you stop.";
const runtimeLabel = (runtimeId: string) => runtimeId === "transcribe-rs" ? "transcribe-rs ONNX worker" : runtimeId;
const precisionLabel = (precision: string) => precision === "fp32" ? "FP32" : precision.toUpperCase();
const artifactsForModel = (catalogue: VoiceExecutionCatalogueView, modelId: string) => catalogue.artifacts.filter((artifact) => artifact.modelId === modelId);
const backendPathsForModel = (catalogue: VoiceExecutionCatalogueView, modelId: string) => {
  const artifactIds = new Set(artifactsForModel(catalogue, modelId).map((artifact) => artifact.id));
  return catalogue.backendPaths.filter((backendPath) => artifactIds.has(backendPath.artifactId));
};
const artifactForBackendPath = (catalogue: VoiceExecutionCatalogueView, backendPath: CatalogueBackendPath) => catalogue.artifacts.find((artifact) => artifact.id === backendPath.artifactId);
const backendChoiceLabel = (catalogue: VoiceExecutionCatalogueView, backendPath: CatalogueBackendPath) => {
  const artifact = artifactForBackendPath(catalogue, backendPath);
  const runtime = catalogue.runtimes.find((candidate) => candidate.id === backendPath.runtimeId);
  if (!artifact) return backendPath.id;
  return `${precisionLabel(artifact.precision)} · ${artifact.format} · ${Math.ceil(artifact.approximateBytes / 1024 / 1024)} MiB · ${runtimeLabel(backendPath.runtimeId)} · ${backendPath.ports.stream ? "StreamPort" : "BatchPort"} · ${runtime?.compiledComputeBackends.join(" / ") || "compute not reported"}`;
};

export default function VoiceLocalCatalogue(props: VoiceLocalCatalogueProps) {
  const disabled = () => props.busy || Boolean(props.installingModelId);
  const familyArtifacts = () => props.selectedModel ? artifactsForModel(props.catalogue, props.selectedModel.id) : [];
  const familyBackendPaths = () => props.selectedModel ? backendPathsForModel(props.catalogue, props.selectedModel.id) : [];
  const runnerSpecificArtifacts = () => familyArtifacts().length > 0
    && familyArtifacts().every((artifact) => props.catalogue.backendPaths.filter((backendPath) => backendPath.artifactId === artifact.id).length === 1);
  return <div class="voice-card voice-local-catalogue" aria-label="Local transcription selection">
    <div class="voice-selection-heading">
      <div>
        <span class="voice-model-kicker">This machine</span>
        <strong>{props.selectedModel?.label || "Choose a model family"}</strong>
        <small>{props.selectedArtifact?.precision?.toUpperCase() || ""} · {props.selectedArtifact?.format || "Select an artifact"} · {runtimeLabel(props.selection?.runtimeId || "")}</small>
      </div>
      <span class="voice-draft-state" data-dirty={props.dirty}>{props.dirty ? "Unsaved" : "Saved"}</span>
    </div>
    <p>Choose the exact model artifact, runtime, and timing. The saved tuple controls the backend used by dictation.</p>
    <FieldGroup>
      <Field>
        <FieldLabel for="voice-local-family">Model family</FieldLabel>
        <select id="voice-local-family" disabled={disabled()} value={props.selection?.modelId || ""} onChange={(event) => props.onFamilyChange(event.currentTarget.value)}>
          <For each={props.catalogue.models}>{(model) => <option value={model.id}>{model.label}</option>}</For>
        </select>
      </Field>
      <Show when={props.selection}>{(selection) => <>
        <Field>
          <Show when={runnerSpecificArtifacts()} fallback={<>
            <FieldLabel for="voice-local-artifact">Precision and artifact</FieldLabel>
            <select id="voice-local-artifact" disabled={disabled()} value={selection().artifactId} onChange={(event) => props.onArtifactChange(event.currentTarget.value)}>
              <For each={artifactsForModel(props.catalogue, selection().modelId)}>{(artifact) => <option value={artifact.id}>{precisionLabel(artifact.precision)} · {artifact.format} · {Math.ceil(artifact.approximateBytes / 1024 / 1024)} MiB</option>}</For>
            </select>
            <small>{props.selectedModel?.languages || ""} · {props.selectedArtifact?.license.id || ""} · {props.selectedArtifact?.license.attribution || ""}</small>
          </>}>
            <FieldLabel for="voice-local-artifact-runtime">Precision, artifact, and runtime</FieldLabel>
            <select id="voice-local-artifact-runtime" disabled={disabled()} value={props.selectedBackendPath?.id || ""} onChange={(event) => props.onBackendChange(event.currentTarget.value)}>
              <For each={familyBackendPaths()}>{(backendPath) => <option value={backendPath.id}>{backendChoiceLabel(props.catalogue, backendPath)}</option>}</For>
            </select>
            <small>Each row is one installable artifact and runner.</small>
          </Show>
          <Show when={!runnerSpecificArtifacts()}>
            <small>{props.selectedModel?.languages || ""} · {props.selectedArtifact?.license.id || ""} · {props.selectedArtifact?.license.attribution || ""}</small>
          </Show>
        </Field>
        <Show when={!runnerSpecificArtifacts()}>
          <Field>
            <FieldLabel for="voice-local-backend">Runs with</FieldLabel>
            <select id="voice-local-backend" disabled={disabled()} value={props.selectedBackendPath?.id || ""} onChange={(event) => props.onBackendChange(event.currentTarget.value)}>
              <For each={props.catalogue.backendPaths.filter((backendPath) => backendPath.artifactId === selection().artifactId)}>{(backendPath) => {
                const runtime = props.catalogue.runtimes.find((candidate) => candidate.id === backendPath.runtimeId);
                return <option value={backendPath.id}>{runtimeLabel(backendPath.runtimeId)} · {backendPath.ports.stream ? "StreamPort" : "BatchPort"} · {runtime?.compiledComputeBackends.join(" / ") || "compute not reported"}</option>;
              }}</For>
            </select>
            <Show when={props.backendStatus}>{(status) => <span class="voice-selection-status" data-state={status().runtimeState}>{status().artifactState} · {status().runtimeState}{status().actualComputeBackend ? ` · actual ${status().actualComputeBackend}` : ""}{status().loadedRuntimeVersion ? ` · ${status().loadedRuntimeVersion}` : ""}</span>}</Show>
          </Field>
        </Show>
        <Show when={runnerSpecificArtifacts()}>
          <span class="voice-selection-status" data-state={props.backendStatus?.runtimeState || "cold"}>{props.backendStatus?.artifactState || "unknown"} · {props.backendStatus?.runtimeState || "cold"}{props.backendStatus?.actualComputeBackend ? ` · actual ${props.backendStatus.actualComputeBackend}` : ""}{props.backendStatus?.loadedRuntimeVersion ? ` · ${props.backendStatus.loadedRuntimeVersion}` : ""}</span>
        </Show>
        <Field>
          <FieldLabel for="voice-local-timing">When to transcribe</FieldLabel>
          <select id="voice-local-timing" disabled={disabled()} value={props.resolvedProfileId} onChange={(event) => props.onTimingChange(event.currentTarget.value)}>
            <For each={props.profiles}>{(profile) => <option value={profile.id}>{executionLabel(profile.execution)} — {executionDescription(profile.execution)}</option>}</For>
          </select>
          <small>{selection().segmentation === "silero" ? "Pause detection: Silero" : selection().segmentation === "heuristic" ? "Pause detection: Heuristic" : "Pause detection is not used for this timing."}</small>
        </Field>
      </>}
      </Show>
    </FieldGroup>
  </div>;
}
