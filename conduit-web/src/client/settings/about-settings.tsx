import { createSignal, onMount, Show } from "solid-js";
import { ChevronRightIcon } from "lucide-solid";
import { httpUrl } from "../api/transport.js";
import { authorizedFetch } from "../api/native-auth-client.ts";
import {
  buildLabel, clientBuild, serverBuild, shellVersion, type ServerBuild,
} from "../platform/build-info.ts";
import { installedClientKind, isStandaloneBrowser } from "../platform/installed-client.ts";

const SHELL_LABELS: Record<string, string> = { desktop: "Desktop app", android: "Android app" };

const formatBuiltAt = (value: string) => {
  if (!value) return "";
  const built = new Date(value);
  return Number.isNaN(built.getTime()) ? "" : built.toLocaleString();
};

/**
 * Which Conduit this is. The interface, the server and the shell are released
 * separately, so each is named on its own line rather than collapsed into one
 * version that would be true of none of them.
 *
 * It is also the only way to see that an update took: the shell's version
 * changes, and the interface's commit changes with it.
 *
 * And how it is running, which decides what the app can do -- an installed
 * browser is fixed to the address it was installed from, so its route list is
 * a set of facts rather than a set of choices. That is a property of this
 * client, so it is said here once instead of on top of the route menu.
 */
export function AboutSettingsTile() {
  const [server, setServer] = createSignal<ServerBuild | null | "pending">("pending");
  const [shell, setShell] = createSignal<string | null>(null);

  onMount(() => {
    void serverBuild(() => authorizedFetch(httpUrl("/healthz"))).then(setServer);
    void shellVersion().then(setShell);
  });

  const runningAs = () => SHELL_LABELS[installedClientKind]
    || (isStandaloneBrowser() ? "Installed to the home screen" : "Browser tab");

  const row = (label: string, value: string, detail?: string) =>
    <div class="settings-row"><span>{label}</span>
      <span class="settings-build">{value}{detail ? <small> {detail}</small> : null}</span>
    </div>;

  return <details class="settings-tile">
    <summary><span><strong>About</strong><small>{buildLabel(clientBuild)}</small></span><ChevronRightIcon class="settings-chevron" aria-hidden="true" /></summary>
    <div class="settings-rows">
      {row("Interface", buildLabel(clientBuild), formatBuiltAt(clientBuild.builtAt))}
      {row("Running as", runningAs())}
      <Show when={installedClientKind !== "browser"}>
        {row(SHELL_LABELS[installedClientKind] || "App shell", shell() || "Not reported")}
      </Show>
      <Show when={server() !== "pending"} fallback={row("Server", "Asking…")}>
        {row("Server", (server() as ServerBuild | null)?.release || "Unreachable")}
      </Show>
    </div>
  </details>;
}
