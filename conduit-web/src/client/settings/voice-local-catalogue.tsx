import { For, Show } from "solid-js";
import { Button, Progress, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/menus";
import { SettingLine, SettingWide } from "@/components/ui/overlay";
import type { VoiceArtifactStatus, VoiceExecutionProfile, VoiceExecutionCatalogueView, VoiceLocalModel, VoiceLocalSelection } from "../api/contracts";
import { Note } from "@/components/ui/state";

type CatalogueModel = VoiceExecutionCatalogueView["models"][number];
type CatalogueArtifact = VoiceExecutionCatalogueView["artifacts"][number];

export interface VoiceLocalCatalogueProps {
  catalogue: VoiceExecutionCatalogueView;
  selection: VoiceLocalSelection | null;
  selectedModel: CatalogueModel | null;
  selectedArtifact: CatalogueArtifact | null;
  artifactStatus: VoiceArtifactStatus | null;
  artifactStatuses: VoiceArtifactStatus[];
  selectedLocalModel: VoiceLocalModel | null;
  profiles: VoiceExecutionProfile[];
  busy: boolean;
  installingModelId: string | null;
  installProgress: { phase: string; current: string; completedBytes: number; totalBytes: number } | null;
  licenseAccepted: boolean;
  onFamilyChange: (modelId: string) => void;
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
const segmentationLabel = (segmentation: VoiceExecutionProfile["segmentation"]) => segmentation === "heuristic" ? "Silence detection" : "None";
const precisionLabel = (precision: string) => precision === "fp32" ? "FP32" : precision.toUpperCase();
const artifactStateLabel = (state: VoiceArtifactStatus["artifactState"] | null | undefined) => state === "installed" ? "installed" : state === "installing" ? "installing" : state === "failed" ? "failed" : state === "absent" ? "not installed" : "state not reported";
const artifactsForModel = (catalogue: VoiceExecutionCatalogueView, modelId: string) => catalogue.artifacts.filter((artifact) => artifact.modelId === modelId);
const formatLabel = (format: string) => format.toUpperCase();
const profileLabel = (profile: VoiceExecutionProfile) => profile.execution === "eager"
  ? `${executionLabel(profile.execution)} · ${segmentationLabel(profile.segmentation)}`
  : executionLabel(profile.execution);
const profileDescription = (profile: VoiceExecutionProfile) => profile.execution === "eager"
  ? `${executionDescription(profile.execution)} Uses ${segmentationLabel(profile.segmentation)}.`
  : executionDescription(profile.execution);

export default function VoiceLocalCatalogue(props: VoiceLocalCatalogueProps) {
  const disabled = () => props.busy || Boolean(props.installingModelId);
  const variantChoices = () => props.selectedModel ? artifactsForModel(props.catalogue, props.selectedModel.id) : [];
  const statusForArtifact = (artifact: CatalogueArtifact) => props.artifactStatuses.find((status) => status.artifactId === artifact.id) || null;
  const statusFacts = () => {
    const status = props.artifactStatus;
    if (!status) return "Status not reported";
    return [
      artifactStateLabel(status.artifactState),
      status.runtimeState,
      status.requestedComputeBackend ? `requested ${status.requestedComputeBackend}` : null,
      status.actualComputeBackend ? `actual ${status.actualComputeBackend}` : null,
      status.loadedRuntimeVersion || null,
    ].filter(Boolean).join(" · ");
  };
  const variantOptionLabel = (artifact: CatalogueArtifact) => {
    return `${precisionLabel(artifact.precision)} · ${formatLabel(artifact.format)} · ${Math.ceil(artifact.approximateBytes / 1024 / 1024)} MiB · ${artifactStateLabel(statusForArtifact(artifact)?.artifactState)}`;
  };
  const selectedProfile = () => props.profiles.find((profile) => profile.execution === props.selection?.execution && profile.segmentation === props.selection?.segmentation) || null;
  // Rows in the Transcription tile, like the cloud ones: the choices, then
  // the model files with the one action they need. The long variant facts
  // are each option's title, not its label.
  const variantShortLabel = (artifact: CatalogueArtifact) => `${precisionLabel(artifact.precision)} · ${Math.ceil(artifact.approximateBytes / 1024 / 1024)} MiB`;
  const filesState = () => props.installingModelId
    ? props.installProgress?.phase === "runtime" ? "Downloading the voice runtime…" : props.installProgress ? `${props.installProgress.phase} · ${Math.round(100 * props.installProgress.completedBytes / Math.max(1, props.installProgress.totalBytes))}%` : "Installing…"
    : artifactStateLabel(props.artifactStatus?.artifactState).replace(/^./, (first) => first.toUpperCase());
  return <>
    <SettingLine label="Model">
      <Select id="voice-local-family" disabled={disabled()} title={props.selectedModel?.description} value={props.selection?.modelId || ""} onChange={(event) => props.onFamilyChange(event.currentTarget.value)}>
        <For each={props.catalogue.models}>{(model) => <option value={model.id}>{model.label}</option>}</For>
      </Select>
    </SettingLine>
    <Show when={props.selection}>{(selection) => <>
      <SettingLine label="Variant">
        <Select id="voice-local-variant" disabled={disabled()} value={selection().artifactId} onChange={(event) => props.onVariantChange(event.currentTarget.value)}>
          <For each={variantChoices()}>{(artifact) => <option value={artifact.id} title={variantOptionLabel(artifact)}>{variantShortLabel(artifact)}</option>}</For>
        </Select>
      </SettingLine>
      <SettingLine label="Timing">
        <Select id="voice-local-batching" disabled={disabled() || !props.profiles.length} title={selectedProfile() ? profileDescription(selectedProfile()!) : undefined} value={selectedProfile()?.id || ""} onChange={(event) => props.onTimingChange(event.currentTarget.value)}>
          <For each={props.profiles}>{(profile) => <option value={profile.id}>{profileLabel(profile)}</option>}</For>
        </Select>
      </SettingLine>
      <Show when={props.selectedLocalModel && !props.selectedLocalModel!.installed && !props.installingModelId}>
        <SettingLine label={`Accept ${props.selectedLocalModel!.license.id} licence`} title={props.selectedLocalModel!.license.attribution}>
          <Switch label={`Accept ${props.selectedLocalModel!.license.id} licence`} checked={props.licenseAccepted} onChange={props.onLicenseChange} />
        </SettingLine>
      </Show>
      <SettingLine label="Model files" state={filesState().toLowerCase()} title={statusFacts()} plain>
        <Show when={props.installingModelId} fallback={<Show when={props.selectedLocalModel?.installed} fallback={<Button size="sm" disabled={disabled() || !props.licenseAccepted || !props.selectedLocalModel} onClick={props.onInstall}>Install</Button>}><Button variant="ghost" size="sm" disabled={disabled() || !props.selectedLocalModel} onClick={props.onUninstall}>Uninstall</Button></Show>}>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onCancelInstall}>Cancel</Button>
        </Show>
      </SettingLine>
      <Show when={props.installProgress}>{(progress) => <SettingWide><Progress label="Model files" max={Math.max(1, progress().totalBytes)} value={progress().completedBytes} /></SettingWide>}</Show>
      <Show when={props.selectedLocalModel?.error}><Note tone="error">{props.selectedLocalModel!.error}</Note></Show>
    </>}</Show>
  </>;
}
