import { createEffect, createResource, onCleanup, Show } from "solid-js";
import type { ComputerLocation } from "../api/contracts";
import type { Connectivity } from "../state/runtime";
import { api } from "../api/client";
import { TerminalPane } from "./terminal-pane";
import "./terminal-route.css";

// Long enough that a restart is not hammered, short enough that the page is
// back on its own before anyone reaches for reload.
const BOOTSTRAP_RETRY_CEILING_MS = 10_000;

export function TerminalRoute(props: { terminalId?: string; connectivity?: () => Connectivity; onOpenConduit: () => void }) {
  const [home, { refetch }] = createResource(() => api<ComputerLocation>("/v0/computer"));
  let attempts = 0;
  let retryTimer: number | undefined;

  // This route runs without the app shell, so nothing else notices Conduit
  // coming back. The bootstrap request is therefore also the health probe:
  // keep retrying rather than stranding the page until a manual reload.
  createEffect(() => {
    const state = home.state;
    if (state !== "errored") {
      if (state === "ready") attempts = 0;
      return;
    }
    const delay = Math.min(1000 * (2 ** Math.min(attempts, 4)), BOOTSTRAP_RETRY_CEILING_MS);
    attempts += 1;
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => void refetch(), delay);
  });
  onCleanup(() => window.clearTimeout(retryTimer));

  // The runtime stream is the faster signal that Conduit is back; take it
  // rather than sitting out the remaining backoff.
  createEffect(() => {
    if (props.connectivity?.() !== "online" || home.state !== "errored") return;
    window.clearTimeout(retryTimer);
    attempts = 0;
    void refetch();
  });

  return <main class="terminal-route">
    <Show when={home()} fallback={<div class="terminal-route-loading">
      {home.error ? "Waiting for Conduit…" : "Loading terminal…"}
    </div>}>
      {(location) => <TerminalPane projectId={location().project.id} projectName="Computer" workingRoot={location().home} terminalId={props.terminalId} connectivity={props.connectivity} autoStart standaloneControls={{ onOpenConduit: props.onOpenConduit }} />}
    </Show>
  </main>;
}
