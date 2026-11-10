import { createSignal, onMount, Show } from "solid-js";
import { Fact, OverlayFacts } from "@/components/ui/overlay";
import { ServerFacts, shortBuild } from "../platform/server-facts.tsx";
import {
  buildLabel, clientBuild, shellVersion,
} from "../platform/build-info.ts";
import { installedClientKind, isStandaloneBrowser } from "../platform/installed-client.ts";

const SHELL_LABELS: Record<string, string> = { desktop: "Desktop app", android: "Android app" };

const formatBuiltAt = (value: string) => {
  if (!value) return "";
  const built = new Date(value);
  return Number.isNaN(built.getTime()) ? "" : built.toLocaleString();
};

/**
 * Which Conduit this is: the server's block (ServerFacts: its name, how it is reached, its build, and the interface's
 * when that differs), then this client: how it runs and the shell's build. They are released separately, so each
 * build that differs has its own line.
 *
 * It is also the only way to see that an update took: the shell's version
 * changes, and the interface's commit changes with it.
 *
 * And how it is running, which decides what the app can do -- an installed
 * browser is fixed to the address it was installed from, so its route list is
 * a set of facts rather than a set of choices. That is a property of this
 * client, so it is said here once instead of on top of the route menu.
 *
 * Nothing here is a setting, so it is not a section: it sits at the foot of
 * the rail, as the connection does at the foot of the app sidebar.
 */
export function AboutSettingsFooter() {
  const [shell, setShell] = createSignal<string | null>(null);
  onMount(() => void shellVersion().then(setShell));

  const runningAs = () => SHELL_LABELS[installedClientKind]
    || (isStandaloneBrowser() ? "Installed to the home screen" : "Browser tab");
  const built = () => formatBuiltAt(clientBuild.builtAt);

  return <OverlayFacts title="About">
    <ServerFacts interfaceBuild={buildLabel(clientBuild)}>
      <Fact label="Running as" value={runningAs()} title={built() ? `${runningAs()} · interface built ${built()}` : runningAs()} />
      <Show when={installedClientKind !== "browser"}>
        <Fact label="App" value={shell() ? shortBuild(shell()!) : "Not reported"} title={shell() ?? undefined} />
      </Show>
    </ServerFacts>
  </OverlayFacts>;
}
