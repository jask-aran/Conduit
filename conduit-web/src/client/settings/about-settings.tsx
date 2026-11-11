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
 * Server and shell are released separately, so each build that differs has its own line; it is the only way to see
 * that an update took.
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
