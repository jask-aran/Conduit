import { createSignal, onMount } from "solid-js";
import { desktopShell, type DesktopShellSettings } from "../platform/installed-client.ts";

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
