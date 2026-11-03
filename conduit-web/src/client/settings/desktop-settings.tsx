import { createSignal, onMount, Show } from "solid-js";
import { Segmented, Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { desktopShell, type DesktopShellSettings, type DesktopTitleBar } from "../platform/installed-client.ts";
import { Group } from "@/components/ui/group";
import { Loading, Note } from "@/components/ui/state";

/**
 * The window behaviour the shell owns, shown where every other preference is.
 * It renders nothing anywhere else, so the Appearance section does not have to
 * know which client it is drawing for.
 *
 * What the shell returns is what is displayed, never what was asked for: a
 * launch-at-login the OS refused must not read as one that took.
 */
export function DesktopSettingsTile() {
  if (!desktopShell) return null;
  const shell = desktopShell;
  const [settings, setSettings] = createSignal<DesktopShellSettings | null>(null);
  const [error, setError] = createSignal("");

  onMount(() => { void shell.settings().then(setSettings).catch(() => setError("The desktop shell did not answer.")); });

  const update = (change: Partial<DesktopShellSettings>) => {
    const current = settings();
    if (!current) return;
    setError("");
    void shell.saveSettings({ ...current, ...change })
      .then(setSettings)
      .catch((cause: Error) => setError(cause.message || "Windows refused the change."));
  };

  const row = (id: string, label: string, value: boolean, disabled: boolean, change: (on: boolean) => Partial<DesktopShellSettings>) =>
    <SettingLine label={label}>
      <Switch id={id} label={label} disabled={disabled} checked={value} onChange={(on) => update(change(on))} />
    </SettingLine>;

  return <Group title="Desktop">
    <Show when={settings()} fallback={<Loading>Reading the shell's settings…</Loading>}>
      {(current) => <>
        {row("desktop-tray", "Keep running in tray", current().keepRunningInTray, false,
          (on) => ({ keepRunningInTray: on }))}
        {row("desktop-autostart", "Launch at sign-in", current().launchAtLogin, false,
          (on) => ({ launchAtLogin: on, startHidden: on ? current().startHidden : false }))}
        {/* Starting hidden is only a question for a launch nobody asked for. */}
        {row("desktop-start-hidden", "Start hidden", current().startHidden, !current().launchAtLogin,
          (on) => ({ startHidden: on }))}
        {/* Windows' caption, none (the sidebar's head, the pane headers and the tool rail drag the window, and the rail
            holds its buttons), or Conduit's own bar. */}
        <SettingLine label="Title bar">
          <Segmented label="Title bar" size="sm" value={current().titleBar ?? "conduit"}
            options={[{ value: "native", label: "Windows" }, { value: "none", label: "None" }, { value: "conduit", label: "Conduit" }] satisfies { value: DesktopTitleBar; label: string }[]}
            onChange={(titleBar) => update({ titleBar: titleBar as DesktopTitleBar })} />
        </SettingLine>
        <Show when={error()}><Note tone="error">{error()}</Note></Show>
      </>}
    </Show>
  </Group>;
}
