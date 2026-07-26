import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { TerminalIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import { createTerminalRenderer, preloadTerminalRenderer, selectedTerminalRenderer } from "./terminal-renderer";

type Pty = { id: string; status: string };

export function TerminalPane(props: { projectId: string; onClose: () => void }) {
  const [pty, setPty] = createSignal<Pty | null>(null);
  const [error, setError] = createSignal("");
  const [starting, setStarting] = createSignal(false);
  let host: HTMLDivElement | undefined;
  let socket: WebSocket | undefined;
  let dispose: (() => void) | undefined;
  const encoder = new TextEncoder();

  const connect = async (record: Pty) => {
    if (!host) return;
    const startedAt = performance.now();
    const terminal = await createTerminalRenderer(host);
    host.dataset.terminalRenderer = terminal.id;
    host.dataset.terminalRendererReadyMs = String(Math.round(performance.now() - startedAt));
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v0/ptys/${record.id}/attach`;
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let firstOutput = true;
    socket.onmessage = (event) => {
      if (typeof event.data === "string") return;
      if (firstOutput) {
        firstOutput = false;
        host!.dataset.terminalFirstByteMs = String(Math.round(performance.now() - startedAt));
      }
      terminal.write(new Uint8Array(event.data));
    };
    socket.onopen = () => { terminal.fit(); socket?.send(JSON.stringify({ type: "resize", cols: terminal.cols(), rows: terminal.rows() })); terminal.focus(); };
    terminal.onData((data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(encoder.encode(data)); });
    terminal.onResize(({ cols, rows }) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows })); });
    dispose = () => { socket?.close(); terminal.dispose(); };
  };
  const start = async () => {
    setStarting(true); setError("");
    try { const record = await api<Pty>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: props.projectId }) }); setPty(record); await connect(record); }
    catch (cause) { setError((cause as Error).message); }
    finally { setStarting(false); }
  };
  onMount(() => { void preloadTerminalRenderer().catch((cause) => setError((cause as Error).message)); });
  onCleanup(() => dispose?.());
  return <section class="terminal-pane" aria-label="Terminal pane">
    <header class="terminal-pane-header"><div><TerminalIcon /><strong>Terminal</strong><span>Workspace</span></div><Button variant="ghost" size="icon-sm" aria-label="Close terminal pane" onClick={props.onClose}>×</Button></header>
    <Show when={pty()} fallback={<div class="terminal-pane-empty"><TerminalIcon /><strong>Start a Workspace terminal</strong><p>Runs a server-owned shell in this linked Workspace.</p><Button disabled={starting()} onClick={() => void start()}>{starting() ? <Spinner /> : "Start terminal"}</Button><Show when={error()}><p role="alert">{error()}</p></Show></div>}>
      <div ref={host} class="terminal-canvas" data-renderer={selectedTerminalRenderer()} />
    </Show>
  </section>;
}
