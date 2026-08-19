import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CheckIcon, ChevronDownIcon, FocusIcon, PlusIcon, SquareIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Spinner,
} from "@/components/primitives";
import { api } from "../api/client";
import { createTerminalRenderer, selectedTerminalRenderer, type TerminalRenderer, type TerminalRendererId } from "./terminal-renderer";

type Pty = {
  id: string;
  projectId: string;
  templateId?: string;
  title?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
};
type ConnectionState = "idle" | "connecting" | "attached" | "disconnected" | "exited";
type ReplayEvent = { type: "resize"; cols: number; rows: number } | { type: "data"; bytes: Uint8Array };

const PTY_REPLAY_PREFIX = "CONDUIT-PTY-REPLAY/1\n";
const replayDecoder = new TextDecoder();

function notifyPtyChange() {
  window.dispatchEvent(new Event("conduit:ptys-changed"));
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeReplayFrame(bytes: Uint8Array): ReplayEvent[] | null {
  const text = replayDecoder.decode(bytes);
  if (!text.startsWith(PTY_REPLAY_PREFIX)) return null;
  const payload = JSON.parse(text.slice(PTY_REPLAY_PREFIX.length));
  if (!Array.isArray(payload)) throw new Error("Terminal replay payload is invalid");
  return payload.map((event) => {
    if (event?.type === "resize") {
      const cols = Math.trunc(Number(event.cols));
      const rows = Math.trunc(Number(event.rows));
      if (cols < 1 || cols > 500 || rows < 1 || rows > 500) throw new Error("Terminal replay resize is invalid");
      return { type: "resize", cols, rows };
    }
    if (event?.type === "data" && typeof event.data === "string") return { type: "data", bytes: base64Bytes(event.data) };
    throw new Error("Terminal replay event is invalid");
  });
}

function sessionTimestamp(record: Pty) {
  if (!record.createdAt) return record.id.slice(0, 8);
  const date = new Date(record.createdAt);
  if (Number.isNaN(date.getTime())) return record.id.slice(0, 8);
  return `${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${record.id.slice(0, 8)}`;
}

export function TerminalPane(props: { projectId: string; active?: boolean }) {
  const [pty, setPty] = createSignal<Pty | null>(null);
  const [sessions, setSessions] = createSignal<Pty[]>([]);
  const [error, setError] = createSignal("");
  const [replayWarning, setReplayWarning] = createSignal("");
  const [starting, setStarting] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [sessionBusy, setSessionBusy] = createSignal("");
  const [connectionState, setConnectionState] = createSignal<ConnectionState>("idle");
  const [writable, setWritable] = createSignal(false);
  const [terminalFocused, setTerminalFocused] = createSignal(false);
  const [rendererId, setRendererId] = createSignal<TerminalRendererId>(selectedTerminalRenderer());
  let host: HTMLDivElement | undefined;
  let terminal: TerminalRenderer | undefined;
  let socket: WebSocket | undefined;
  let disposeConnection: (() => void) | undefined;
  let syncGeometry: (() => void) | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempts = 0;
  let connectionGeneration = 0;
  let mounted = false;
  let activeProjectId = "";
  let ptyChangeListener: (() => void) | undefined;
  const encoder = new TextEncoder();

  const clearReconnect = () => {
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };

  const closeConnection = () => {
    clearReconnect();
    disposeConnection?.();
    disposeConnection = undefined;
    syncGeometry = undefined;
    socket = undefined;
    setWritable(false);
    setTerminalFocused(false);
  };

  const isTerminalTarget = (target: EventTarget | null) => target instanceof Node && Boolean(host?.contains(target));
  const focusActiveTerminal = () => {
    if (!terminal || !writable()) return;
    setTerminalFocused(true);
    terminal.focus();
  };
  const handleTerminalFocusIn = (event: FocusEvent) => {
    if (writable() && isTerminalTarget(event.target)) setTerminalFocused(true);
  };
  const handleTerminalFocusOut = () => {
    queueMicrotask(() => {
      if (!isTerminalTarget(document.activeElement)) setTerminalFocused(false);
    });
  };
  const scopeTerminalKeyboard = (event: KeyboardEvent) => {
    // Let xterm/Ghostty handle the key first, then stop Conduit's window-level
    // shortcuts from turning terminal chords into application commands.
    if (terminalFocused() && isTerminalTarget(event.target)) event.stopPropagation();
  };

  const disposeRenderer = () => {
    terminal?.dispose();
    terminal = undefined;
    if (host) {
      host.replaceChildren();
      host.dataset.terminalReady = "false";
      delete host.dataset.terminalRenderer;
    }
  };

  const resetProject = () => {
    connectionGeneration += 1;
    reconnectAttempts = 0;
    closeConnection();
    disposeRenderer();
    setPty(null);
    setSessions([]);
    setError("");
    setReplayWarning("");
    setConnectionState("idle");
  };

  const ensureRenderer = async (renderer = rendererId(), { fresh = false } = {}) => {
    if (!host) throw new Error("Terminal surface is unavailable");
    if (terminal && terminal.id === renderer && !fresh) return terminal;
    disposeRenderer();
    host.dataset.terminalReady = "false";
    const startedAt = performance.now();
    const created = await createTerminalRenderer(host, renderer);
    if (!host || activeProjectId !== props.projectId) {
      created.dispose();
      throw new Error("Terminal Workspace changed while the renderer was loading");
    }
    terminal = created;
    host.dataset.terminalRenderer = created.id;
    host.dataset.terminalRendererReadyMs = String(Math.round(performance.now() - startedAt));
    created.repaint();
    return created;
  };

  const scheduleReconnect = (record: Pty, renderer: TerminalRendererId, closeCode: number) => {
    if (record.status !== "running" || closeCode === 1013 || reconnectAttempts >= 3 || activeProjectId !== record.projectId) return;
    const delay = 250 * (2 ** reconnectAttempts);
    reconnectAttempts += 1;
    clearReconnect();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void connect(record, renderer, { freshRenderer: true, retrying: true });
    }, delay);
  };

  const connect = async (
    record: Pty,
    renderer = rendererId(),
    { freshRenderer = false, retrying = false }: { freshRenderer?: boolean; retrying?: boolean } = {},
  ) => {
    const generation = ++connectionGeneration;
    closeConnection();
    setError("");
    if (!retrying) reconnectAttempts = 0;
    setConnectionState("connecting");
    const activeTerminal = await ensureRenderer(renderer, { fresh: freshRenderer });
    if (generation !== connectionGeneration || activeProjectId !== record.projectId) return;

    const startedAt = performance.now();
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v0/ptys/${record.id}/attach`;
    const connection = new WebSocket(url);
    socket = connection;
    connection.binaryType = "arraybuffer";
    let replaying = true;
    let replayWork = Promise.resolve();
    let firstOutput = true;
    let intentionallyClosed = false;

    const sendResize = () => {
      if (generation !== connectionGeneration || replaying || !writable() || connection.readyState !== WebSocket.OPEN) return;
      activeTerminal.repaint();
      connection.send(JSON.stringify({ type: "resize", cols: activeTerminal.cols(), rows: activeTerminal.rows() }));
    };
    syncGeometry = sendResize;

    const finishReplay = () => {
      if (generation !== connectionGeneration) return;
      replaying = false;
      activeTerminal.repaint();
      if (host) host.dataset.terminalReady = "true";
      setConnectionState("attached");
      sendResize();
      focusActiveTerminal();
    };

    connection.onmessage = (event) => {
      if (generation !== connectionGeneration) return;
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "replay_start") {
            replaying = true;
            replayWork = Promise.resolve();
            setReplayWarning(message.complete === false
              ? "Canonical terminal state was unavailable and the bounded fallback journal was incomplete. Live output is attached without replaying an unsafe ANSI tail."
              : "");
            return;
          }
          if (message.type === "replay_resize") {
            if (replaying) replayWork = replayWork.then(() => { activeTerminal.resize(message.cols, message.rows); });
            return;
          }
          if (message.type === "replay_end") {
            void replayWork.then(finishReplay).catch((cause) => {
              setError((cause as Error).message || "Terminal state restoration failed");
              finishReplay();
            });
            return;
          }
          if (message.type === "control") {
            setWritable(message.writable === true);
            if (message.writable !== true) setTerminalFocused(false);
            if (message.writable === true) {
              setConnectionState("attached");
              sendResize();
              focusActiveTerminal();
            }
            return;
          }
          if (message.type === "status") {
            const status = message.status || ((message.exitCode != null || message.signal) ? "exited" : record.status);
            const next = { ...record, status, exitCode: message.exitCode ?? null, signal: message.signal ?? null };
            setPty(next);
            notifyPtyChange();
            if (status === "exited") {
              setWritable(false);
              setTerminalFocused(false);
              setConnectionState("exited");
              intentionallyClosed = true;
              connection.close(1000, "Terminal exited");
            }
            return;
          }
          if (message.type === "client_error") {
            setError(message.message || "Terminal control failed");
            return;
          }
        } catch {
          // Ignore malformed PTY control frames; binary terminal bytes are never
          // routed through this parser.
        }
        return;
      }

      const bytes = new Uint8Array(event.data);
      if (firstOutput) {
        firstOutput = false;
        if (host) host.dataset.terminalFirstByteMs = String(Math.round(performance.now() - startedAt));
      }
      if (replaying) {
        let replayEvents: ReplayEvent[] | null = null;
        try { replayEvents = decodeReplayFrame(bytes); }
        catch (cause) {
          setError((cause as Error).message || "Terminal state could not be decoded");
          return;
        }
        if (replayEvents) {
          replayWork = replayWork.then(async () => {
            for (const replayEvent of replayEvents) {
              if (generation !== connectionGeneration) return;
              if (replayEvent.type === "resize") activeTerminal.resize(replayEvent.cols, replayEvent.rows);
              else await activeTerminal.write(replayEvent.bytes);
            }
          });
        } else {
          replayWork = replayWork.then(() => activeTerminal.write(bytes));
        }
        return;
      }
      void activeTerminal.write(bytes);
    };

    connection.onopen = () => {
      if (generation !== connectionGeneration) {
        intentionallyClosed = true;
        return connection.close();
      }
      // State restoration owns the initial geometry; do not race it with a
      // guessed client resize before replay_end.
      activeTerminal.focus();
    };

    const removeData = activeTerminal.onData((data) => {
      // onData includes keyboard/paste bytes and emulator-generated replies.
      // Preserve it verbatim; replay/controller phases decide when forwarding
      // to the server-owned PTY is safe.
      if (!replaying && writable() && data && generation === connectionGeneration && connection.readyState === WebSocket.OPEN) {
        connection.send(encoder.encode(data));
      }
    });
    const removeResize = activeTerminal.onResize(() => sendResize());

    connection.onerror = () => {
      if (generation === connectionGeneration && connectionState() !== "exited") setError("Terminal connection failed");
    };
    connection.onclose = (event) => {
      if (generation !== connectionGeneration || intentionallyClosed) return;
      setWritable(false);
      setTerminalFocused(false);
      if (pty()?.status === "exited") {
        setConnectionState("exited");
        return;
      }
      setConnectionState("disconnected");
      const reason = event.code === 1013
        ? "Terminal connection was closed because this browser could not keep up with output."
        : "Terminal connection was interrupted.";
      setError(reason);
      scheduleReconnect({ ...record, status: "running" }, renderer, event.code);
    };

    disposeConnection = () => {
      intentionallyClosed = true;
      removeData();
      removeResize();
      connection.onopen = null;
      connection.onmessage = null;
      connection.onerror = null;
      connection.onclose = null;
      if (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING) connection.close();
      if (socket === connection) socket = undefined;
    };
  };

  const refreshSessions = async (projectId = activeProjectId) => {
    const { ptys = [] } = await api<{ ptys: Pty[] }>(`/v0/ptys?projectId=${encodeURIComponent(projectId)}`);
    const running = ptys.filter((item) => item.projectId === projectId && item.status === "running");
    if (projectId === activeProjectId) setSessions(running);
    return running;
  };

  const attachExisting = async (projectId = props.projectId) => {
    if (pty() || projectId !== activeProjectId) return;
    setStarting(true);
    setError("");
    try {
      const running = await refreshSessions(projectId);
      if (projectId !== activeProjectId || pty()) return;
      const record = running[0];
      if (!record) return;
      setPty(record);
      notifyPtyChange();
      await connect(record);
    } catch (cause) {
      if (projectId === activeProjectId) setError((cause as Error).message);
    } finally {
      if (projectId === activeProjectId) setStarting(false);
    }
  };

  const attachSession = async (record: Pty) => {
    if (record.projectId !== activeProjectId || record.status !== "running") return;
    if (pty()?.id === record.id) {
      focusActiveTerminal();
      return;
    }
    setPty(record);
    setReplayWarning("");
    notifyPtyChange();
    try { await connect(record, rendererId(), { freshRenderer: true }); }
    catch (cause) { setError((cause as Error).message); }
  };

  const start = async () => {
    if (starting()) return;
    const projectId = activeProjectId;
    setStarting(true);
    setError("");
    setReplayWarning("");
    try {
      const activeTerminal = await ensureRenderer(rendererId());
      activeTerminal.repaint();
      if (projectId !== activeProjectId) return;
      const record = await api<Pty>("/v0/ptys", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          cols: activeTerminal.cols(),
          rows: activeTerminal.rows(),
        }),
      });
      if (projectId !== activeProjectId) return;
      setPty(record);
      notifyPtyChange();
      await refreshSessions(projectId);
      await connect(record, rendererId(), { freshRenderer: true });
    } catch (cause) {
      if (projectId === activeProjectId) setError((cause as Error).message);
    } finally {
      if (projectId === activeProjectId) setStarting(false);
    }
  };

  const reconnect = async () => {
    const record = pty();
    if (!record || record.status !== "running") return;
    reconnectAttempts = 0;
    await connect(record, rendererId(), { freshRenderer: true });
  };

  const removeSession = async (record: Pty) => {
    if (sessionBusy() || record.projectId !== activeProjectId) return;
    const projectId = activeProjectId;
    const id = record.id;
    const current = pty()?.id === id;
    setSessionBusy(id);
    setError("");
    if (current) {
      connectionGeneration += 1;
      closeConnection();
    }
    try {
      await api(`/v0/ptys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (projectId !== activeProjectId) return;
      if (current && pty()?.id === id) {
        disposeRenderer();
        setPty(null);
        setReplayWarning("");
        setConnectionState("idle");
      }
      notifyPtyChange();
      await refreshSessions(projectId);
    } catch (cause) {
      if (projectId !== activeProjectId) return;
      if ((cause as { error?: string }).error === "pty_not_found") {
        if (current && pty()?.id === id) {
          disposeRenderer();
          setPty(null);
          setReplayWarning("");
          setConnectionState("idle");
        }
        notifyPtyChange();
        await refreshSessions(projectId);
        return;
      }
      setError((cause as Error).message);
      if (current && pty()?.id === id) {
        try { await connect(record, rendererId(), { freshRenderer: true }); }
        catch (reconnectCause) {
          setError((reconnectCause as Error).message);
          setConnectionState("disconnected");
        }
      }
    } finally {
      if (projectId === activeProjectId && sessionBusy() === id) setSessionBusy("");
    }
  };

  const stop = async () => {
    const record = pty();
    if (!record || stopping()) return;
    setStopping(true);
    try { await removeSession(record); }
    finally { setStopping(false); }
  };

  const restart = async () => {
    connectionGeneration += 1;
    closeConnection();
    disposeRenderer();
    setPty(null);
    setConnectionState("idle");
    setError("");
    setReplayWarning("");
    await start();
  };

  const switchRenderer = async (next: TerminalRendererId) => {
    if (next === rendererId()) return;
    setRendererId(next);
    localStorage.setItem("conduit:terminal-renderer", next);
    const record = pty();
    if (!record || !host) {
      disposeRenderer();
      return;
    }
    try { await connect(record, next, { freshRenderer: true }); }
    catch (cause) { setError((cause as Error).message); }
  };

  const statusLabel = () => {
    if (connectionState() === "connecting") return "Connecting";
    if (connectionState() === "disconnected") return "Disconnected";
    if (connectionState() === "exited") return "Exited";
    if (connectionState() === "attached" && !writable()) return "Read only";
    if (connectionState() === "attached") return "Attached";
    return "Idle";
  };

  onMount(() => {
    mounted = true;
    activeProjectId = props.projectId;
    ptyChangeListener = () => {
      void refreshSessions(activeProjectId).catch(() => {});
    };
    window.addEventListener("conduit:ptys-changed", ptyChangeListener);
    if (props.active !== false) void attachExisting(activeProjectId);
  });

  createEffect(() => {
    const projectId = props.projectId;
    if (!mounted || projectId === activeProjectId) return;
    resetProject();
    activeProjectId = projectId;
    if (props.active !== false) void attachExisting(projectId);
  });

  createEffect(() => {
    const active = props.active !== false;
    if (!mounted || !active) return;
    queueMicrotask(() => {
      terminal?.repaint();
      syncGeometry?.();
      if (!pty() && !starting()) void attachExisting(activeProjectId);
    });
  });

  onCleanup(() => {
    mounted = false;
    if (ptyChangeListener) window.removeEventListener("conduit:ptys-changed", ptyChangeListener);
    connectionGeneration += 1;
    closeConnection();
    disposeRenderer();
  });

  return <section class="terminal-pane" aria-label="Terminal pane" data-terminal-focused={terminalFocused() ? "true" : "false"} onKeyDown={scopeTerminalKeyboard}>
    <header class="terminal-pane-header">
      <div><TerminalIcon /><strong>Terminal</strong><span>{statusLabel()}</span></div>
      <div class="terminal-pane-actions">
        <Menu onOpenChange={(open) => { if (open) void refreshSessions().catch((cause) => setError((cause as Error).message)); }}>
          <MenuTrigger class="terminal-sessions-trigger" aria-label="Active terminal sessions" title="Active terminal sessions">
            <TerminalIcon /><span>{sessions().length}</span><ChevronDownIcon />
          </MenuTrigger>
          <MenuContent class="terminal-sessions-menu">
            <MenuLabel>Active terminals</MenuLabel>
            <Show when={sessions().length > 0} fallback={<div class="terminal-session-empty">No active terminals in this Workspace.</div>}>
              <For each={sessions()}>{(session) => <>
                <MenuItem class="terminal-session-item" onSelect={() => void attachSession(session)}>
                  <CheckIcon class={pty()?.id === session.id ? "terminal-session-check" : "terminal-session-check terminal-session-check-hidden"} />
                  <span class="terminal-session-copy">
                    <strong>{session.title || "Shell"}</strong>
                    <small>{sessionTimestamp(session)}</small>
                  </span>
                </MenuItem>
                <MenuItem
                  class="terminal-session-destroy"
                  variant="destructive"
                  closeOnSelect={false}
                  disabled={sessionBusy() === session.id}
                  onSelect={() => void removeSession(session)}
                >
                  <Trash2Icon /><span>{sessionBusy() === session.id ? "Destroying…" : `Destroy ${session.title || "terminal"}`}</span>
                </MenuItem>
              </>}</For>
            </Show>
            <MenuSeparator />
            <MenuItem disabled={starting()} onSelect={() => void start()}>
              <PlusIcon /><span>{starting() ? "Starting…" : "New terminal"}</span>
            </MenuItem>
          </MenuContent>
        </Menu>
        <Show when={pty()?.status === "running"}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="terminal-focus-action"
            aria-label={terminalFocused() ? "Terminal focused" : "Focus terminal"}
            aria-pressed={terminalFocused()}
            title="Focus terminal to capture keyboard shortcuts"
            disabled={!writable() || connectionState() !== "attached"}
            onClick={focusActiveTerminal}
          >
            <FocusIcon /><span class="terminal-action-label">{terminalFocused() ? "Focused" : "Focus"}</span>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            class="terminal-stop-action"
            aria-label="Stop terminal"
            title="Destroy this terminal process"
            disabled={stopping() || sessionBusy() === pty()?.id}
            onClick={() => void stop()}
          >
            <Show when={stopping()} fallback={<SquareIcon />}><Spinner /></Show>
            <span class="terminal-action-label">{stopping() ? "Stopping…" : "Stop"}</span>
          </Button>
        </Show>
        <select aria-label="Terminal renderer" value={rendererId()} onChange={(event) => void switchRenderer(event.currentTarget.value as TerminalRendererId)}>
          <option value="xterm">xterm</option>
          <option value="ghostty">Ghostty</option>
        </select>
      </div>
    </header>
    <div class="terminal-pane-body">
      <div
        ref={host}
        class="terminal-canvas"
        data-shortcut-exclusive="terminal"
        data-active={pty() ? "true" : "false"}
        data-renderer={rendererId()}
        onClick={() => focusActiveTerminal()}
        onFocusIn={handleTerminalFocusIn}
        onFocusOut={handleTerminalFocusOut}
      />
      <Show when={!pty()}>
        <div class="terminal-pane-empty">
          <TerminalIcon />
          <strong>Start or reattach a terminal</strong>
          <p>Terminal processes stay resident in this Workspace when the browser or pane detaches. Use the sessions menu to reattach or cull them.</p>
          <Button disabled={starting()} onClick={() => void start()}>{starting() ? <Spinner /> : "Start terminal"}</Button>
        </div>
      </Show>
      <Show when={pty() && connectionState() === "disconnected"}>
        <div class="terminal-pane-state"><strong>Terminal disconnected</strong><Button onClick={() => void reconnect()}>Reconnect</Button></div>
      </Show>
      <Show when={pty() && connectionState() === "exited"}>
        <div class="terminal-pane-state"><strong>Terminal exited</strong><Button onClick={() => void restart()}>Start new terminal</Button></div>
      </Show>
      <Show when={replayWarning()}><p class="terminal-pane-warning" role="status">{replayWarning()}</p></Show>
      <Show when={error()}><p class="terminal-pane-error" role="alert">{error()}</p></Show>
    </div>
  </section>;
}
