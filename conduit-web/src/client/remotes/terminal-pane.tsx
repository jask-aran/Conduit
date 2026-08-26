import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CheckIcon, ChevronDownIcon, FocusIcon, PlusIcon, SquareIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import {
  Button,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Spinner,
} from "@/components/primitives";
import { api } from "../api/client";
import { terminalSocketUrl } from "../api/transport";
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
const PTY_IN_USE_CLOSE_CODE = 4009;
const PTY_TAKEN_OVER_CLOSE_CODE = 4010;

function notifyPtyChange() {
  window.dispatchEvent(new Event("conduit:ptys-changed"));
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
  const [starting, setStarting] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [sessionBusy, setSessionBusy] = createSignal("");
  const [ownershipConflict, setOwnershipConflict] = createSignal(false);
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
    // Let the terminal renderer handle the key first, then stop Conduit's
    // window-level shortcuts from turning terminal chords into app commands.
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
    return created;
  };

  const scheduleReconnect = (record: Pty, renderer: TerminalRendererId, closeCode: number) => {
    if (
      record.status !== "running"
      || closeCode === PTY_IN_USE_CLOSE_CODE
      || closeCode === PTY_TAKEN_OVER_CLOSE_CODE
      || closeCode === 1012
      || closeCode === 1013
      || reconnectAttempts >= 3
      || activeProjectId !== record.projectId
      || props.active === false
    ) return;
    const delay = 250 * (2 ** reconnectAttempts);
    reconnectAttempts += 1;
    clearReconnect();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void connect(record, renderer, {
        freshRenderer: true,
        retrying: true,
      });
    }, delay);
  };

  const connect = async (
    record: Pty,
    renderer = rendererId(),
    { freshRenderer = false, retrying = false, takeover = false }: { freshRenderer?: boolean; retrying?: boolean; takeover?: boolean } = {},
  ) => {
    const generation = ++connectionGeneration;
    closeConnection();
    setError("");
    setOwnershipConflict(false);
    if (!retrying) reconnectAttempts = 0;
    setConnectionState("connecting");
    const activeTerminal = await ensureRenderer(renderer, { fresh: freshRenderer });
    activeTerminal.fit();
    if (generation !== connectionGeneration || activeProjectId !== record.projectId || props.active === false) {
      if (props.active === false) disposeRenderer();
      return;
    }

    const initialCols = activeTerminal.cols();
    const initialRows = activeTerminal.rows();
    const startedAt = performance.now();
    const url = new URL(await terminalSocketUrl(record.id));
    url.searchParams.set("cols", String(initialCols));
    url.searchParams.set("rows", String(initialRows));
    if (takeover) url.searchParams.set("takeover", "1");
    const connection = new WebSocket(url);
    socket = connection;
    connection.binaryType = "arraybuffer";
    let firstOutput = true;
    let intentionallyClosed = false;
    let lastSentCols = initialCols;
    let lastSentRows = initialRows;

    const sendResize = () => {
      if (generation !== connectionGeneration || !writable() || connection.readyState !== WebSocket.OPEN) return;
      const cols = activeTerminal.cols();
      const rows = activeTerminal.rows();
      if (cols === lastSentCols && rows === lastSentRows) return;
      lastSentCols = cols;
      lastSentRows = rows;
      connection.send(JSON.stringify({ type: "resize", cols, rows }));
    };
    syncGeometry = sendResize;

    connection.onmessage = (event) => {
      if (generation !== connectionGeneration) return;
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "control") {
            setWritable(message.writable === true);
            if (host) host.dataset.terminalReady = "true";
            setConnectionState("attached");
            if (message.writable !== true) setTerminalFocused(false);
            if (message.writable === true) {
              // tmux already owns the current screen. Fit only to the actual
              // browser host, then publish a geometry change if one occurred.
              activeTerminal.fit();
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
            if (message.code === "pty_in_use") {
              setOwnershipConflict(true);
              setWritable(false);
              setTerminalFocused(false);
              setConnectionState("disconnected");
              setError("Terminal is attached in another Conduit client.");
            } else if (message.code === "pty_taken_over") {
              setOwnershipConflict(true);
              setWritable(false);
              setTerminalFocused(false);
              setConnectionState("disconnected");
              setError("Another Conduit client took control of this terminal.");
            } else {
              setError(message.message || "Terminal control failed");
            }
            return;
          }
        } catch {
          // Ignore malformed control frames; terminal output is binary and
          // never enters this parser.
        }
        return;
      }

      const bytes = new Uint8Array(event.data);
      if (firstOutput) {
        firstOutput = false;
        if (host) host.dataset.terminalFirstByteMs = String(Math.round(performance.now() - startedAt));
      }
      // Fresh tmux attachments redraw their current screen themselves. Live and
      // reattach traffic therefore use the same minimal byte path.
      activeTerminal.write(bytes);
    };

    connection.onopen = () => {
      if (generation !== connectionGeneration || props.active === false) {
        intentionallyClosed = true;
        return connection.close();
      }
    };

    const removeData = activeTerminal.onData((data) => {
      // Includes keyboard/paste bytes and emulator-generated terminal replies.
      // During the brief connecting phase the terminal is not user-focusable,
      // but generated protocol replies still need to reach tmux.
      const acceptsTerminalData = writable() || connectionState() === "connecting";
      if (acceptsTerminalData && data && generation === connectionGeneration && connection.readyState === WebSocket.OPEN) {
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
      if (event.code === PTY_IN_USE_CLOSE_CODE || event.code === PTY_TAKEN_OVER_CLOSE_CODE) setOwnershipConflict(true);
      if (pty()?.status === "exited") {
        setConnectionState("exited");
        return;
      }
      setConnectionState("disconnected");
      const reason = event.code === PTY_IN_USE_CLOSE_CODE
        ? "Terminal is attached in another Conduit client."
        : event.code === PTY_TAKEN_OVER_CLOSE_CODE
          ? "Another Conduit client took control of this terminal."
        : event.code === 1013
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
    if (projectId !== activeProjectId || props.active === false) return;
    const selected = pty();
    if (selected?.status === "running") {
      if (!socket) await connect(selected, rendererId(), { freshRenderer: true });
      return;
    }
    if (selected) return;
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
      if (socket && connectionState() === "attached") focusActiveTerminal();
      else {
        try { await connect(record, rendererId(), { freshRenderer: true }); }
        catch (cause) { setError((cause as Error).message); }
      }
      return;
    }
    setPty(record);
    notifyPtyChange();
    try { await connect(record, rendererId(), { freshRenderer: true }); }
    catch (cause) { setError((cause as Error).message); }
  };

  const start = async () => {
    if (starting()) return;
    const projectId = activeProjectId;
    setStarting(true);
    setError("");
    try {
      const activeTerminal = await ensureRenderer(rendererId());
      activeTerminal.fit();
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
    await connect(record, rendererId(), { freshRenderer: true, takeover: ownershipConflict() });
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
          setConnectionState("idle");
        }
        notifyPtyChange();
        await refreshSessions(projectId);
        return;
      }
      setError((cause as Error).message);
      if (current && pty()?.id === id && props.active !== false) {
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
    await start();
  };

  const switchRenderer = async (next: TerminalRendererId) => {
    if (next === rendererId()) return;
    setRendererId(next);
    localStorage.setItem("conduit:terminal-renderer", next);
    const record = pty();
    if (!record || !host || props.active === false) {
      connectionGeneration += 1;
      closeConnection();
      disposeRenderer();
      if (record?.status === "running") setConnectionState("disconnected");
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
    if (!mounted) return;
    if (!active) {
      // The tmux session is durable; the browser attachment is not. Releasing
      // both WebSocket and renderer means an invisible pane consumes no live
      // terminal stream and immediately releases its per-terminal lease.
      connectionGeneration += 1;
      reconnectAttempts = 0;
      closeConnection();
      disposeRenderer();
      if (pty()?.status === "running") setConnectionState("disconnected");
      return;
    }
    queueMicrotask(() => {
      const record = pty();
      if (record?.status === "running") {
        if (!socket && connectionState() !== "connecting") {
          void connect(record, rendererId(), { freshRenderer: true }).catch((cause) => setError((cause as Error).message));
        }
      } else if (!record && !starting()) {
        void attachExisting(activeProjectId);
      }
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
            <MenuGroup>
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
                    disabled={sessionBusy() === session.id}
                    onSelect={() => void removeSession(session)}
                  >
                    <Trash2Icon /><span>{sessionBusy() === session.id ? "Destroying…" : `Destroy ${session.title || "terminal"}`}</span>
                  </MenuItem>
                </>}</For>
              </Show>
            </MenuGroup>
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
        <div class="terminal-pane-state"><strong>{ownershipConflict() ? "Terminal in use" : "Terminal disconnected"}</strong><Button onClick={() => void reconnect()}>{ownershipConflict() ? "Take control" : "Reconnect"}</Button></div>
      </Show>
      <Show when={pty() && connectionState() === "exited"}>
        <div class="terminal-pane-state"><strong>Terminal exited</strong><Button onClick={() => void restart()}>Start new terminal</Button></div>
      </Show>
      <Show when={error()}><p class="terminal-pane-error" role="alert">{error()}</p></Show>
    </div>
  </section>;
}
