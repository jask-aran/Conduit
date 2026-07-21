import { useEffect, useRef, useState } from "react";
import { BotIcon, CpuIcon, FolderCogIcon, LayersIcon, LockIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiagnosticsSettings } from "./diagnostics-settings";
import { ModelScopeCombobox } from "./model-picker";

const sections = [
  { id: "profiles", label: "Profiles", short: "Profiles", icon: LayersIcon },
  { id: "workspaces", label: "Workspaces", short: "Workspaces", icon: FolderCogIcon },
  { id: "models", label: "Models", short: "Models", icon: BotIcon },
  { id: "runtime", label: "Runtime", short: "Runtime", icon: CpuIcon },
  { id: "auth", label: "Auth", short: "Auth", icon: LockIcon },
  { id: "diagnostics", label: "Diagnostics", short: "Diagnostics", icon: Settings2Icon },
];

const sectionIds = new Set(sections.map((section) => section.id));

function normalizeSection(section) {
  return sectionIds.has(section) ? section : "profiles";
}

function RuntimeSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [maxLiveProcesses, setMaxLiveProcesses] = useState(12);
  const [maxGeneratingProcesses, setMaxGeneratingProcesses] = useState(2);
  const [idleMinutes, setIdleMinutes] = useState(2);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/v0/runtime/settings")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || body.error || "Could not load runtime settings");
        return body;
      })
      .then((body) => {
        if (!active) return;
        setMaxLiveProcesses(body.maxLiveProcesses ?? 12);
        setMaxGeneratingProcesses(body.maxGeneratingProcesses ?? 2);
        setIdleMinutes(Math.max(1, Math.round((body.idleProcessTtlMs || 120_000) / 60_000)));
        setError("");
      })
      .catch((caught) => {
        if (active) setError(caught.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/v0/runtime/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxLiveProcesses: Number(maxLiveProcesses),
          maxGeneratingProcesses: Number(maxGeneratingProcesses),
          idleProcessTtlMs: Math.max(1, Number(idleMinutes)) * 60_000,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not save runtime settings");
      setMaxLiveProcesses(body.maxLiveProcesses ?? maxLiveProcesses);
      setMaxGeneratingProcesses(body.maxGeneratingProcesses ?? maxGeneratingProcesses);
      setIdleMinutes(Math.max(1, Math.round((body.idleProcessTtlMs || 120_000) / 60_000)));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }


  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading runtime settings…</div>;

  return <>
    <div className="settings-section-heading">
      <h2>Runtime</h2>
      <p>Configure the shared process policy for Isolated Pi and Host Pi.</p>
    </div>
    <FieldGroup>
      <Field>
        <FieldLabel>Max warm Pi processes</FieldLabel>
        <Input
          type="number"
          min={1}
          max={32}
          value={maxLiveProcesses}
          onChange={(event) => setMaxLiveProcesses(event.target.value)}
        />
        <FieldDescription>
          Resident agents for open chats. When full, the oldest idle unattached process is stopped. Raising this reduces thrash when switching sessions.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Max concurrent generations</FieldLabel>
        <Input
          type="number"
          min={1}
          max={8}
          value={maxGeneratingProcesses}
          onChange={(event) => setMaxGeneratingProcesses(event.target.value)}
        />
        <FieldDescription>
          Hard limit on agent loops at once. Extra prompts bounce until a generation finishes; warm processes stay attached.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Idle reclaim (minutes)</FieldLabel>
        <Input
          type="number"
          min={1}
          max={60}
          value={idleMinutes}
          onChange={(event) => setIdleMinutes(event.target.value)}
        />
        <FieldDescription>
          After this long with no browser attached and no generation, Conduit stops that Pi process. The chat transcript stays on disk.
        </FieldDescription>
      </Field>
    </FieldGroup>
    {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
    <div className="settings-save">
      <Button disabled={saving} onClick={save}>
        {saving && <Spinner data-icon="inline-start" />}
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  </>;
}

function ProfileSettings({
  templates = [],
  defaultTemplateId = "chat",
  onDefaultTemplateChange,
  onOpenRuntimeChat,
}) {
  const [selected, setSelected] = useState(defaultTemplateId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSelected(defaultTemplateId);
  }, [defaultTemplateId]);

  const selectableTemplates = templates.filter((item) => item.defaultable !== false);
  const runtimeProfile = templates.find((item) => item.special === true && item.id === "runtime") || null;
  const active = selectableTemplates.find((item) => item.id === selected) || selectableTemplates[0] || null;

  async function save() {
    if (!selected || !onDefaultTemplateChange) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onDefaultTemplateChange(selected);
      setNotice("Default profile saved. New chats use it.");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  if (!selectableTemplates.length && !runtimeProfile) {
    return <Empty>
      <EmptyHeader>
        <EmptyTitle>No profiles found</EmptyTitle>
        <EmptyDescription>Add a directory under templates/ with a template.json manifest.</EmptyDescription>
      </EmptyHeader>
    </Empty>;
  }

  return <>
    <div className="settings-section-heading">
      <h2>Profiles</h2>
      <p>Profiles are repository launch presets for Pi. Each chat stores the profile it started with and reuses it on resume.</p>
    </div>
    <FieldGroup>
      <Field>
        <FieldLabel>Default profile for new chats</FieldLabel>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-full max-w-md">
            <SelectValue placeholder="Choose a profile" />
          </SelectTrigger>
          <SelectContent>
            {selectableTemplates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.label || template.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Command palette and New chat use this default. Workspaces inherit it unless their Workspaces setting overrides it.
        </FieldDescription>
      </Field>
      {active && <Field>
        <FieldLabel className="justify-between">
          {active.label || active.id}
          <Badge variant="secondary">v{active.version}</Badge>
        </FieldLabel>
        <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
          {active.description && <p className="text-muted-foreground">{active.description}</p>}
          <p><span className="text-muted-foreground">Posture · </span>{active.posture || active.tools?.join(" / ") || "—"}</p>
          <p><span className="text-muted-foreground">Tools · </span>{(active.tools || []).join(", ") || "none"}</p>
          <p>
            <span className="text-muted-foreground">Resources · </span>
            {active.extensionCount || 0} extensions, {active.skillCount || 0} skills, {active.promptTemplateCount || 0} prompt templates
          </p>
        </div>
        <FieldDescription>
          Manifests live under templates/&lt;id&gt;/. Open a Runtime chat to install Pi packages and wire them into a profile with ordinary agent tools.
        </FieldDescription>
      </Field>}
      {runtimeProfile && <Field>
        <FieldLabel className="justify-between">
          Runtime management
          <Badge variant="outline">Special profile</Badge>
        </FieldLabel>
        <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
          <p className="font-medium">{runtimeProfile.label || "Runtime"}</p>
          {runtimeProfile.description && <p className="text-muted-foreground">{runtimeProfile.description}</p>}
          <p><span className="text-muted-foreground">Posture · </span>{runtimeProfile.posture || runtimeProfile.tools?.join(" / ") || "—"}</p>
          <p className="text-muted-foreground">This profile is not available as a default or ordinary chat profile. It creates a fresh one-off management chat for Conduit runtime work.</p>
        </div>
        {onOpenRuntimeChat && <Button type="button" variant="outline" onClick={onOpenRuntimeChat}>
          Open runtime chat
        </Button>}
      </Field>}
    </FieldGroup>
    {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
    {notice && <p className="text-muted-foreground mt-3 text-sm">{notice}</p>}
    <div className="settings-save flex flex-wrap gap-2">
      <Button disabled={saving || selected === defaultTemplateId} onClick={save}>
        {saving && <Spinner data-icon="inline-start" />}
        {saving ? "Saving…" : "Save default"}
      </Button>
    </div>
  </>;
}

function WorkspaceSettings({
  projects = [],
  templates = [],
  defaultTemplateId = "chat",
  initialWorkspaceId = null,
  installations = [],
  onWorkspaceDefaultChange,
}) {
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const workspaces = projects.filter((project) => ["linked", "cloned"].includes(project.origin));
  const profiles = templates.filter((template) => template.defaultable !== false && template.special !== true);
  const globalProfile = profiles.find((template) => template.id === defaultTemplateId) || profiles[0];
  const hostAvailable = installations.find((installation) => installation.id === "host-pi")?.available === true;

  useEffect(() => {
    if (!initialWorkspaceId) return;
    requestAnimationFrame(() => document.getElementById(`workspace-setting-${initialWorkspaceId}`)?.scrollIntoView({ block: "nearest" }));
  }, [initialWorkspaceId]);

  async function changeDefault(project, value) {
    setSavingId(project.id);
    setError("");
    try {
      await onWorkspaceDefaultChange?.(project.id, value === "inherit" ? null : value);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSavingId(null);
    }
  }

  return <>
    <div className="settings-section-heading">
      <h2>Workspaces</h2>
      <p>Workspace chats inherit the global profile unless that Workspace has an explicit override.</p>
    </div>
    {workspaces.length === 0 ? <Empty>
      <EmptyHeader><EmptyTitle>No Workspaces</EmptyTitle><EmptyDescription>Link or clone a Workspace to configure its default profile.</EmptyDescription></EmptyHeader>
    </Empty> : <div className="flex flex-col gap-3">
      {workspaces.map((project) => {
        const selected = project.defaultTemplateId || "inherit";
        const selectedProfile = project.defaultTemplateId === "host-pi"
          ? { label: "Host Pi" }
          : profiles.find((template) => template.id === project.defaultTemplateId);
        return <Card key={project.id} id={`workspace-setting-${project.id}`} size="sm">
          <CardHeader>
            <CardTitle>{project.name}</CardTitle>
            <CardDescription className="break-all">{project.path || project.externalPath}</CardDescription>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={`workspace-profile-${project.id}`}>Default profile</FieldLabel>
              <Select value={selected} disabled={savingId === project.id} onValueChange={(value) => changeDefault(project, value)}>
                <SelectTrigger id={`workspace-profile-${project.id}`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="inherit">Inherit global ({globalProfile?.label || "default profile"})</SelectItem>
                    {profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.label || profile.id}</SelectItem>)}
                    <SelectItem value="host-pi" disabled={!hostAvailable}>Host Pi{hostAvailable ? "" : " (unavailable)"}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Applies to new chats only. Existing chats keep their selected profile.</FieldDescription>
            </Field>
          </CardContent>
          <CardFooter>
            <Badge variant="secondary">{selectedProfile ? `Override: ${selectedProfile.label}` : `Inherits ${globalProfile?.label || "global"}`}</Badge>
          </CardFooter>
        </Card>;
      })}
    </div>}
    {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
  </>;
}

function AuthSettings() {
  const [loading, setLoading] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetting, setResetting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/v0/auth/status");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not load auth status");
      setHasPassword(Boolean(body.hasPassword));
      setSessionCount(Number(body.sessionCount) || 0);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function resetOthers() {
    setResetting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/v0/auth/reset-sessions", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not sign out other devices");
      setNotice("Other devices have been signed out.");
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading auth status…</div>;

  return <>
    <div className="settings-section-heading">
      <h2>Auth</h2>
      <p>Single-user password login gates every API route, static asset, and WebSocket. Tailscale or a tunnel keeps the address quiet; the password is the lock on the door.</p>
    </div>
    <FieldGroup>
      <Field>
        <FieldLabel className="justify-between">
          Login password
          <Badge variant={hasPassword ? "secondary" : "outline"}>{hasPassword ? "Configured" : "Not configured"}</Badge>
        </FieldLabel>
        <FieldDescription>
          {hasPassword
            ? "Password is set. Use the CLI to change it; Conduit does not store or expose the password in the browser."
            : "No password is configured. The server is open until one is set on the host."}
        </FieldDescription>
        <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
          <p className="text-muted-foreground">From the repo root on the host:</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">node scripts/conduit-auth.mjs set-password</pre>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">node scripts/conduit-auth.mjs reset-sessions</pre>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">node scripts/conduit-auth.mjs status</pre>
        </div>
      </Field>
      <Field>
        <FieldLabel className="justify-between">
          Active sessions
          <Badge variant="secondary">{sessionCount} active</Badge>
        </FieldLabel>
        <FieldDescription>Each signed-in browser is one session row in <code>data/auth.json</code>, capped at 20 and rolled for 30 days.</FieldDescription>
        <Button type="button" variant="outline" disabled={!hasPassword || resetting || sessionCount <= 1} onClick={resetOthers}>
          {resetting && <Spinner data-icon="inline-start" />}
          {resetting ? "Signing out…" : "Sign out other devices"}
        </Button>
      </Field>
    </FieldGroup>
    {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
    {notice && <p className="text-muted-foreground mt-3 text-sm">{notice}</p>}
  </>;
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection = "models",
  modelSettings,
  templates = [],
  defaultTemplateId = "chat",
  onDefaultTemplateChange,
  onOpenRuntimeChat,
  installations = [],
  onInstallationsChange,
  projects = [],
  initialWorkspaceId = null,
  onWorkspaceDefaultChange,
  onHostUnavailable,
}) {
  const [section, setSection] = useState(() => normalizeSection(initialSection));
  const [enabled, setEnabled] = useState(modelSettings.enabledModels);
  const [scopeOpen, setScopeOpen] = useState(false);
  const dialogRef = useRef(null);
  const modelSearchRef = useRef(null);
  useEffect(() => { if (open) setSection(normalizeSection(initialSection)); }, [initialSection, open]);
  useEffect(() => { setEnabled(modelSettings.enabledModels); }, [modelSettings.enabledModels]);
  useEffect(() => { setScopeOpen(open && section === "models" && !modelSettings.loading); }, [modelSettings.loading, open, section]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className="settings-dialog"
      ref={dialogRef}
      onOpenAutoFocus={(event) => {
        if (section !== "models" || modelSettings.loading) return;
        event.preventDefault();
        setTimeout(() => modelSearchRef.current?.focus(), 0);
      }}
    >
      <DialogHeader className="settings-dialog-header">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Configure profiles, Workspaces, models, runtime policy, and authentication; inspect diagnostics.</DialogDescription>
      </DialogHeader>
      <Tabs value={section} onValueChange={setSection} orientation="vertical" activationMode="manual" className="settings-tabs">
        <TabsList variant="line" aria-label="Settings sections" className="settings-rail">
          {sections.map(({ id, label, short, icon: Icon }) => <Tooltip key={id}>
            <TooltipTrigger asChild>
              <TabsTrigger value={id}><Icon /><span className="settings-label-long">{label}</span><span className="settings-label-short">{short}</span></TabsTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>)}
        </TabsList>
        <ScrollArea className="settings-panel">
          <TabsContent value="profiles">
            <ProfileSettings
              templates={templates}
              defaultTemplateId={defaultTemplateId}
              onDefaultTemplateChange={onDefaultTemplateChange}
              onOpenRuntimeChat={onOpenRuntimeChat}
            />
          </TabsContent>
          <TabsContent value="workspaces">
            <WorkspaceSettings
              projects={projects}
              templates={templates}
              defaultTemplateId={defaultTemplateId}
              initialWorkspaceId={initialWorkspaceId}
              installations={installations}
              onWorkspaceDefaultChange={onWorkspaceDefaultChange}
            />
          </TabsContent>
          <TabsContent value="models">
            <div className="settings-section-heading"><h2>Models</h2><p>Choose the models available to ordinary profiles. Isolated Pi and the Conduit terminal launcher share this saved scope; Host Pi remains host-owned.</p></div>
            {modelSettings.loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading models…</div>
              : modelSettings.allModels.length > 0 ? <FieldGroup>
                <Field>
                  <FieldLabel className="justify-between">
                    Enabled models
                    <Badge variant="secondary">{enabled.length} enabled</Badge>
                  </FieldLabel>
                  <ModelScopeCombobox
                    models={modelSettings.allModels}
                    enabled={enabled}
                    onEnabledChange={setEnabled}
                    open={scopeOpen}
                    onOpenChange={setScopeOpen}
                    portalContainer={dialogRef}
                    searchRef={modelSearchRef}
                  />
                  <FieldDescription>Search by label, provider, or full model spec. Selected rows remain checked.</FieldDescription>
                </Field>
              </FieldGroup> : <Empty>
                <EmptyHeader>
                  <EmptyTitle>No models available</EmptyTitle>
                  <EmptyDescription>Authenticate Pi, then reload this settings panel.</EmptyDescription>
                </EmptyHeader>
              </Empty>}
            <div className="settings-save"><Button
              disabled={modelSettings.loading || modelSettings.saving || enabled.length === 0}
              onClick={() => modelSettings.saveScope(enabled)}
            >{modelSettings.saving && <Spinner data-icon="inline-start" />}{modelSettings.saving ? "Saving…" : "Save changes"}</Button></div>
          </TabsContent>
          <TabsContent value="runtime"><RuntimeSettings /></TabsContent>
          <TabsContent value="auth"><AuthSettings /></TabsContent>
          <TabsContent value="diagnostics">
            <DiagnosticsSettings
              onInstallationsChange={onInstallationsChange}
              onHostUnavailable={onHostUnavailable}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
