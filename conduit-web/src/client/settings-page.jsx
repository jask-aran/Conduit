import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsPage({ projectId, loadSettings, saveSettings, onError, onSaved }) {
  const [models, setModels] = useState([]);
  const [enabledModels, setEnabledModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadSettings(projectId)
      .then((payload) => {
        if (!active) return;
        setModels(Array.isArray(payload.models) ? payload.models : []);
        setEnabledModels(Array.isArray(payload.enabledModels) ? payload.enabledModels : []);
      })
      .catch((error) => active && onError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [loadSettings, onError, projectId]);

  const toggleModel = (spec, checked) => {
    setSaved(false);
    setEnabledModels((current) => checked
      ? [...new Set([...current, spec])]
      : current.filter((item) => item !== spec));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const payload = await saveSettings(projectId, enabledModels);
      setModels(Array.isArray(payload.models) ? payload.models : []);
      setEnabledModels(Array.isArray(payload.enabledModels) ? payload.enabledModels : []);
      onSaved(payload);
      setSaved(true);
    } catch (error) {
      onError(error.message);
    } finally {
      setSaving(false);
    }
  };

  return <main className="settings-page">
    <header className="settings-header">
      <h1>Settings</h1>
      <p>Configure the isolated Pi runtime used by Conduit.</p>
    </header>
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>Pi's saved model selection is shared with the terminal and Conduit. The latest save wins.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div> : <FieldSet>
            <FieldLegend variant="label">Scoped models</FieldLegend>
            <FieldGroup data-slot="checkbox-group">
              {models.map((model) => <FieldLabel key={model.spec} htmlFor={`model-${model.spec}`}>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`model-${model.spec}`}
                    checked={enabledModels.includes(model.spec)}
                    onCheckedChange={(checked) => toggleModel(model.spec, checked === true)}
                  />
                  <FieldContent>
                    <FieldTitle>{model.label}</FieldTitle>
                    <FieldDescription>{model.spec}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>)}
              {!models.length && <FieldDescription>No authenticated Pi models are currently available.</FieldDescription>}
            </FieldGroup>
          </FieldSet>}
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-sm text-muted-foreground">{saved ? "Saved" : "Changes apply to new chats."}</span>
          <Button type="submit" disabled={loading || saving || enabledModels.length === 0}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  </main>;
}
