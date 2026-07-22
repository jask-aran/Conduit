import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Combobox as KCombobox } from "@kobalte/core/combobox";
import * as KDialog from "@kobalte/core/dialog";
import { CheckIcon, SearchIcon } from "lucide-solid";
import { Button, Field, FieldGroup, FieldLabel, Input, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import type { Installation, ModelOption, Project, Template } from "../api/contracts";
import type { ModelSettings } from "../state/model-settings";

const sections = ["general", "models", "profiles", "runtime", "workspaces", "auth"] as const;
type Section = typeof sections[number];
const label = (section: Section) => section[0]!.toUpperCase() + section.slice(1);

interface RuntimeSettings {
  maxLiveProcesses: number;
  maxGeneratingProcesses: number;
  idleProcessTtlMs: number;
  liveCount?: number;
  generatingCount?: number;
}

const sameScope = (left: string[], right: string[]) => [...left].sort().join("\n") === [...right].sort().join("\n");
const sameRuntime = (left: RuntimeSettings | null, right: RuntimeSettings | null) => Boolean(left && right
  && left.maxLiveProcesses === right.maxLiveProcesses
  && left.maxGeneratingProcesses === right.maxGeneratingProcesses
  && left.idleProcessTtlMs === right.idleProcessTtlMs);

export function Settings(props: {
  open: boolean;
  initialSection: Section;
  initialWorkspaceId?: string | null;
  onOpenChange: (open: boolean) => void;
  models: ModelSettings;
  templates: Template[];
  defaultTemplateId: string;
  projects: Project[];
  installations: Installation[];
  onInstallationsChange: (items: Installation[]) => void;
  onDefaultTemplateChange: (id: string) => Promise<unknown>;
  onWorkspaceDefaultChange: (id: string, templateId: string | null) => Promise<Project>;
}) {
  const [section, setSection] = createSignal<Section>(props.initialSection || "models");
  const [scope, setScope] = createSignal<string[]>([]);
  const [scopeEdited, setScopeEdited] = createSignal(false);
  const [runtime, setRuntime] = createSignal<RuntimeSettings | null>(null);
  const [runtimeBaseline, setRuntimeBaseline] = createSignal<RuntimeSettings | null>(null);
  const [runtimeStatus, setRuntimeStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [runtimeError, setRuntimeError] = createSignal("");
  const [runtimeEdited, setRuntimeEdited] = createSignal(false);
  const [runtimeSaving, setRuntimeSaving] = createSignal(false);
  const [detecting, setDetecting] = createSignal(false);
  const [workspaceId, setWorkspaceId] = createSignal<string | null>(null);
  let runtimeRequest = 0;
  let search!: HTMLInputElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  const focusSearch = () => requestAnimationFrame(() => requestAnimationFrame(() => search?.focus()));

  createEffect(on(() => props.open, (open) => {
    if (open && !wasOpen) returnFocus = document.activeElement as HTMLElement | null;
    wasOpen = open;
    if (!open) return;
    const initial = props.initialSection || "models";
    setSection(initial);
    setWorkspaceId(props.initialWorkspaceId || props.projects.find((project) => project.kind === "workspace" || project.origin === "linked" || project.origin === "cloned")?.id || null);
    setScopeEdited(false);
    if (initial === "models") focusSearch();
  }));

  // Remote model settings remain authoritative until the user actually edits.
  createEffect(() => {
    if (!props.open || section() !== "models" || scopeEdited()) return;
    setScope([...props.models.enabledModels()]);
  });

  createEffect(() => {
    if (!props.open || section() !== "models") return;
    props.models.allModels().length;
    const timers = [40, 180].map((delay) => window.setTimeout(() => {
      if (props.open && section() === "models") search?.focus();
    }, delay));
    onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)));
  });

  const loadRuntime = async () => {
    const request = ++runtimeRequest;
    setRuntimeStatus("loading");
    setRuntimeError("");
    try {
      const loaded = await api<RuntimeSettings>("/v0/runtime/settings");
      if (request !== runtimeRequest) return;
      setRuntime(loaded);
      setRuntimeBaseline({ ...loaded });
      setRuntimeEdited(false);
      setRuntimeStatus("ready");
    } catch (error) {
      if (request !== runtimeRequest) return;
      setRuntimeError((error as Error).message);
      setRuntimeStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "runtime") void loadRuntime(); });

  const selectedModels = createMemo(() => props.models.allModels().filter((model) => scope().includes(model.spec)));
  const scopeDirty = createMemo(() => scopeEdited() && !sameScope(scope(), props.models.enabledModels()));
  const modelFilter = (model: ModelOption, input: string) => {
    const words = input.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return words.every((word) => `${model.label} ${model.spec} ${model.provider}`.toLowerCase().includes(word));
  };
  const updateScope = (models: ModelOption[]) => {
    setScope(models.map((model) => model.spec));
    setScopeEdited(true);
  };
  const saveScope = async () => {
    if (await props.models.saveScope(scope())) {
      setScope([...props.models.enabledModels()]);
      setScopeEdited(false);
    }
  };

  const selectedWorkspace = createMemo(() => props.projects.find((project) => project.id === workspaceId()) || null);
  const workspaceDefaultLabel = createMemo(() => {
    const id = selectedWorkspace()?.defaultTemplateId;
    if (id === "host-pi") return "Host Pi";
    return props.templates.find((item) => item.id === id)?.label || `Inherit global (${props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})`;
  });
  const saveWorkspace = async (templateId: string | null) => {
    const workspace = selectedWorkspace();
    if (workspace) await props.onWorkspaceDefaultChange(workspace.id, templateId);
  };

  const redetect = async () => {
    setDetecting(true);
    setRuntimeError("");
    try {
      const host = await api<Installation>("/v0/pi-installations/host/detect", { method: "POST" });
      props.onInstallationsChange(props.installations.some((item) => item.id === "host-pi")
        ? props.installations.map((item) => item.id === "host-pi" ? host : item)
        : [...props.installations, host]);
    } catch (error) { setRuntimeError((error as Error).message); }
    finally { setDetecting(false); }
  };

  const updateRuntime = (next: RuntimeSettings) => { setRuntime(next); setRuntimeEdited(true); setRuntimeError(""); };
  const runtimeDirty = createMemo(() => runtimeEdited() && !sameRuntime(runtime(), runtimeBaseline()));
  const saveRuntime = async () => {
    if (!runtime()) return;
    setRuntimeSaving(true);
    setRuntimeError("");
    try {
      const saved = await api<RuntimeSettings>("/v0/runtime/settings", { method: "PATCH", body: JSON.stringify(runtime()) });
      setRuntime(saved);
      setRuntimeBaseline({ ...saved });
      setRuntimeEdited(false);
    } catch (error) { setRuntimeError((error as Error).message); }
    finally { setRuntimeSaving(false); }
  };

  return <KDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <KDialog.Portal><KDialog.Content data-state={props.open ? "open" : "closed"} class="settings-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}>
      <div class="settings-shell">
        <nav data-slot="tabs-list" role="tablist" aria-orientation="vertical" class="settings-rail">
          <KDialog.Title>Settings</KDialog.Title>
          <For each={sections}>{(item) => <button role="tab" aria-selected={section() === item} onClick={() => { setSection(item); if (item === "models") focusSearch(); }}>{label(item)}</button>}</For>
        </nav>
        <main class="settings-content">
          <header><h2>{label(section())}</h2><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onOpenChange(false)}>×</Button></header>
          <Show when={section() === "general"}><FieldGroup><Field><FieldLabel for="default-profile">Default profile</FieldLabel><select id="default-profile" value={props.defaultTemplateId} onChange={(event) => void props.onDefaultTemplateChange(event.currentTarget.value)}><For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For></select></Field></FieldGroup></Show>
          <Show when={props.open && section() === "models"}>
            <div class="model-scope">
              <Show when={props.models.settingsError()}><div role="alert" class="settings-error"><span>{props.models.settingsError()}</span><Button variant="outline" size="sm" onClick={() => void props.models.reload()}>Retry</Button></div></Show>
              <Show when={!props.models.settingsLoading() || props.models.allModels().length} fallback={<div class="settings-loading"><Spinner /><span>Loading models…</span></div>}>
                <KCombobox<ModelOption>
                  multiple
                  options={props.models.allModels()}
                  value={selectedModels()}
                  onChange={updateScope}
                  optionValue="spec"
                  optionTextValue={(model) => `${model.label} ${model.spec} ${model.provider}`}
                  optionLabel="label"
                  defaultFilter={modelFilter}
                  open
                  closeOnSelection={false}
                  selectionBehavior="toggle"
                  modal={false}
                  itemComponent={(itemProps) => <KCombobox.Item item={itemProps.item} data-slot="combobox-item">
                    <span class="model-check"><KCombobox.ItemIndicator><CheckIcon /></KCombobox.ItemIndicator></span>
                    <span><strong>{itemProps.item.rawValue.label}</strong><small>{itemProps.item.rawValue.spec}</small></span>
                  </KCombobox.Item>}
                >
                  <KCombobox.Control class="model-search"><SearchIcon /><KCombobox.Input ref={search} aria-label="Search available models" onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onOpenChange(false);
                  }} /></KCombobox.Control>
                  <KCombobox.Content class="model-scope-list" data-slot="combobox-list"><KCombobox.Listbox /></KCombobox.Content>
                </KCombobox>
              </Show>
              <div class="settings-actions"><span>{scope().length} enabled</span><Button disabled={!scopeDirty() || !scope().length || props.models.saving()} onClick={() => void saveScope()}>{props.models.saving() ? <Spinner /> : null}Save changes</Button></div>
            </div>
          </Show>
          <Show when={section() === "profiles"}><div class="settings-cards"><For each={props.templates}>{(item) => <article><h3>{item.label}</h3><p>{item.description || item.posture || item.tools?.join(" · ")}</p></article>}</For></div></Show>
          <Show when={section() === "runtime"}>
            <Show when={runtimeStatus() === "ready" && runtime()} fallback={<Show when={runtimeStatus() === "error"} fallback={<div class="settings-loading"><Spinner /><span>Loading runtime settings…</span></div>}><div role="alert" class="settings-error"><span>{runtimeError() || "Runtime settings could not be loaded."}</span><Button variant="outline" size="sm" onClick={() => void loadRuntime()}>Retry</Button></div></Show>}>
              <FieldGroup>
                <Field><FieldLabel for="warm-processes">Max warm Pi processes</FieldLabel><Input id="warm-processes" type="number" value={runtime()!.maxLiveProcesses} onInput={(event) => updateRuntime({ ...runtime()!, maxLiveProcesses: Number(event.currentTarget.value) })} /><small>{runtime()!.liveCount || 0} live now</small></Field>
                <Field><FieldLabel for="generations">Max concurrent generations</FieldLabel><Input id="generations" type="number" value={runtime()!.maxGeneratingProcesses} onInput={(event) => updateRuntime({ ...runtime()!, maxGeneratingProcesses: Number(event.currentTarget.value) })} /><small>{runtime()!.generatingCount || 0} generating</small></Field>
                <Field><FieldLabel for="idle-ttl">Idle process TTL (seconds)</FieldLabel><Input id="idle-ttl" type="number" value={Math.round(runtime()!.idleProcessTtlMs / 1000)} onInput={(event) => updateRuntime({ ...runtime()!, idleProcessTtlMs: Number(event.currentTarget.value) * 1000 })} /></Field>
                <Show when={runtimeError()}><p role="alert" class="settings-inline-error">{runtimeError()}</p></Show>
                <Button disabled={!runtimeDirty() || runtimeSaving()} onClick={() => void saveRuntime()}>{runtimeSaving() ? <Spinner /> : null}Save runtime settings</Button>
              </FieldGroup>
            </Show>
            <div class="installations"><For each={props.installations}>{(item) => <article><h3>{item.label}</h3><p>{item.available ? item.version ? `Pi ${item.version}` : "Available" : item.reason || (item as Installation & { error?: string }).error || "Unavailable"}</p></article>}</For><Button variant="outline" disabled={detecting()} onClick={() => void redetect()}>{detecting() ? <Spinner /> : null}Re-detect Host Pi</Button></div>
          </Show>
          <Show when={section() === "workspaces"}>
            <Show when={selectedWorkspace()} fallback={<p>No workspaces registered.</p>}>
              <div class="workspace-settings-card"><h3>{selectedWorkspace()!.name}</h3><p>{selectedWorkspace()!.path || selectedWorkspace()!.externalPath}</p><p>Override: {workspaceDefaultLabel().startsWith("Inherit") ? "None" : workspaceDefaultLabel()}</p>
                <Field><FieldLabel for="workspace-default-profile">Default profile</FieldLabel><select id="workspace-default-profile" aria-label="Default profile" value={selectedWorkspace()!.defaultTemplateId || ""} onChange={(event) => void saveWorkspace(event.currentTarget.value || null)}>
                  <option value="">Inherit global ({props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})</option>
                  <For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For>
                  <option value="host-pi" disabled={!props.installations.find((item) => item.id === "host-pi")?.available}>Host Pi</option>
                </select></Field>
              </div>
            </Show>
          </Show>
          <Show when={section() === "auth"}><p>Authentication is managed by the Conduit server.</p></Show>
        </main>
      </div>
    </KDialog.Content></KDialog.Portal>
  </KDialog.Root>;
}
