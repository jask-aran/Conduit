import { createSignal, onMount, Show } from "solid-js";
import { ChevronRightIcon } from "lucide-solid";
import { desktopShell, type DesktopShellSettings } from "../platform/installed-client.ts";

const ON_OFF = [{ value: "on", label: "On" }, { value: "off", label: "Off" }];

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
    <label class="settings-row" for={id}><span>{label}</span>
      <select id={id} aria-label={label} disabled={disabled} value={value ? "on" : "off"}
        onChange={(event) => update(change(event.currentTarget.value === "on"))}>
        {ON_OFF.map((option) => <option value={option.value}>{option.label}</option>)}
      </select>
    </label>;

  return <details class="settings-tile" open>
    <summary><span><strong>Desktop</strong><small>What closing the window does, and how Conduit starts.</small></span><ChevronRightIcon class="settings-chevron" aria-hidden="true" /></summary>
    <Show when={settings()} fallback={<div class="settings-rows"><p class="settings-row"><span>Reading the shell's settings…</span></p></div>}>
      {(current) => <div class="settings-rows">
        {row("desktop-tray", "Keep running in tray", current().keepRunningInTray, false,
          (on) => ({ keepRunningInTray: on }))}
        {row("desktop-autostart", "Launch at sign-in", current().launchAtLogin, false,
          (on) => ({ launchAtLogin: on, startHidden: on ? current().startHidden : false }))}
        {/* Starting hidden is only a question for a launch nobody asked for. */}
        {row("desktop-start-hidden", "Start hidden", current().startHidden, !current().launchAtLogin,
          (on) => ({ startHidden: on }))}
        <Show when={error()}><p class="settings-row" role="alert"><span>{error()}</span></p></Show>
      </div>}
    </Show>
  </details>;
}
