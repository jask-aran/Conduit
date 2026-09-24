import { createSignal, onMount, Show } from "solid-js";
import { Switch } from "./settings-controls";
import { desktopShell, type DesktopShellSettings } from "../platform/installed-client.ts";

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
    <label class="settings-line" for={id}><span>{label}</span>
      <Switch id={id} label={label} disabled={disabled} checked={value} onChange={(on) => update(change(on))} />
    </label>;

  return <section class="settings-group" aria-label="Desktop">
    <h3>Desktop</h3>
    <Show when={settings()} fallback={<div class="settings-line"><span>Reading the shell's settings…</span></div>}>
      {(current) => <>
        {row("desktop-tray", "Keep running in tray", current().keepRunningInTray, false,
          (on) => ({ keepRunningInTray: on }))}
        {row("desktop-autostart", "Launch at sign-in", current().launchAtLogin, false,
          (on) => ({ launchAtLogin: on, startHidden: on ? current().startHidden : false }))}
        {/* Starting hidden is only a question for a launch nobody asked for. */}
        {row("desktop-start-hidden", "Start hidden", current().startHidden, !current().launchAtLogin,
          (on) => ({ startHidden: on }))}
        <Show when={error()}><p class="settings-line-note" role="alert">{error()}</p></Show>
      </>}
    </Show>
  </section>;
}
