import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { MessageSquarePlusIcon, TerminalIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import type { Pty } from "../remotes/terminal-pane";
import "./app-dashboard.css";

export function AppDashboard(props: { onNewChat: () => void; onOpenTerminal: () => void }) {
  const [terminals, setTerminals] = createSignal<Pty[]>([]);
  const [loading, setLoading] = createSignal(true);

  const refresh = async () => {
    try {
      const payload = await api<{ ptys: Pty[] }>("/v0/ptys?projectId=project_chat");
      setTerminals((payload.ptys || []).filter((terminal) => terminal.projectId === "project_chat" && terminal.status === "running"));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    const changed = () => void refresh();
    window.addEventListener("conduit:ptys-changed", changed);
    void refresh();
    onCleanup(() => window.removeEventListener("conduit:ptys-changed", changed));
  });

  return <section class="app-dashboard" aria-labelledby="app-dashboard-title">
    <header class="app-dashboard-heading">
      <span>Conduit</span>
      <h1 id="app-dashboard-title">What do you want to open?</h1>
    </header>
    <div class="app-dashboard-actions">
      <button class="app-dashboard-action" onClick={props.onOpenTerminal}>
        <TerminalIcon />
        <span><strong>Terminal</strong><small>Open a shell in your home directory</small></span>
      </button>
      <button class="app-dashboard-action" onClick={props.onNewChat}>
        <MessageSquarePlusIcon />
        <span><strong>New chat</strong><small>Start a conversation with Pi</small></span>
      </button>
    </div>
    <section class="app-dashboard-terminals" aria-labelledby="home-terminals-title">
      <div class="app-dashboard-section-heading">
        <div><h2 id="home-terminals-title">Home terminals</h2><p>Resident shells in <code>~/</code></p></div>
        <Button variant="outline" size="sm" onClick={props.onOpenTerminal}>Open terminal</Button>
      </div>
      <Show when={!loading()} fallback={<div class="app-dashboard-empty"><Spinner /><span>Loading terminals…</span></div>}>
        <Show when={terminals().length} fallback={<div class="app-dashboard-empty">No resident home terminals.</div>}>
          <div class="app-dashboard-terminal-list">
            <For each={terminals()}>{(terminal) =>
              <button onClick={props.onOpenTerminal}>
                <TerminalIcon />
                <span><strong>{terminal.title || "Shell"}</strong><small>{terminal.currentCommand || "shell"}</small></span>
                <small>Open</small>
              </button>}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  </section>;
}
