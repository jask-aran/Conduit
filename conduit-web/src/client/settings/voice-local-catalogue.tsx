import { For, Show } from "solid-js";
import { Button, Field, FieldGroup, FieldLabel } from "@/components/primitives";
import type { VoiceBackendPathStatus, VoiceExecutionProfile, VoiceExecutionCatalogueView, VoiceLocalModel, VoiceLocalSelection } from "../api/contracts";

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
  backendStatuses: VoiceBackendPathStatus[];
  selectedLocalModel: VoiceLocalModel | null;
  profiles: VoiceExecutionProfile[];
  busy: boolean;
  installingModelId: string | null;
  installProgress: { phase: string; current: string; completedBytes: number; totalBytes: number } | null;
  licenseAccepted: boolean;
  dirty: boolean;
  onFamilyChange: (modelId: string) => void;
  onRuntimeChange: (runtimeId: string) => void;
  onVariantChange: (artifactId: string) => void;
  onTimingChange: (profileId: string) => void;
  onLicenseChange: (accepted: boolean) => void;
  onInstall: () => void;
  onCancelInstall: () => void;
  onUninstall: () => void;
}

const executionLabel = (execution: VoiceExecutionProfile["execution"]) => execution === "live" ? "Live" : execution === "eager" ? "During pauses" : "After Stop";
const executionDescription = (execution: VoiceExecutionProfile["execution"]) => execution === "live"
  ? "Text appears while you speak and may revise."
  : execution === "eager"
    ? "Each pause commits a phrase."
    : "Nothing appears until you stop.";
const segmentationLabel = (segmentation: VoiceExecutionProfile["segmentation"]) => segmentation === "silero" ? "Silero" : segmentation === "heuristic" ? "Silence detection" : "None";
const runtimeLabel = (runtimeId: string) => runtimeId === "transcribe-rs"
  ? "transcribe-rs ONNX worker"
  : runtimeId === "parakeet-loopback"
    ? "Parakeet loopback"
    : runtimeId === "transformers-js"
      ? "Transformers.js"
      : runtimeId === "transcribe-cpp"
        ? "transcribe.cpp"
        : runtimeId;
const precisionLabel = (precision: string) => precision === "fp32" ? "FP32" : precision.toUpperCase();
const artifactStateLabel = (state: VoiceBackendPathStatus["artifactState"] | null | undefined) => state === "installed" ? "installed" : state === "installing" ? "installing" : state === "failed" ? "failed" : state === "absent" ? "not installed" : "state not reported";
const artifactsForModel = (catalogue: VoiceExecutionCatalogueView, modelId: string) => catalogue.artifacts.filter((artifact) => artifact.modelId === modelId);
const backendPathsForModel = (catalogue: VoiceExecutionCatalogueView, modelId: string) => {
  const artifactIds = new Set(artifactsForModel(catalogue, modelId).map((artifact) => artifact.id));
  return catalogue.backendPaths.filter((backendPath) => artifactIds.has(backendPath.artifactId));
};
const artifactForBackendPath = (catalogue: VoiceExecutionCatalogueView, backendPath: CatalogueBackendPath) => catalogue.artifacts.find((artifact) => artifact.id === backendPath.artifactId);
const formatLabel = (format: string) => format === "onnx-package" ? "ONNX" : format === "transformers.js" ? "ONNX package" : format.toUpperCase();
const profileLabel = (profile: VoiceExecutionProfile) => profile.execution === "eager"
  ? `${executionLabel(profile.execution)} · ${segmentationLabel(profile.segmentation)}`
  : executionLabel(profile.execution);
const profileDescription = (profile: VoiceExecutionProfile) => profile.execution === "eager"
  ? `${executionDescription(profile.execution)} Uses ${segmentationLabel(profile.segmentation)}.`
  : executionDescription(profile.execution);

export default function VoiceLocalCatalogue(props: VoiceLocalCatalogueProps) {
  const disabled = () => props.busy || Boolean(props.installingModelId);
  const familyArtifacts = () => props.selectedModel ? artifactsForModel(props.catalogue, props.selectedModel.id) : [];
  const familyBackendPaths = () => props.selectedModel ? backendPathsForModel(props.catalogue, props.selectedModel.id) : [];
  const runtimeChoices = () => {
    const seen = new Set<string>();
    return familyBackendPaths().filter((backendPath) => {
      if (seen.has(backendPath.runtimeId)) return false;
      seen.add(backendPath.runtimeId);
      return true;
    });
  };
  const pathsForRuntime = () => familyBackendPaths().filter((backendPath) => backendPath.runtimeId === props.selection?.runtimeId);
  const variantChoices = () => pathsForRuntime()
    .map((backendPath) => artifactForBackendPath(props.catalogue, backendPath))
    .filter((artifact): artifact is CatalogueArtifact => Boolean(artifact));
  const statusForPath = (backendPath: CatalogueBackendPath | null) => backendPath ? props.backendStatuses.find((status) => status.backendPathId === backendPath.id) || null : null;
  const statusFacts = () => {
    const status = props.backendStatus;
    if (!status) return "Status not reported";
    return [
      artifactStateLabel(status.artifactState),
      status.runtimeState,
      status.requestedComputeBackend ? `requested ${status.requestedComputeBackend}` : null,
      status.actualComputeBackend ? `actual ${status.actualComputeBackend}` : null,
      status.loadedRuntimeVersion || null,
    ].filter(Boolean).join(" · ");
  };
  const runtimeOptionLabel = (runtimeId: string) => {
    const paths = familyBackendPaths().filter((backendPath) => backendPath.runtimeId === runtimeId);
    const formats = [...new Set(paths.map((path) => artifactForBackendPath(props.catalogue, path)?.format).filter((format): format is string => Boolean(format)))].map(formatLabel).join(" / ");
    const runtime = props.catalogue.runtimes.find((candidate) => candidate.id === runtimeId);
    const ports = paths.some((path) => path.ports.stream) ? "BatchPort + StreamPort" : "BatchPort";
    return `${runtimeLabel(runtimeId)} · ${formats || "format not reported"} · ${ports} · ${runtime?.compiledComputeBackends.join(" / ") || "compute not reported"}`;
  };
  const variantOptionLabel = (artifact: CatalogueArtifact) => {
    const path = familyBackendPaths().find((candidate) => candidate.artifactId === artifact.id && candidate.runtimeId === props.selection?.runtimeId) || null;
    return `${precisionLabel(artifact.precision)} · ${formatLabel(artifact.format)} · ${Math.ceil(artifact.approximateBytes / 1024 / 1024)} MiB · ${artifactStateLabel(statusForPath(path)?.artifactState)}`;
  };
  const selectedProfile = () => props.profiles.find((profile) => profile.execution === props.selection?.execution && profile.segmentation === props.selection?.segmentation) || null;
  return <div class="voice-card voice-local-catalogue" aria-label="Local transcription selection">
    <div class="voice-selection-heading">
      <div>
        <span class="voice-model-kicker">This machine</span>
        <strong>{props.selectedModel?.label || "Choose a model family"}</strong>
        <small>{props.selectedArtifact?.precision?.toUpperCase() || ""} · {props.selectedArtifact?.format || "Select a variant"} · {runtimeLabel(props.selection?.runtimeId || "")}</small>
      </div>
      <span class="voice-draft-state" data-dirty={props.dirty}>{props.dirty ? "Unsaved" : "Saved"}</span>
    </div>
    <p>{props.selectedModel?.description || "Choose a model family, runtime, variant, and batching mode."}</p>
    <small class="voice-selection-guide">Choose the model family first. Runtime, variant, and batching choices are limited to the catalogue path that can run it.</small>
    <FieldGroup>
      <Field>
        <FieldLabel for="voice-local-family">Model family</FieldLabel>
        <select id="voice-local-family" disabled={disabled()} value={props.selection?.modelId || ""} onChange={(event) => props.onFamilyChange(event.currentTarget.value)}>
          <For each={props.catalogue.models}>{(model) => <option value={model.id}>{model.label}</option>}</For>
        </select>
      </Field>
      <Show when={props.selection}>{(selection) => <>
        <Field>
          <FieldLabel for="voice-local-runtime">Runtime</FieldLabel>
          <select id="voice-local-runtime" disabled={disabled()} value={selection().runtimeId} onChange={(event) => props.onRuntimeChange(event.currentTarget.value)}>
            <For each={runtimeChoices()}>{(backendPath) => <option value={backendPath.runtimeId}>{runtimeOptionLabel(backendPath.runtimeId)}</option>}</For>
          </select>
          <small>The runtime chooses the execution implementation. Compatible model format and valid ports are shown here.</small>
        </Field>
        <Field>
          <FieldLabel for="voice-local-variant">Precision or variant</FieldLabel>
          <select id="voice-local-variant" disabled={disabled()} value={selection().artifactId} onChange={(event) => props.onVariantChange(event.currentTarget.value)}>
            <For each={variantChoices()}>{(artifact) => <option value={artifact.id}>{variantOptionLabel(artifact)}</option>}</For>
          </select>
          <small>{props.selectedModel?.languages || ""} · {props.selectedArtifact?.license.id || ""} · {props.selectedArtifact?.license.attribution || ""}. Install state controls whether this variant's files are available.</small>
        </Field>
        <span class="voice-selection-status" data-state={props.backendStatus?.runtimeState || "cold"}>{statusFacts()}</span>
        <Field>
          <FieldLabel for="voice-local-batching">Batching</FieldLabel>
          <select id="voice-local-batching" disabled={disabled() || !props.profiles.length} value={selectedProfile()?.id || ""} onChange={(event) => props.onTimingChange(event.currentTarget.value)}>
            <For each={props.profiles}>{(profile) => <option value={profile.id}>{profileLabel(profile)}</option>}</For>
          </select>
          <small>{selectedProfile() ? profileDescription(selectedProfile()!) : "This runtime and variant have no available batching profile."}</small>
        </Field>
        <div class="voice-install-panel">
          <div class="voice-install-heading">
            <h3>Managed local models</h3>
            <span class="voice-model-status"><span>{artifactStateLabel(props.backendStatus?.artifactState)}</span></span>
          </div>
          <p>Install the selected variant to enable this path. Compatible runtimes use the same managed model files where the catalogue declares them.</p>
          <Show when={props.installProgress}>{(progress) => <div class="voice-progress"><progress max={Math.max(1, progress().totalBytes)} value={progress().completedBytes} /><small>{progress().phase} · {progress().current || "preparing package"}</small></div>}</Show>
          <Show when={props.selectedLocalModel?.error}><p role="alert" class="settings-inline-error">{props.selectedLocalModel!.error}</p></Show>
          <Show when={props.selectedLocalModel && !props.selectedLocalModel!.installed && !props.installingModelId}>
            <label class="dictation-auto-send"><input type="checkbox" checked={props.licenseAccepted} onChange={(event) => props.onLicenseChange(event.currentTarget.checked)} /><span><strong>Accept {props.selectedLocalModel!.license.id}</strong><small>{props.selectedLocalModel!.license.attribution}.</small></span></label>
          </Show>
          <div class="voice-actions">
            <Show when={props.installingModelId} fallback={<Show when={props.selectedLocalModel?.installed} fallback={<Button disabled={disabled() || !props.licenseAccepted || !props.selectedLocalModel} onClick={props.onInstall}>Install selected variant</Button>}><Button variant="outline" disabled={disabled() || !props.selectedLocalModel} onClick={props.onUninstall}>Uninstall model files</Button></Show>}>
              <Button variant="outline" disabled={props.busy} onClick={props.onCancelInstall}>Cancel installation</Button>
            </Show>
          </div>
        </div>
      </>}
      </Show>
    </FieldGroup>
  </div>;
}
