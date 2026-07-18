import { useEffect, useRef, useState } from "react";
import { BotIcon, CircleHelpIcon, CpuIcon, LayersIcon, LinkIcon, MonitorIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelScopeCombobox } from "./model-picker";

const sections = [
  { id: "models", label: "Models", short: "Models", icon: BotIcon },
  { id: "profiles", label: "Profiles", short: "Profiles", icon: LayersIcon },
  { id: "runtime", label: "Runtime", short: "Runtime", icon: CpuIcon },
  { id: "general", label: "General", short: "General", icon: Settings2Icon },
  { id: "appearance", label: "Appearance", short: "Display", icon: MonitorIcon },
  { id: "connections", label: "Connections", short: "Links", icon: LinkIcon },
  { id: "about", label: "About", short: "About", icon: CircleHelpIcon },
];

function Placeholder({ title }) {
  return <Empty>
    <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>Not available yet.</EmptyDescription></EmptyHeader>
  </Empty>;
}

function RuntimeSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [maxLiveProcesses, setMaxLiveProcesses] = useState(12);
  const [maxGeneratingProcesses, setMaxGeneratingProcesses] = useState(2);
  const [idleMinutes, setIdleMinutes] = useState(2);
  const [liveCount, setLiveCount] = useState(0);
  const [generatingCount, setGeneratingCount] = useState(0);
  const [installations, setInstallations] = useState([]);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetch("/v0/runtime/settings").then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.message || body.error || "Could not load runtime settings");
          return body;
        }),
      fetch("/v0/pi-installations")
        .then(async (response) => response.ok ? response.json() : { installations: [] })
        .catch(() => ({ installations: [] })),
    ])
      .then(([body, catalog]) => {
        if (!active) return;
        setMaxLiveProcesses(body.maxLiveProcesses ?? 12);
        setMaxGeneratingProcesses(body.maxGeneratingProcesses ?? 2);
        setIdleMinutes(Math.max(1, Math.round((body.idleProcessTtlMs || 120_000) / 60_000)));
        setLiveCount(body.liveCount ?? 0);
        setGeneratingCount(body.generatingCount ?? 0);
        setInstallations(catalog.installations || []);
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
      setLiveCount(body.liveCount ?? liveCount);
      setGeneratingCount(body.generatingCount ?? generatingCount);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  async function detectHostPi() {
    setDetecting(true);
    setError("");
    try {
      const response = await fetch("/v0/pi-installations/host/detect", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not detect host Pi");
      setInstallations((current) => [...current.filter((item) => item.id !== body.id), body]);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setDetecting(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading runtime settings…</div>;

  return <>
    <div className="settings-section-heading">
      <h2>Runtime</h2>
      <p>Keep many chats warm; limit how many agent loops run at once. Idle warms reclaim after you leave.</p>
    </div>
    <FieldGroup>
      <Field>
        <FieldLabel>Pi installations</FieldLabel>
        <div className="flex flex-col gap-2">
          {installations.map((installation) => <div key={installation.id} className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              <span className="font-medium">{installation.label}</span>
              <span className="text-muted-foreground"> · {installation.version ? `Pi ${installation.version}` : installation.error || "Unavailable"}</span>
            </span>
            <Badge variant={installation.available ? "secondary" : "outline"}>{installation.available ? "Available" : "Unavailable"}</Badge>
          </div>)}
        </div>
        <FieldDescription>Conduit uses its bundled Pi and isolated home. Workspace chats may explicitly use the host Pi installation and native home.</FieldDescription>
        <Button type="button" variant="outline" disabled={detecting} onClick={detectHostPi}>
          {detecting && <Spinner data-icon="inline-start" />}
          {detecting ? "Detecting…" : "Re-detect host Pi"}
        </Button>
      </Field>
      <Field>
        <FieldLabel className="justify-between">
          Max warm Pi processes
          <Badge variant="secondary">{liveCount} live now</Badge>
        </FieldLabel>
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
        <FieldLabel className="justify-between">
          Max concurrent generations
          <Badge variant="secondary">{generatingCount} generating</Badge>
        </FieldLabel>
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
          Command palette and New chat use this default. Linked and cloned workspaces default to Workspace.
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

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection = "models",
  modelSettings,
  templates = [],
  defaultTemplateId = "chat",
  onDefaultTemplateChange,
  onOpenRuntimeChat,
}) {
  const [section, setSection] = useState(initialSection);
  const [enabled, setEnabled] = useState(modelSettings.enabledModels);
  const [scopeOpen, setScopeOpen] = useState(false);
  const dialogRef = useRef(null);
  const modelSearchRef = useRef(null);
  useEffect(() => { if (open) setSection(initialSection); }, [initialSection, open]);
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
        <DialogDescription>Configure Conduit profiles, Pi installations, models, and process limits.</DialogDescription>
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
          <TabsContent value="models">
            <div className="settings-section-heading"><h2>Models</h2><p>Choose the models available in Conduit. Pi and the terminal share this saved scope.</p></div>
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
          <TabsContent value="profiles">
            <ProfileSettings
              templates={templates}
              defaultTemplateId={defaultTemplateId}
              onDefaultTemplateChange={onDefaultTemplateChange}
              onOpenRuntimeChat={onOpenRuntimeChat}
            />
          </TabsContent>
          <TabsContent value="runtime"><RuntimeSettings /></TabsContent>
          {sections.filter((item) => !["models", "profiles", "runtime"].includes(item.id)).map((item) => (
            <TabsContent key={item.id} value={item.id}><Placeholder title={item.label} /></TabsContent>
          ))}
        </ScrollArea>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
