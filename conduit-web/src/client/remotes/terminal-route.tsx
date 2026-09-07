import { createResource, Show } from "solid-js";
import type { ComputerLocation } from "../api/contracts";
import { api } from "../api/client";
import { TerminalPane } from "./terminal-pane";
import "./terminal-route.css";

export function TerminalRoute(props: { terminalId?: string; onOpenConduit: () => void }) {
  const [home] = createResource(() => api<ComputerLocation>("/v0/computer"));
  return <main class="terminal-route">
    <Show when={home()} fallback={<div class="terminal-route-loading">Loading terminal…</div>}>
      {(location) => <TerminalPane projectId={location().project.id} projectName="Computer" workingRoot={location().home} terminalId={props.terminalId} autoStart standaloneControls={{ onOpenConduit: props.onOpenConduit }} />}
    </Show>
  </main>;
}
