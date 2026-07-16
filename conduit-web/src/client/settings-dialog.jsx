import { useEffect, useRef, useState } from "react";
import { BotIcon, CircleHelpIcon, LinkIcon, MonitorIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const sections = [
  { id: "models", label: "Models", short: "Models", icon: BotIcon },
  { id: "general", label: "General", short: "General", icon: Settings2Icon },
  { id: "appearance", label: "Appearance", short: "Display", icon: MonitorIcon },
  { id: "connections", label: "Connections", short: "Links", icon: LinkIcon },
  { id: "about", label: "About", short: "About", icon: CircleHelpIcon },
];

function Placeholder({ title }) {
  return <div className="settings-placeholder"><h2>{title}</h2><p>Not available yet.</p></div>;
}

export function SettingsDialog({ open, onOpenChange, initialSection = "models", modelSettings }) {
  const frame = useRef(null);
  const [section, setSection] = useState(initialSection);
  const [enabled, setEnabled] = useState(modelSettings.enabledModels);
  useEffect(() => { if (open) setSection(initialSection); }, [initialSection, open]);
  useEffect(() => { setEnabled(modelSettings.enabledModels); }, [modelSettings.enabledModels]);
  const toggle = (spec, checked) => setEnabled((current) => checked
    ? [...new Set([...current, spec])]
    : current.filter((item) => item !== spec));

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      ref={frame}
      tabIndex={-1}
      className="settings-dialog"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        frame.current?.focus();
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
            {modelSettings.loading ? <p>Loading models…</p> : <FieldGroup data-slot="checkbox-group">
              {modelSettings.allModels.map((model) => <FieldLabel key={model.spec} htmlFor={`settings-model-${model.spec}`}>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`settings-model-${model.spec}`}
                    checked={enabled.includes(model.spec)}
                    onCheckedChange={(checked) => toggle(model.spec, checked === true)}
                  />
                  <FieldContent><FieldTitle>{model.label}</FieldTitle><FieldDescription>{model.spec}</FieldDescription></FieldContent>
                </Field>
              </FieldLabel>)}
              {!modelSettings.allModels.length && <FieldDescription>No authenticated Pi models are currently available.</FieldDescription>}
            </FieldGroup>}
            <div className="settings-save"><Button
              disabled={modelSettings.loading || modelSettings.saving || enabled.length === 0}
              onClick={() => modelSettings.saveScope(enabled)}
            >{modelSettings.saving ? "Saving…" : "Save changes"}</Button></div>
          </TabsContent>
          {sections.slice(1).map((item) => <TabsContent key={item.id} value={item.id}><Placeholder title={item.label} /></TabsContent>)}
        </ScrollArea>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
