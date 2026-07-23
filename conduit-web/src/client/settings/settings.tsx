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

interface PiAuthProvider {
  id: string;
  label: string;
  oauth: boolean;
  usesCallbackServer: boolean;
  auth: { configured: boolean; source: "stored" | "environment" | null };
}

interface PiAuthAttempt {
  id: string;
  providerId: string;
  providerLabel: string;
  state: string;
  message: string;
  authUrl: string | null;
  instructions: string | null;
  deviceCode: { userCode: string; verificationUri: string; expiresInSeconds: number | null } | null;
  prompt: { type: "text" | "manual_code" | "select"; message: string; placeholder?: string; options?: { id: string; label: string }[] } | null;
  error: string | null;
  active: boolean;
  owned: boolean;
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
  const [authProviders, setAuthProviders] = createSignal<PiAuthProvider[]>([]);
  const [authAttempt, setAuthAttempt] = createSignal<PiAuthAttempt | null>(null);
  const [authProviderId, setAuthProviderId] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [authResponse, setAuthResponse] = createSignal("");
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal("");
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

  const loadPiAuth = async () => {
    setAuthLoading(true);
    try {
      const [status, attempt] = await Promise.all([
        api<{ providers: PiAuthProvider[] }>("/v0/pi-auth"),
        api<{ attempt: PiAuthAttempt | null }>("/v0/pi-auth/attempt"),
      ]);
      setAuthProviders(status.providers);
      setAuthAttempt(attempt.attempt);
      if (!authProviderId()) setAuthProviderId(status.providers[0]?.id || "");
      setAuthError("");
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  createEffect(() => {
    if (!props.open || section() !== "auth") return;
    void loadPiAuth();
  });
  createEffect(() => {
    if (!props.open || section() !== "auth" || !authAttempt()?.active) return;
    const timer = window.setInterval(() => {
      api<{ attempt: PiAuthAttempt | null }>("/v0/pi-auth/attempt")
        .then((result) => {
          setAuthAttempt(result.attempt);
          if (!result.attempt?.active) return api<{ providers: PiAuthProvider[] }>("/v0/pi-auth")
            .then((status) => setAuthProviders(status.providers));
        })
        .catch((error) => setAuthError((error as Error).message));
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const startOAuth = async () => {
    if (!authProviderId()) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/oauth", { method: "POST", body: JSON.stringify({ providerId: authProviderId() }) });
      setAuthAttempt(result.attempt);
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const answerAuthPrompt = async (value: string) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/attempt/respond", { method: "POST", body: JSON.stringify({ value }) });
      setAuthAttempt(result.attempt);
      setAuthResponse("");
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const cancelOAuth = async () => {
    try { await api("/v0/pi-auth/attempt/cancel", { method: "POST" }); await loadPiAuth(); }
    catch (error) { setAuthError((error as Error).message); }
  };
  const saveApiKey = async () => {
    if (!authProviderId() || !apiKey()) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      await api("/v0/pi-auth/api-key", { method: "PUT", body: JSON.stringify({ providerId: authProviderId(), key: apiKey() }) });
      setApiKey("");
      await loadPiAuth();
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const removePiAuth = async (providerId: string) => {
    setAuthLoading(true);
    try { await api(`/v0/pi-auth/${encodeURIComponent(providerId)}`, { method: "DELETE" }); await loadPiAuth(); }
    catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };

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
          <Show when={section() === "auth"}>
            <div class="pi-auth-panel">
              <p>Credentials are stored only in the isolated Pi runtime. Host Pi accounts and environment credentials are never exposed or changed here.</p>
              <Show when={authError()}><p role="alert" class="settings-inline-error">{authError()}</p></Show>
              <Show when={authLoading() && !authProviders().length} fallback={<>
                <FieldGroup>
                  <Field><FieldLabel for="pi-auth-provider">Provider</FieldLabel><select id="pi-auth-provider" aria-label="Pi authentication provider" value={authProviderId()} onChange={(event) => setAuthProviderId(event.currentTarget.value)}><For each={authProviders()}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For></select></Field>
                  <Show when={authProviders().find((provider) => provider.id === authProviderId())?.oauth}><Button disabled={authLoading() || Boolean(authAttempt()?.active)} onClick={() => void startOAuth()}>{authLoading() ? <Spinner /> : null}Sign in with browser</Button></Show>
                  <Field><FieldLabel for="pi-api-key">API key</FieldLabel><Input id="pi-api-key" type="password" autocomplete="off" value={apiKey()} onInput={(event) => setApiKey(event.currentTarget.value)} placeholder="Stored in isolated Pi only" /></Field>
                  <Button variant="outline" disabled={authLoading() || !apiKey()} onClick={() => void saveApiKey()}>{authLoading() ? <Spinner /> : null}Save API key</Button>
                </FieldGroup>
                <Show when={authAttempt()?.owned}>
                  <article class="pi-auth-attempt"><h3>{authAttempt()!.providerLabel}</h3><p>{authAttempt()!.message}</p>
                    <Show when={authAttempt()!.authUrl}><a href={authAttempt()!.authUrl!} target="_blank" rel="noreferrer">Open provider sign-in</a><p>{authAttempt()!.instructions}</p></Show>
                    <Show when={authAttempt()!.deviceCode}><p>Code: <code>{authAttempt()!.deviceCode!.userCode}</code></p><a href={authAttempt()!.deviceCode!.verificationUri} target="_blank" rel="noreferrer">Open verification page</a></Show>
                    <Show when={authAttempt()!.prompt?.type === "select"}><p>{authAttempt()!.prompt!.message}</p><div class="pi-auth-options"><For each={authAttempt()!.prompt!.options || []}>{(option) => <Button variant="outline" disabled={authLoading()} onClick={() => void answerAuthPrompt(option.id)}>{option.label}</Button>}</For></div></Show>
                    <Show when={authAttempt()!.prompt && authAttempt()!.prompt!.type !== "select"}><Field><FieldLabel for="pi-auth-response">{authAttempt()!.prompt!.message}</FieldLabel><div class="pi-auth-response"><Input id="pi-auth-response" type="text" autocomplete="off" value={authResponse()} onInput={(event) => setAuthResponse(event.currentTarget.value)} placeholder={authAttempt()!.prompt!.placeholder || ""} onKeyDown={(event) => { if (event.key === "Enter") void answerAuthPrompt(authResponse()); }} /><Button disabled={authLoading()} onClick={() => void answerAuthPrompt(authResponse())}>Continue</Button></div></Field></Show>
                    <Show when={authAttempt()!.error}><p role="alert" class="settings-inline-error">{authAttempt()!.error}</p></Show>
                    <Show when={authAttempt()!.active}><Button variant="ghost" onClick={() => void cancelOAuth()}>Cancel sign-in</Button></Show>
                  </article>
                </Show>
                <div class="settings-cards"><For each={authProviders().filter((provider) => provider.auth.configured || provider.auth.source === "environment")}>{(provider) => <article><h3>{provider.label}</h3><p>{provider.auth.configured ? "Credential stored in isolated Pi" : "Credential available from the server environment"}</p><Show when={provider.auth.configured}><Button variant="outline" size="sm" disabled={authLoading()} onClick={() => void removePiAuth(provider.id)}>Remove credential</Button></Show></article>}</For></div>
              </>}><div class="settings-loading"><Spinner /><span>Loading Pi authentication…</span></div></Show>
            </div>
          </Show>
        </main>
      </div>
    </KDialog.Content></KDialog.Portal>
  </KDialog.Root>;
}
