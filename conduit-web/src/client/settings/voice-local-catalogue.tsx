import { For, Show } from "solid-js";
import { Button } from "@/components/primitives";
import { Switch } from "./settings-controls";
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
  // Rows in the Transcription tile, like the cloud ones: the choices, then
  // the model files with the one action they need. The long runtime and
  // variant facts are each option's title, not its label.
  const runtimeShortLabel = (runtimeId: string) => runtimeLabel(runtimeId).replace(/ ONNX worker$/, "");
  const variantShortLabel = (artifact: CatalogueArtifact) => `${precisionLabel(artifact.precision)} · ${Math.ceil(artifact.approximateBytes / 1024 / 1024)} MiB`;
  const filesState = () => props.installingModelId
    ? props.installProgress ? `${props.installProgress.phase} · ${Math.round(100 * props.installProgress.completedBytes / Math.max(1, props.installProgress.totalBytes))}%` : "Installing…"
    : artifactStateLabel(props.backendStatus?.artifactState).replace(/^./, (first) => first.toUpperCase());
  return <>
    <label class="settings-line" for="voice-local-family"><span>Model</span>
      <select id="voice-local-family" disabled={disabled()} title={props.selectedModel?.description} value={props.selection?.modelId || ""} onChange={(event) => props.onFamilyChange(event.currentTarget.value)}>
        <For each={props.catalogue.models}>{(model) => <option value={model.id}>{model.label}</option>}</For>
      </select>
    </label>
    <Show when={props.selection}>{(selection) => <>
      <label class="settings-line" for="voice-local-runtime"><span>Runtime</span>
        <select id="voice-local-runtime" disabled={disabled()} value={selection().runtimeId} onChange={(event) => props.onRuntimeChange(event.currentTarget.value)}>
          <For each={runtimeChoices()}>{(backendPath) => <option value={backendPath.runtimeId} title={runtimeOptionLabel(backendPath.runtimeId)}>{runtimeShortLabel(backendPath.runtimeId)}</option>}</For>
        </select>
      </label>
      <label class="settings-line" for="voice-local-variant"><span>Variant</span>
        <select id="voice-local-variant" disabled={disabled()} value={selection().artifactId} onChange={(event) => props.onVariantChange(event.currentTarget.value)}>
          <For each={variantChoices()}>{(artifact) => <option value={artifact.id} title={variantOptionLabel(artifact)}>{variantShortLabel(artifact)}</option>}</For>
        </select>
      </label>
      <label class="settings-line" for="voice-local-batching"><span>Timing</span>
        <select id="voice-local-batching" disabled={disabled() || !props.profiles.length} title={selectedProfile() ? profileDescription(selectedProfile()!) : undefined} value={selectedProfile()?.id || ""} onChange={(event) => props.onTimingChange(event.currentTarget.value)}>
          <For each={props.profiles}>{(profile) => <option value={profile.id}>{profileLabel(profile)}</option>}</For>
        </select>
      </label>
      <Show when={props.selectedLocalModel && !props.selectedLocalModel!.installed && !props.installingModelId}>
        <div class="settings-line" title={props.selectedLocalModel!.license.attribution}><span>Accept {props.selectedLocalModel!.license.id} licence</span>
          <Switch label={`Accept ${props.selectedLocalModel!.license.id} licence`} checked={props.licenseAccepted} onChange={props.onLicenseChange} />
        </div>
      </Show>
      <div class="settings-line" title={statusFacts()}><span>Model files<em>{filesState().toLowerCase()}</em></span>
        <Show when={props.installingModelId} fallback={<Show when={props.selectedLocalModel?.installed} fallback={<Button size="sm" disabled={disabled() || !props.licenseAccepted || !props.selectedLocalModel} onClick={props.onInstall}>Install</Button>}><Button variant="ghost" size="sm" disabled={disabled() || !props.selectedLocalModel} onClick={props.onUninstall}>Uninstall</Button></Show>}>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onCancelInstall}>Cancel</Button>
        </Show>
      </div>
      <Show when={props.installProgress}>{(progress) => <div class="settings-line-wide"><progress class="settings-progress" max={Math.max(1, progress().totalBytes)} value={progress().completedBytes} /></div>}</Show>
      <Show when={props.selectedLocalModel?.error}><p role="alert" class="settings-line-note">{props.selectedLocalModel!.error}</p></Show>
    </>}</Show>
  </>;
}
