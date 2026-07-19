import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function WorkspaceRuntimeDialog({
  project,
  open,
  onOpenChange,
  launchOption,
  onLaunchOptionChange,
  profiles,
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
        <DialogDescription>Choose the profile this chat will use. Host Pi uses your existing installation and configuration.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="my-4">
        <Field>
          <FieldLabel htmlFor="workspace-profile">Profile</FieldLabel>
          <Select value={launchOption} onValueChange={onLaunchOptionChange}>
            <SelectTrigger id="workspace-profile" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {profiles.map((profile) => <SelectItem key={profile.id} value={`profile:${profile.id}`}>
                  {profile.label || profile.id}
                </SelectItem>)}
                <SelectItem value="host-pi" disabled={!installations.find((item) => item.id === "host-pi")?.available}>
                  Host Pi
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            {launchOption === "host-pi"
              ? "Uses the host Pi binary, home, authentication, and project resources plus Conduit's attachment bridge."
              : profiles.find((profile) => `profile:${profile.id}` === launchOption)?.description
                || "Uses Conduit's pinned Pi and isolated home."}
          </p>
        </Field>
        {launchOption === "host-pi" && loading && <p className="text-muted-foreground text-sm">Inspecting host Pi and project resources…</p>}
        {launchOption === "host-pi" && preflight?.error && <p className="text-destructive text-sm">{preflight.error}</p>}
        {launchOption === "host-pi" && preflight?.trustRequired && <Field>
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
          disabled={launchOption === "host-pi" && (loading || !preflight?.available)}
        >Create chat</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
