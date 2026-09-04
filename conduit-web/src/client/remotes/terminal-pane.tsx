import { createEffect, createSignal, For, Index, on, onCleanup, onMount, Show } from "solid-js";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, FocusIcon, KeyboardIcon, Maximize2Icon, Minimize2Icon, PencilIcon, PlusIcon, Settings2Icon, TerminalIcon, Trash2Icon, UnplugIcon } from "lucide-solid";
import {
  Button,
  Dialog,
  DialogContent,
  Field,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/primitives";
import { api } from "../api/client";
import { terminalSocketUrl } from "../api/transport";
import { createTerminalRenderer, selectedTerminalRenderer, type TerminalRenderer, type TerminalRendererId } from "./terminal-renderer";
import { LEGACY_TERMINAL_SHORTCUTS_STORAGE_KEY, normalizeTerminalShortcuts, readLegacyTerminalShortcuts, type TerminalShortcut } from "./terminal-shortcuts";

export type Pty = {
  id: string;
  projectId: string;
  templateId?: string;
  title?: string;
  cwd?: string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  currentCommand?: string | null;
  lastActivityAt?: string | null;
  paneDead?: boolean;
};
type ConnectionState = "idle" | "connecting" | "attached" | "disconnected" | "exited";
const PTY_IN_USE_CLOSE_CODE = 4009;
const PTY_TAKEN_OVER_CLOSE_CODE = 4010;
const MOBILE_KEYS_STORAGE_KEY = "conduit:terminal-mobile-keys";

function notifyPtyChange() {
  window.dispatchEvent(new Event("conduit:ptys-changed"));
}

function sessionMetadata(record: Pty) {
  const command = record.currentCommand || "shell";
  if (record.paneDead) return `${command} · exited`;
  const activity = new Date(record.lastActivityAt || "");
  if (Number.isNaN(activity.getTime())) return command;
  const seconds = Math.max(0, Math.round((Date.now() - activity.getTime()) / 1000));
  if (seconds < 5) return `${command} · active now`;
  if (seconds < 60) return `${command} · active ${seconds}s ago`;
  if (seconds < 3600) return `${command} · active ${Math.floor(seconds / 60)}m ago`;
  return `${command} · active ${activity.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

type StandaloneTerminalControls = { onOpenConduit: () => void };
type KeyboardLockNavigator = Navigator & { keyboard?: { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void } };

export function TerminalPane(props: { projectId: string; projectName?: string; terminalId?: string; active?: boolean; autoStart?: boolean; focusRequest?: number; standaloneControls?: StandaloneTerminalControls }) {
  const [pty, setPty] = createSignal<Pty | null>(null);
  const [sessions, setSessions] = createSignal<Pty[]>([]);
  const [error, setError] = createSignal("");
  const [starting, setStarting] = createSignal(false);
  const [sessionBusy, setSessionBusy] = createSignal("");
  const [renameSession, setRenameSession] = createSignal<Pty | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [ownershipConflict, setOwnershipConflict] = createSignal(false);
  const [connectionState, setConnectionState] = createSignal<ConnectionState>("idle");
  const [writable, setWritable] = createSignal(false);
  const [terminalFocused, setTerminalFocused] = createSignal(false);
  const [rendererId, setRendererId] = createSignal<TerminalRendererId>(selectedTerminalRenderer());
  const [fullscreen, setFullscreen] = createSignal(false);
  const [coarseInput, setCoarseInput] = createSignal(false);
  const [mobileKeysVisible, setMobileKeysVisible] = createSignal(localStorage.getItem(MOBILE_KEYS_STORAGE_KEY) !== "false");
  const [controlArmed, setControlArmed] = createSignal(false);
  const [altArmed, setAltArmed] = createSignal(false);
  const [shortcuts, setShortcuts] = createSignal<TerminalShortcut[]>([]);
  const [shortcutEditorOpen, setShortcutEditorOpen] = createSignal(false);
  const [shortcutDraft, setShortcutDraft] = createSignal<TerminalShortcut[]>([]);
  const [shortcutSaving, setShortcutSaving] = createSignal(false);
  let host: HTMLDivElement | undefined;
  let pane: HTMLElement | undefined;
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

  const clearMobileModifiers = () => {
    setControlArmed(false);
    setAltArmed(false);
  };
  const applyMobileModifiers = (data: string) => {
    if (!controlArmed() && !altArmed()) return data;
    let result = data;
    if (controlArmed() && data.length === 1) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) result = String.fromCharCode(code & 31);
      else if (data === "?") result = "\x7f";
      else if (data === " ") result = "\0";
    }
    if (altArmed()) result = `\x1b${result}`;
    clearMobileModifiers();
    return result;
  };
  const inputTerminal = (data: string, applyModifiers = true) => {
    if (!terminal || !writable()) return;
    const input = applyModifiers ? applyMobileModifiers(data) : data;
    terminal.input(input);
    queueMicrotask(focusActiveTerminal);
  };
  const inputArrow = (final: "A" | "B" | "C" | "D") => {
    const modifier = 1 + (altArmed() ? 2 : 0) + (controlArmed() ? 4 : 0);
    const sequence = modifier === 1 ? `\x1b[${final}` : `\x1b[1;${modifier}${final}`;
    clearMobileModifiers();
    inputTerminal(sequence, false);
  };
  const pasteFromClipboard = async () => {
    clearMobileModifiers();
    try {
      const text = await navigator.clipboard.readText();
      if (text) inputTerminal(text, false);
    } catch {
      setError("Clipboard access was denied");
    }
  };
  const changeMobileFontSize = (delta: number) => {
    if (!terminal) return;
    const current = Number(localStorage.getItem("conduit:terminal-font-size")) || 13;
    const next = Math.max(8, Math.min(24, current + delta));
    localStorage.setItem("conduit:terminal-font-size", String(next));
    terminal.setFontSize(next);
    syncGeometry?.();
    queueMicrotask(focusActiveTerminal);
  };
  const toggleMobileKeys = () => {
    const visible = !mobileKeysVisible();
    setMobileKeysVisible(visible);
    localStorage.setItem(MOBILE_KEYS_STORAGE_KEY, String(visible));
    if (!visible) clearMobileModifiers();
    queueMicrotask(() => {
      syncGeometry?.();
      focusActiveTerminal();
    });
  };
  const toggleMobileModifier = (modifier: "control" | "alt") => {
    if (modifier === "control") setControlArmed((active) => !active);
    else setAltArmed((active) => !active);
    queueMicrotask(focusActiveTerminal);
  };

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
    if (!terminalFocused() || !isTerminalTarget(event.target)) return;
    event.stopPropagation();
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === pane) {
        await document.exitFullscreen();
        return;
      }
      if (!pane) throw new Error("Terminal surface is unavailable");
      await pane.requestFullscreen();
      const keyboard = (navigator as KeyboardLockNavigator).keyboard;
      if (!keyboard?.lock) throw new Error("This browser does not support terminal key capture");
      await keyboard.lock(["KeyW"]);
      setFullscreen(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const fullscreenChanged = () => {
    const active = document.fullscreenElement === pane;
    setFullscreen(active);
    if (!active) (navigator as KeyboardLockNavigator).keyboard?.unlock?.();
  };
  const zoomTerminal = (event: WheelEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || !terminal) return;
    event.preventDefault();
    event.stopPropagation();
    const current = Number(localStorage.getItem("conduit:terminal-font-size")) || (window.matchMedia("(max-width: 560px)").matches ? 13 : 10.4);
    const next = Math.max(8, Math.min(24, current + (event.deltaY < 0 ? 1 : -1)));
    localStorage.setItem("conduit:terminal-font-size", String(next));
    terminal.setFontSize(next);
    syncGeometry?.();
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
    { freshRenderer = false, retrying = false, takeover = false, initialInput }: { freshRenderer?: boolean; retrying?: boolean; takeover?: boolean; initialInput?: string } = {},
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
    let pendingInitialInput = initialInput;

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
              if (pendingInitialInput) {
                connection.send(encoder.encode(`${pendingInitialInput}\r`));
                pendingInitialInput = undefined;
              }
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
        connection.send(encoder.encode(applyMobileModifiers(data)));
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
    if (projectId === activeProjectId) {
      setSessions(running);
      const selected = running.find((item) => item.id === pty()?.id);
      if (selected) setPty(selected);
    }
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
      const record = running.find((item) => item.id === props.terminalId) || running[0];
      if (!record) {
        if (props.autoStart) queueMicrotask(() => void start());
        return;
      }
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

  const start = async (initialInput?: string, title?: string) => {
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
          ...(title ? { title } : {}),
          cols: activeTerminal.cols(),
          rows: activeTerminal.rows(),
        }),
      });
      if (projectId !== activeProjectId) return;
      setPty(record);
      notifyPtyChange();
      await refreshSessions(projectId);
      await connect(record, rendererId(), { freshRenderer: true, initialInput });
    } catch (cause) {
      if (projectId === activeProjectId) setError((cause as Error).message);
    } finally {
      if (projectId === activeProjectId) setStarting(false);
    }
  };

  const openShortcutEditor = () => {
    setShortcutDraft(shortcuts().map((shortcut) => ({ ...shortcut })));
    setShortcutEditorOpen(true);
  };
  const addShortcutDraft = () => {
    setShortcutDraft((current) => current.length >= 12 ? current : [...current, {
      id: crypto.randomUUID(),
      label: "",
      command: "",
      target: "current",
    }]);
  };
  const updateShortcutDraft = (id: string, patch: Partial<TerminalShortcut>) => {
    setShortcutDraft((current) => current.map((shortcut) => shortcut.id === id ? { ...shortcut, ...patch } : shortcut));
  };
  const moveShortcutDraft = (index: number, delta: -1 | 1) => {
    setShortcutDraft((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const item = current[index];
      const targetItem = current[target];
      if (!item || !targetItem) return current;
      const next = [...current];
      next[index] = targetItem;
      next[target] = item;
      return next;
    });
  };
  const saveShortcutDraft = async () => {
    const next = shortcutDraft()
      .map((shortcut) => ({ ...shortcut, label: shortcut.label.trim(), command: shortcut.command.trim() }))
      .filter((shortcut) => shortcut.label && shortcut.command);
    setShortcutSaving(true);
    setError("");
    try {
      const saved = await api<{ terminalShortcuts?: unknown }>("/v0/preferences", {
        method: "PATCH",
        body: JSON.stringify({ terminalShortcuts: next }),
      });
      setShortcuts(normalizeTerminalShortcuts(saved.terminalShortcuts));
      setShortcutEditorOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setShortcutSaving(false);
    }
  };
  const runShortcut = (shortcut: TerminalShortcut) => {
    setError("");
    if (shortcut.target === "new") {
      void start(shortcut.command, shortcut.label);
      return;
    }
    if (!writable()) {
      setError("Attach to a writable terminal before you run this shortcut");
      return;
    }
    inputTerminal(`${shortcut.command}\r`, false);
  };

  const reconnect = async () => {
    const record = pty();
    if (!record || record.status !== "running") return;
    reconnectAttempts = 0;
    await connect(record, rendererId(), { freshRenderer: true, takeover: true });
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

  const detachSession = (record: Pty) => {
    if (pty()?.id !== record.id) return;
    connectionGeneration += 1;
    reconnectAttempts = 0;
    closeConnection();
    disposeRenderer();
    setOwnershipConflict(false);
    setError("");
    setConnectionState("disconnected");
  };

  const requestRename = (record: Pty) => {
    setRenameSession(record);
    setRenameValue(record.title || "Shell");
  };

  const submitRename = async (event: SubmitEvent) => {
    event.preventDefault();
    const record = renameSession();
    const title = renameValue().trim();
    if (!record || !title || sessionBusy()) return;
    setSessionBusy(record.id);
    try {
      const renamed = await api<Pty>(`/v0/ptys/${encodeURIComponent(record.id)}/rename`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      setSessions((current) => current.map((item) => item.id === renamed.id ? renamed : item));
      if (pty()?.id === renamed.id) setPty(renamed);
      setRenameSession(null);
      notifyPtyChange();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (sessionBusy() === record.id) setSessionBusy("");
    }
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
    if (connectionState() === "attached") return "Active Now";
    return "Idle";
  };

  onMount(() => {
    mounted = true;
    activeProjectId = props.projectId;
    const coarsePointer = matchMedia("(pointer: coarse)");
    const syncCoarseInput = () => setCoarseInput(coarsePointer.matches);
    syncCoarseInput();
    coarsePointer.addEventListener("change", syncCoarseInput);
    onCleanup(() => coarsePointer.removeEventListener("change", syncCoarseInput));
    document.addEventListener("fullscreenchange", fullscreenChanged);
    host?.addEventListener("wheel", zoomTerminal, { capture: true, passive: false });
    ptyChangeListener = () => {
      void refreshSessions(activeProjectId).catch(() => {});
    };
    window.addEventListener("conduit:ptys-changed", ptyChangeListener);
    void api<{ terminalShortcuts?: unknown }>("/v0/preferences")
      .then(async (saved) => {
        const persisted = normalizeTerminalShortcuts(saved.terminalShortcuts);
        const legacy = persisted.length ? [] : readLegacyTerminalShortcuts();
        if (!legacy.length) return setShortcuts(persisted);
        const migrated = await api<{ terminalShortcuts?: unknown }>("/v0/preferences", {
          method: "PATCH",
          body: JSON.stringify({ terminalShortcuts: legacy }),
        });
        setShortcuts(normalizeTerminalShortcuts(migrated.terminalShortcuts));
        localStorage.removeItem(LEGACY_TERMINAL_SHORTCUTS_STORAGE_KEY);
      })
      .catch((cause) => setError((cause as Error).message));
    if (props.active !== false) void attachExisting(activeProjectId);
  });

  createEffect(() => {
    const projectId = props.projectId;
    if (!mounted || projectId === activeProjectId) return;
    resetProject();
    activeProjectId = projectId;
    if (props.active !== false) void attachExisting(projectId);
  });

  createEffect(on(() => props.terminalId, (terminalId) => {
    if (!mounted || !terminalId || props.active === false || pty()?.id === terminalId) return;
    void refreshSessions(activeProjectId)
      .then((running) => {
        const record = running.find((item) => item.id === terminalId);
        if (record) return attachSession(record);
      })
      .catch((cause) => setError((cause as Error).message));
  }));

  createEffect(on(() => props.focusRequest, (request, previous) => {
    if (!mounted || !request || request === previous || props.active === false) return;
    queueMicrotask(focusActiveTerminal);
  }));

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
    document.removeEventListener("fullscreenchange", fullscreenChanged);
    (navigator as KeyboardLockNavigator).keyboard?.unlock?.();
    host?.removeEventListener("wheel", zoomTerminal, { capture: true });
    if (ptyChangeListener) window.removeEventListener("conduit:ptys-changed", ptyChangeListener);
    connectionGeneration += 1;
    closeConnection();
    disposeRenderer();
  });

  return <>
    <Dialog open={Boolean(renameSession())} onOpenChange={(open) => { if (!open) setRenameSession(null); }}>
      <DialogContent title="Rename terminal" description="Choose the label shown in this Workspace terminal list.">
        <form onSubmit={(event) => void submitRename(event)}>
          <Field>
            <FieldLabel for="terminal-rename-title">Name</FieldLabel>
            <Input id="terminal-rename-title" value={renameValue()} maxlength={80} autofocus
              onInput={(event) => setRenameValue(event.currentTarget.value)} />
          </Field>
          <div class="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenameSession(null)}>Cancel</Button>
            <Button type="submit" disabled={!renameValue().trim() || Boolean(sessionBusy())}>Rename</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={shortcutEditorOpen()} onOpenChange={setShortcutEditorOpen}>
      <DialogContent class="terminal-shortcut-dialog" title="Terminal shortcuts" description="Keep useful shell commands one click away on every Conduit client.">
        <div class="terminal-shortcut-editor">
          <Index each={shortcutDraft()}>{(shortcut, index) =>
            <div class="terminal-shortcut-editor-row">
              <div class="terminal-shortcut-editor-copy">
                <Input class="terminal-shortcut-name" aria-label={`Shortcut ${index + 1} name`} placeholder="Shortcut name" maxlength={32} value={shortcut().label}
                  onInput={(event) => updateShortcutDraft(shortcut().id, { label: event.currentTarget.value })} />
                <div class="terminal-shortcut-command">
                  <span aria-hidden="true">$</span>
                  <Input aria-label={`Shortcut ${index + 1} command`} placeholder="command" maxlength={2048} value={shortcut().command}
                    onInput={(event) => updateShortcutDraft(shortcut().id, { command: event.currentTarget.value })} />
                </div>
              </div>
              <div class="terminal-shortcut-row-actions">
                <Button type="button" variant="ghost" class="terminal-shortcut-target" data-active={shortcut().target === "new" ? "true" : "false"}
                  aria-label={`Run ${shortcut().label || `shortcut ${index + 1}`} in ${shortcut().target === "new" ? "a new shell" : "this shell"}`}
                  aria-pressed={shortcut().target === "new"} title="Toggle between this shell and a new shell"
                  onClick={() => updateShortcutDraft(shortcut().id, { target: shortcut().target === "new" ? "current" : "new" })}>
                  <TerminalIcon /><span>{shortcut().target === "new" ? "New shell" : "This shell"}</span>
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label={`Move shortcut ${index + 1} up`}
                  onClick={() => moveShortcutDraft(index, -1)}><ArrowUpIcon /></Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === shortcutDraft().length - 1} aria-label={`Move shortcut ${index + 1} down`}
                  onClick={() => moveShortcutDraft(index, 1)}><ArrowDownIcon /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove shortcut ${index + 1}`}
                  onClick={() => setShortcutDraft((current) => current.filter((item) => item.id !== shortcut().id))}><Trash2Icon /></Button>
              </div>
            </div>
          }</Index>
          <Button type="button" variant="ghost" class="terminal-shortcut-add" disabled={shortcutDraft().length >= 12} onClick={addShortcutDraft}><PlusIcon />Add shortcut</Button>
          <div class="terminal-shortcut-editor-actions">
            <Button type="button" variant="outline" disabled={shortcutSaving()} onClick={() => setShortcutEditorOpen(false)}>Cancel</Button>
            <Button type="button" disabled={shortcutSaving()} onClick={() => void saveShortcutDraft()}>{shortcutSaving() ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <section ref={pane} class="terminal-pane" aria-label="Terminal pane" data-terminal-focused={terminalFocused() ? "true" : "false"} onKeyDown={scopeTerminalKeyboard}>
    <header class="terminal-pane-header">
      <Show when={coarseInput()}>
        <div class="terminal-pane-mobile-actions">
          <Button variant="ghost" size="icon-sm" aria-label={mobileKeysVisible() ? "Hide terminal keys" : "Show terminal keys"}
            title={mobileKeysVisible() ? "Hide terminal keys" : "Show terminal keys"} aria-pressed={mobileKeysVisible()} onClick={toggleMobileKeys}>
            <KeyboardIcon />
          </Button>
        </div>
      </Show>
      <Show when={props.standaloneControls}>
        <div class="terminal-pane-route-actions">
          <Button variant="ghost" size="icon-sm" aria-label="Open Conduit" title="Open Conduit" onClick={() => props.standaloneControls!.onOpenConduit()}><ArrowLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={fullscreen() ? "Exit fullscreen" : "Enter fullscreen and capture browser keys"} title={fullscreen() ? "Exit fullscreen" : "Enter fullscreen and capture browser keys"} aria-pressed={fullscreen()} onClick={() => void toggleFullscreen()}>
            <Show when={fullscreen()} fallback={<Maximize2Icon />}><Minimize2Icon /></Show>
          </Button>
        </div>
      </Show>
      <div class="terminal-pane-identity">
        <Show when={pty()?.title}><strong>{pty()!.title}</strong></Show>
        <span class="terminal-header-scope">{props.projectName || "Chats"}</span>
        <Show when={pty()?.currentCommand}><span class="terminal-header-command">{pty()!.currentCommand}</span></Show>
        <span class="terminal-header-status">{statusLabel()}</span>
      </div>
      <div class="terminal-shortcuts" aria-label="Terminal shortcuts">
        <For each={shortcuts()}>{(shortcut) =>
          <Button type="button" variant="ghost" size="sm" title={`${shortcut.target === "new" ? "New terminal" : "Current terminal"}: ${shortcut.command}`}
            disabled={starting() || (shortcut.target === "current" && !writable())} onClick={() => runShortcut(shortcut)}>
            {shortcut.label}
          </Button>
        }</For>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit terminal shortcuts" title="Edit terminal shortcuts" onClick={openShortcutEditor}>
          <Settings2Icon />
        </Button>
      </div>
      <div class="terminal-pane-actions">
        <Menu onOpenChange={(open) => { if (open) void refreshSessions().catch((cause) => setError((cause as Error).message)); }}>
          <MenuTrigger class="terminal-sessions-trigger" aria-label="Active terminal sessions" title="Active terminal sessions">
            <TerminalIcon /><span>{sessions().length}</span><ChevronDownIcon />
          </MenuTrigger>
          <MenuContent class="terminal-sessions-menu">
            <MenuGroup>
              <MenuLabel>Active terminals in {props.projectName || "Chats"}</MenuLabel>
              <Show when={sessions().length > 0} fallback={<div class="terminal-session-empty">No active terminals in {props.projectName || "Chats"}.</div>}>
                <For each={sessions()}>{(session) => <>
                  <div class="terminal-session-row">
                    <MenuItem class="terminal-session-item" onSelect={() => void attachSession(session)}>
                      <CheckIcon class={pty()?.id === session.id ? "terminal-session-check" : "terminal-session-check terminal-session-check-hidden"} />
                      <span class="terminal-session-copy">
                        <strong>{session.title || "Shell"}</strong>
                        <small>{sessionMetadata(session)}</small>
                      </span>
                    </MenuItem>
                    <Tooltip>
                      <TooltipTrigger as="div" class="terminal-session-action-wrap">
                        <MenuItem class="terminal-session-action" aria-label={`Rename ${session.title || "terminal"}`}
                          textValue={`Rename ${session.title || "terminal"}`} onSelect={() => requestRename(session)}>
                          <PencilIcon />
                        </MenuItem>
                      </TooltipTrigger>
                      <TooltipContent>Rename {session.title || "terminal"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as="div" class="terminal-session-action-wrap">
                        <MenuItem class="terminal-session-action" aria-label={`Detach from ${session.title || "terminal"}`}
                          textValue={`Detach from ${session.title || "terminal"}`}
                          disabled={pty()?.id !== session.id || connectionState() !== "attached"}
                          onSelect={() => detachSession(session)}>
                          <UnplugIcon />
                        </MenuItem>
                      </TooltipTrigger>
                      <TooltipContent>Detach from {session.title || "terminal"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as="div" class="terminal-session-action-wrap">
                        <MenuItem
                          class="terminal-session-destroy"
                          variant="destructive"
                          aria-label={`Destroy ${session.title || "terminal"}`}
                          textValue={`Destroy ${session.title || "terminal"}`}
                          disabled={sessionBusy() === session.id}
                          onSelect={() => void removeSession(session)}
                        >
                          <Show when={sessionBusy() === session.id} fallback={<Trash2Icon />}><Spinner /></Show>
                        </MenuItem>
                      </TooltipTrigger>
                      <TooltipContent>Destroy {session.title || "terminal"}</TooltipContent>
                    </Tooltip>
                  </div>
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
        <div class="terminal-pane-state"><strong>Terminal available</strong><Button onClick={() => void reconnect()}>Take control</Button></div>
      </Show>
      <Show when={pty() && connectionState() === "exited"}>
        <div class="terminal-pane-state"><strong>Terminal exited</strong><Button onClick={() => void restart()}>Start new terminal</Button></div>
      </Show>
      <Show when={error()}><p class="terminal-pane-error" role="alert">{error()}</p></Show>
    </div>
    <Show when={coarseInput() && mobileKeysVisible()}>
      <div class="terminal-mobile-keys" role="toolbar" aria-label="Terminal keys" data-mobile-swipe-ignore
        onMouseDown={(event) => event.preventDefault()}>
        <button type="button" onClick={() => inputTerminal("\x1b")}>Esc</button>
        <button type="button" onClick={() => inputTerminal("\t")}>Tab</button>
        <button type="button" class="terminal-mobile-modifier" data-active={controlArmed() ? "true" : "false"}
          aria-pressed={controlArmed()} onClick={() => toggleMobileModifier("control")}>Ctrl</button>
        <button type="button" class="terminal-mobile-modifier" data-active={altArmed() ? "true" : "false"}
          aria-pressed={altArmed()} onClick={() => toggleMobileModifier("alt")}>Alt</button>
        <button type="button" aria-label="Left arrow" onClick={() => inputArrow("D")}>←</button>
        <button type="button" aria-label="Down arrow" onClick={() => inputArrow("B")}>↓</button>
        <button type="button" aria-label="Up arrow" onClick={() => inputArrow("A")}>↑</button>
        <button type="button" aria-label="Right arrow" onClick={() => inputArrow("C")}>→</button>
        <button type="button" aria-label="Control C" onClick={() => { clearMobileModifiers(); inputTerminal("\x03", false); }}>^C</button>
        <button type="button" onClick={() => inputTerminal("/")}>/</button>
        <button type="button" onClick={() => inputTerminal("-")}>-</button>
        <button type="button" onClick={() => inputTerminal("|")}>|</button>
        <button type="button" onClick={() => inputTerminal("~")}>~</button>
        <button type="button" aria-label="Decrease terminal font size" onClick={() => changeMobileFontSize(-1)}>A−</button>
        <button type="button" aria-label="Increase terminal font size" onClick={() => changeMobileFontSize(1)}>A+</button>
        <button type="button" onClick={() => void pasteFromClipboard()}>Paste</button>
      </div>
    </Show>
  </section>
  </>;
}
