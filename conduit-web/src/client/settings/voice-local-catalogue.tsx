import { For, Show } from "solid-js";
import { Button, Progress, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/menus";
import { SettingLine, SettingValue, SettingWide } from "@/components/ui/overlay";
import type { VoiceLocalModel, VoiceServerSettings } from "../api/contracts";
import { Note } from "@/components/ui/state";

type Local = NonNullable<VoiceServerSettings["local"]>;

export interface VoiceLocalCatalogueProps {
  models: VoiceLocalModel[];
  model: VoiceLocalModel | null;
  engine: Local["engine"] | null;
  busy: boolean;
  installingModelId: string | null;
  installProgress: Local["progress"];
  licenseAccepted: boolean;
  onModelChange: (id: string) => void;
  onLicenseChange: (accepted: boolean) => void;
  onInstall: () => void;
  onCancelInstall: () => void;
  onUninstall: () => void;
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const PHASES: Record<string, string> = { runtime: "downloading Hex", downloading: "downloading", verifying: "checking", loading: "loading", activating: "finishing" };

export default function VoiceLocalCatalogue(props: VoiceLocalCatalogueProps) {
  const disabled = () => props.busy || Boolean(props.installingModelId);
  const installing = () => Boolean(props.model && props.installingModelId === props.model.id);
  const sized = () => props.installProgress && ["runtime", "downloading"].includes(props.installProgress.phase) && props.installProgress.totalBytes > 0 ? props.installProgress : null;
  const filesState = () => {
    if (!installing()) return props.model?.installed ? "installed" : "not installed";
    const phase = PHASES[props.installProgress?.phase || ""] || "starting";
    return sized() ? `${phase} · ${Math.round(100 * sized()!.completedBytes / sized()!.totalBytes)}%` : `${phase}…`;
  };
  return <>
    <SettingLine label="Model" state={props.model ? `${props.model.languages} · ${megabytes(props.model.approximateBytes)}` : undefined} title={props.model?.description}>
      <Select id="voice-local-model" disabled={disabled()} title={props.model?.description} value={props.model?.id || ""} onChange={(event) => props.onModelChange(event.currentTarget.value)}>
        <For each={props.models}>{(model) => <option value={model.id} title={model.description}>{model.label}</option>}</For>
      </Select>
    </SettingLine>
    <Show when={props.model}>{(model) => <>
      <Show when={!model().installed && !props.installingModelId}>
        <SettingLine label={`Accept ${model().license.id} licence`} title={model().license.attribution}>
          <Switch label={`Accept ${model().license.id} licence`} checked={props.licenseAccepted} onChange={props.onLicenseChange} />
        </SettingLine>
      </Show>
      <SettingLine label="Model files" state={filesState()} plain>
        <Show when={installing()} fallback={<Show when={model().installed} fallback={<Button size="sm" disabled={disabled() || !props.licenseAccepted} onClick={props.onInstall}>Install</Button>}><Button variant="ghost" size="sm" disabled={disabled()} onClick={props.onUninstall}>Remove</Button></Show>}>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onCancelInstall}>Cancel</Button>
        </Show>
      </SettingLine>
      <Show when={installing() && sized()}>{(progress) => <SettingWide><Progress label="Model files" max={progress().totalBytes} value={progress().completedBytes} /></SettingWide>}</Show>
      <Show when={model().error}><Note tone="error">{model().error}</Note></Show>
    </>}</Show>
    <Show when={props.engine}>{(engine) => <SettingLine plain label="Engine" state={engine().installed ? undefined : "downloads with the first model"} title="Hex runs on the hub and transcribes a recording when it stops.">
      <SettingValue>{engine().label} {engine().version}</SettingValue>
    </SettingLine>}</Show>
  </>;
}
