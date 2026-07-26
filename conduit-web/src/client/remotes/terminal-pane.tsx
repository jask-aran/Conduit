import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { TerminalIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import { createTerminalRenderer, preloadTerminalRenderer, selectedTerminalRenderer, type TerminalRendererId } from "./terminal-renderer";

type Pty = { id: string; status: string };

export function TerminalPane(props: { projectId: string; onClose: () => void }) {
  const [pty, setPty] = createSignal<Pty | null>(null);
  const [error, setError] = createSignal("");
  const [starting, setStarting] = createSignal(false);
  const [rendererId, setRendererId] = createSignal<TerminalRendererId>(selectedTerminalRenderer());
  let host: HTMLDivElement | undefined;
  let socket: WebSocket | undefined;
  let dispose: (() => void) | undefined;
  const encoder = new TextEncoder();

  const connect = async (record: Pty, renderer = rendererId()) => {
    if (!host) return;
    const startedAt = performance.now();
    const terminal = await createTerminalRenderer(host, renderer);
    host.dataset.terminalRenderer = terminal.id;
    host.dataset.terminalRendererReadyMs = String(Math.round(performance.now() - startedAt));
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v0/ptys/${record.id}/attach`;
    const connection = new WebSocket(url);
    socket = connection;
    connection.binaryType = "arraybuffer";
    let firstOutput = true;
    connection.onmessage = (event) => {
      if (typeof event.data === "string") return;
      if (firstOutput) {
        firstOutput = false;
        host!.dataset.terminalFirstByteMs = String(Math.round(performance.now() - startedAt));
      }
      terminal.write(new Uint8Array(event.data));
    };
    connection.onopen = () => { terminal.fit(); connection.send(JSON.stringify({ type: "resize", cols: terminal.cols(), rows: terminal.rows() })); terminal.focus(); };
    terminal.onData((data) => { if (connection.readyState === WebSocket.OPEN) connection.send(encoder.encode(data)); });
    terminal.onResize(({ cols, rows }) => { if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "resize", cols, rows })); });
    dispose = () => { connection.close(); if (socket === connection) socket = undefined; terminal.dispose(); };
  };
  const start = async () => {
    setStarting(true); setError("");
    try { const record = await api<Pty>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: props.projectId }) }); setPty(record); await connect(record); }
    catch (cause) { setError((cause as Error).message); }
    finally { setStarting(false); }
  };
  const switchRenderer = async (next: TerminalRendererId) => {
    if (next === rendererId()) return;
    setRendererId(next);
    localStorage.setItem("conduit:terminal-renderer", next);
    const record = pty();
    if (!record || !host) return;
    dispose?.();
    dispose = undefined;
    host.replaceChildren();
    try { await connect(record, next); }
    catch (cause) { setError((cause as Error).message); }
  };
  onMount(() => { void preloadTerminalRenderer().catch((cause) => setError((cause as Error).message)); });
  onCleanup(() => dispose?.());
  return <section class="terminal-pane" aria-label="Terminal pane">
    <header class="terminal-pane-header"><div><TerminalIcon /><strong>Terminal</strong><span>Workspace</span></div><div class="terminal-pane-actions"><select aria-label="Terminal renderer" value={rendererId()} onChange={(event) => void switchRenderer(event.currentTarget.value as TerminalRendererId)}><option value="ghostty">Ghostty</option><option value="xterm">xterm</option></select><Button variant="ghost" size="icon-sm" aria-label="Close terminal pane" onClick={props.onClose}>×</Button></div></header>
    <Show when={pty()} fallback={<div class="terminal-pane-empty"><TerminalIcon /><strong>Start a Workspace terminal</strong><p>Runs a server-owned shell in this linked Workspace.</p><Button disabled={starting()} onClick={() => void start()}>{starting() ? <Spinner /> : "Start terminal"}</Button><Show when={error()}><p role="alert">{error()}</p></Show></div>}>
      <div ref={host} class="terminal-canvas" data-renderer={rendererId()} />
    </Show>
  </section>;
}
