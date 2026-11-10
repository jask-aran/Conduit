import { createSignal, onMount, Show } from "solid-js";
import { Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { desktopShell, type DesktopShellSettings } from "../platform/installed-client.ts";
import { Note } from "@/components/ui/state";

/** The shell's settings as it reports them: what it returns is what is displayed, never what was asked for (a
 *  launch-at-login the OS refused must not read as one that took). */
export function createShellSettings() {
  const shell = desktopShell!;
  const [settings, setSettings] = createSignal<DesktopShellSettings | null>(null);
  const [error, setError] = createSignal("");
  onMount(() => { void shell.settings().then(setSettings).catch(() => setError("The desktop shell did not answer.")); });
  const update = (change: Partial<DesktopShellSettings>) => {
    const current = settings();
    if (!current) return;
    setError("");
    void shell.saveSettings({ ...current, ...change }).then(setSettings).catch((cause: Error) => setError(cause.message || "Windows refused the change."));
  };
  return { settings, error, update };
}

/**
 * How the desktop app runs, as lines of the group that draws them (Settings › This device, This app). It renders
 * nothing anywhere else, so the page does not have to know which client it is drawing for.
 */
export function DesktopAppLines() {
  if (!desktopShell) return null;
  const { settings, error, update } = createShellSettings();
  return <Show when={settings()}>{(current) => <>
    <SettingLine label="Keep running in tray">
      <Switch id="desktop-tray" label="Keep running in tray" checked={current().keepRunningInTray} onChange={(on) => update({ keepRunningInTray: on })} />
    </SettingLine>
    <SettingLine label="Launch at sign-in">
      <Switch id="desktop-autostart" label="Launch at sign-in" checked={current().launchAtLogin}
        onChange={(on) => update({ launchAtLogin: on, startHidden: on ? current().startHidden : false })} />
    </SettingLine>
    {/* Starting hidden is only a question for a launch nobody asked for. */}
    <SettingLine label="Start hidden">
      <Switch id="desktop-start-hidden" label="Start hidden" disabled={!current().launchAtLogin} checked={current().startHidden} onChange={(on) => update({ startHidden: on })} />
    </SettingLine>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </>}</Show>;
}
