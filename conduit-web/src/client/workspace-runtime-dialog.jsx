import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function WorkspaceRuntimeDialog({
  project,
  open,
  onOpenChange,
  runtime,
  onRuntimeChange,
  installations,
  preflight,
  loading,
  trustChoice,
  onTrustChoiceChange,
  onCreate,
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New chat in {project?.name}</DialogTitle>
        <DialogDescription>Choose which Pi installation and configuration this chat will use.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="my-4">
        <Field>
          <FieldLabel htmlFor="workspace-runtime">Runtime</FieldLabel>
          <Select value={runtime} onValueChange={onRuntimeChange}>
            <SelectTrigger id="workspace-runtime" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="conduit_profile">Conduit profile</SelectItem>
              <SelectItem value="native_pi" disabled={!installations.find((item) => item.id === "host-pi")?.available}>
                Native Pi (host setup)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {runtime === "native_pi"
              ? "Uses the host Pi binary, home, authentication, and project resources plus Conduit's attachment bridge."
              : "Uses Conduit's pinned Pi, isolated home, and selected profile."}
          </p>
        </Field>
        {runtime === "native_pi" && loading && <p className="text-muted-foreground text-sm">Inspecting host Pi and project resources…</p>}
        {runtime === "native_pi" && preflight?.error && <p className="text-destructive text-sm">{preflight.error}</p>}
        {runtime === "native_pi" && preflight?.trustRequired && <Field>
          <FieldLabel htmlFor="workspace-native-trust">Project resources</FieldLabel>
          <p className="text-muted-foreground text-sm">
            Found {preflight.resources.join(", ")}. Trusted resources can execute code with the Conduit server user's permissions.
          </p>
          <Select value={trustChoice} onValueChange={onTrustChoiceChange}>
            <SelectTrigger id="workspace-native-trust" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ignore_project_resources">Start without project resources</SelectItem>
              <SelectItem value="trusted_once">Trust once and start</SelectItem>
            </SelectContent>
          </Select>
        </Field>}
      </FieldGroup>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          onClick={onCreate}
          disabled={runtime === "native_pi" && (loading || !preflight?.available)}
        >Create chat</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
