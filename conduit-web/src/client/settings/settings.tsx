import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { CheckIcon, SearchIcon } from "lucide-solid";
import { Button, Field, FieldGroup, FieldLabel, Input, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import type { Installation, Project, Template } from "../api/contracts";
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
  const [query, setQuery] = createSignal("");
  const [scope, setScope] = createSignal<string[]>([]);
  const [highlighted, setHighlighted] = createSignal(0);
  const [runtime, setRuntime] = createSignal<RuntimeSettings | null>(null);
  const [detecting, setDetecting] = createSignal(false);
  const [workspaceId, setWorkspaceId] = createSignal<string | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = createSignal(false);
  let search!: HTMLInputElement;
  const focusSearch = () => requestAnimationFrame(() => requestAnimationFrame(() => search?.focus()));

  const keydownWindow = (event: KeyboardEvent) => { if (props.open && event.key === "Escape") props.onOpenChange(false); };
  onMount(() => window.addEventListener("keydown", keydownWindow));
  onCleanup(() => window.removeEventListener("keydown", keydownWindow));

  createEffect(on(() => props.open, (open) => {
    if (!open) return;
    const initial = props.initialSection || "models";
    setSection(initial);
    setWorkspaceId(props.initialWorkspaceId || props.projects.find((project) => project.kind === "workspace" || project.origin === "linked" || project.origin === "cloned")?.id || null);
    setScope([...props.models.enabledModels()]);
    setQuery("");
    if (initial === "models") focusSearch();
  }));

  createEffect(() => {
    if (!props.open || section() !== "models") return;
    props.models.allModels().length;
    const timers = [40, 180].map((delay) => window.setTimeout(() => {
      if (props.open && section() === "models") search?.focus();
    }, delay));
    onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)));
  });

  const loadRuntime = async () => {
    try { setRuntime(await api<RuntimeSettings>("/v0/runtime/settings")); } catch { /* surfaced by the app if saved */ }
  };
  createEffect(() => { if (props.open && section() === "runtime") void loadRuntime(); });

  const filtered = createMemo(() => {
    const words = query().toLowerCase().trim().split(/\s+/).filter(Boolean);
    return props.models.allModels().filter((model) => words.every((word) => `${model.label} ${model.spec} ${model.provider}`.toLowerCase().includes(word)));
  });
  createEffect(() => { filtered(); setHighlighted(0); });
  const scopeDirty = createMemo(() => [...scope()].sort().join("\n") !== [...props.models.enabledModels()].sort().join("\n"));
  const toggle = (spec: string) => setScope((current) => current.includes(spec) ? current.filter((item) => item !== spec) : [...current, spec]);
  const modelKeydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((value) => Math.min(value + 1, Math.max(filtered().length - 1, 0))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((value) => Math.max(value - 1, 0)); }
    if (event.key === "Enter") { event.preventDefault(); const item = filtered()[highlighted()]; if (item) toggle(item.spec); }
  };

  const selectedWorkspace = createMemo(() => props.projects.find((project) => project.id === workspaceId()) || null);
  const workspaceDefaultLabel = createMemo(() => {
    const id = selectedWorkspace()?.defaultTemplateId;
    if (id === "host-pi") return "Host Pi";
    return props.templates.find((item) => item.id === id)?.label || `Inherit global (${props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})`;
  });

  const saveWorkspace = async (templateId: string | null) => {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    await props.onWorkspaceDefaultChange(workspace.id, templateId);
    setWorkspaceMenu(false);
  };

  const redetect = async () => {
    setDetecting(true);
    try {
      const host = await api<Installation>("/v0/pi-installations/host/detect", { method: "POST" });
      props.onInstallationsChange(props.installations.some((item) => item.id === "host-pi")
        ? props.installations.map((item) => item.id === "host-pi" ? host : item)
        : [...props.installations, host]);
    } finally { setDetecting(false); }
  };

  const saveRuntime = async () => {
    if (!runtime()) return;
    setRuntime(await api<RuntimeSettings>("/v0/runtime/settings", { method: "PATCH", body: JSON.stringify(runtime()) }));
  };

  return <div role="dialog" aria-modal="true" aria-label="Settings" data-state={props.open ? "open" : "closed"} class="settings-dialog">
    <div class="settings-shell">
      <nav data-slot="tabs-list" role="tablist" aria-orientation="vertical" class="settings-rail">
        <h2>Settings</h2>
        <For each={sections}>{(item) => <button role="tab" aria-selected={section() === item} onClick={() => { setSection(item); if (item === "models") focusSearch(); }}>{label(item)}</button>}</For>
      </nav>
      <main class="settings-content">
        <header><h2>{label(section())}</h2><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onOpenChange(false)}>×</Button></header>
        <Show when={section() === "general"}><FieldGroup><Field><FieldLabel for="default-profile">Default profile</FieldLabel><select id="default-profile" value={props.defaultTemplateId} onChange={(event) => void props.onDefaultTemplateChange(event.currentTarget.value)}><For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For></select></Field></FieldGroup></Show>
        <Show when={section() === "models"}>
          <div class="model-scope"><label class="model-search"><SearchIcon /><input ref={search} role="combobox" aria-label="Search available models" aria-controls="model-scope-list" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={modelKeydown} /></label>
            <div id="model-scope-list" role="listbox" aria-multiselectable="true" data-slot="combobox-list" class="model-scope-list">
              <For each={filtered()}>{(model, index) => <button type="button" role="option" aria-selected={scope().includes(model.spec)} data-slot="combobox-item" data-highlighted={index() === highlighted() ? "" : undefined} onMouseEnter={() => setHighlighted(index())} onClick={() => toggle(model.spec)}>
                <span class="model-check"><Show when={scope().includes(model.spec)}><CheckIcon /></Show></span><span><strong>{model.label}</strong><small>{model.spec}</small></span>
              </button>}</For>
            </div>
            <div class="settings-actions"><span>{scope().length} enabled</span><Button disabled={!scopeDirty() || !scope().length || props.models.saving()} onClick={() => void props.models.saveScope(scope())}>{props.models.saving() ? <Spinner /> : null}Save changes</Button></div>
          </div>
        </Show>
        <Show when={section() === "profiles"}><div class="settings-cards"><For each={props.templates}>{(item) => <article><h3>{item.label}</h3><p>{item.description || item.posture || item.tools?.join(" · ")}</p></article>}</For></div></Show>
        <Show when={section() === "runtime"}>
          <Show when={runtime()} fallback={<Spinner />}><FieldGroup>
            <Field><FieldLabel for="warm-processes">Max warm Pi processes</FieldLabel><Input id="warm-processes" type="number" value={runtime()!.maxLiveProcesses} onInput={(event) => setRuntime({ ...runtime()!, maxLiveProcesses: Number(event.currentTarget.value) })} /><small>{runtime()!.liveCount || 0} live now</small></Field>
            <Field><FieldLabel for="generations">Max concurrent generations</FieldLabel><Input id="generations" type="number" value={runtime()!.maxGeneratingProcesses} onInput={(event) => setRuntime({ ...runtime()!, maxGeneratingProcesses: Number(event.currentTarget.value) })} /><small>{runtime()!.generatingCount || 0} generating</small></Field>
            <Field><FieldLabel for="idle-ttl">Idle process TTL (seconds)</FieldLabel><Input id="idle-ttl" type="number" value={Math.round(runtime()!.idleProcessTtlMs / 1000)} onInput={(event) => setRuntime({ ...runtime()!, idleProcessTtlMs: Number(event.currentTarget.value) * 1000 })} /></Field>
            <Button onClick={() => void saveRuntime()}>Save runtime settings</Button>
          </FieldGroup></Show>
          <div class="installations"><For each={props.installations}>{(item) => <article><h3>{item.label}</h3><p>{item.available ? item.version ? `Pi ${item.version}` : "Available" : item.reason || (item as Installation & { error?: string }).error || "Unavailable"}</p></article>}</For><Button variant="outline" disabled={detecting()} onClick={() => void redetect()}>{detecting() ? <Spinner /> : null}Re-detect Host Pi</Button></div>
        </Show>
        <Show when={section() === "workspaces"}>
          <Show when={selectedWorkspace()} fallback={<p>No workspaces registered.</p>}>
            <div class="workspace-settings-card"><h3>{selectedWorkspace()!.name}</h3><p>{selectedWorkspace()!.path || selectedWorkspace()!.externalPath}</p><p>Override: {workspaceDefaultLabel().startsWith("Inherit") ? "None" : workspaceDefaultLabel()}</p>
              <Field><FieldLabel>Default profile</FieldLabel><button role="combobox" aria-label="Default profile" aria-expanded={workspaceMenu()} onClick={() => setWorkspaceMenu((value) => !value)}>{workspaceDefaultLabel()}</button>
                <Show when={workspaceMenu()}><div role="listbox" class="settings-select-list"><button role="option" aria-selected={!selectedWorkspace()!.defaultTemplateId} onClick={() => void saveWorkspace(null)}>Inherit global ({props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})</button><For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <button role="option" aria-selected={selectedWorkspace()!.defaultTemplateId === item.id} onClick={() => void saveWorkspace(item.id)}>{item.label}</button>}</For><button role="option" aria-selected={selectedWorkspace()!.defaultTemplateId === "host-pi"} disabled={!props.installations.find((item) => item.id === "host-pi")?.available} onClick={() => void saveWorkspace("host-pi")}>Host Pi</button></div></Show>
              </Field>
            </div>
          </Show>
        </Show>
        <Show when={section() === "auth"}><p>Authentication is managed by the Conduit server.</p></Show>
      </main>
    </div>
  </div>;
}
