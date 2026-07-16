import { useEffect, useRef, useState } from "react";
import { BotIcon, CircleHelpIcon, LinkIcon, MonitorIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelScopeCombobox } from "./model-picker";

const sections = [
  { id: "models", label: "Models", short: "Models", icon: BotIcon },
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

export function SettingsDialog({ open, onOpenChange, initialSection = "models", modelSettings }) {
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
        <DialogDescription>Configure the isolated Pi runtime used by Conduit.</DialogDescription>
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
          {sections.slice(1).map((item) => <TabsContent key={item.id} value={item.id}><Placeholder title={item.label} /></TabsContent>)}
        </ScrollArea>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
