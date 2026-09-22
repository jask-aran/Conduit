import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, onMount, Show } from "solid-js";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, EllipsisIcon, FocusIcon, KeyboardIcon, Maximize2Icon, Minimize2Icon, GripVerticalIcon, PencilIcon, PlusIcon, Settings2Icon, TerminalIcon, Trash2Icon, UnplugIcon } from "lucide-solid";
import { toast } from "solid-sonner";
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
  Popover,
  PopoverContent,
  Spinner,
} from "@/components/primitives";
import { api } from "../api/client";
import type { Connectivity } from "../state/runtime";
import { onPathChange } from "../platform/servers";
import { terminalSocketUrl } from "../api/transport";
import { pwaUpdateImpending } from "../pwa-update";
import { clipboardPasteText, createTerminalRenderer, type TerminalPasteFiles, type TerminalRenderer } from "./terminal-renderer";
import { terminalRecoveryView, type TerminalConnectionState, type TerminalRecoveryView } from "./terminal-recovery";
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
const PTY_IN_USE_CLOSE_CODE = 4009;
const PTY_TAKEN_OVER_CLOSE_CODE = 4010;
const SERVER_RESTART_CLOSE_CODE = 1012;
const MOBILE_KEYS_STORAGE_KEY = "conduit:terminal-mobile-keys";
// A Conduit restart closes every terminal socket at once and stays down longer
// than a handful of sub-second retries can cover. Back off like the runtime
// stream instead of giving up: quick first attempts for an ordinary blip, then
// a slow poll that keeps waiting for the server to come back.
const RECONNECT_CEILING_MS = 8_000;
const RECONNECT_IDLE_MS = 10_000;
const RECONNECT_VISIBLE_ATTEMPTS = 5;

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

export function TerminalPane(props: { projectId: string; projectName?: string; workingRoot?: string; terminalId?: string; active?: boolean; autoStart?: boolean; focusRequest?: number; connectivity?: () => Connectivity; standaloneControls?: StandaloneTerminalControls }) {
  const [pty, setPty] = createSignal<Pty | null>(null);
  const [sessions, setSessions] = createSignal<Pty[]>([]);
  const [error, setError] = createSignal("");
  const [starting, setStarting] = createSignal(false);
  // Whether this pane has asked the server what is running yet. Until it has,
  // "start or reattach" is a guess -- and after a reload it is the wrong one,
  // flashed for as long as the session list takes to arrive.
  const [looked, setLooked] = createSignal(false);
  createEffect(() => { if (pty()) setLooked(true); });
  const [sessionBusy, setSessionBusy] = createSignal("");
  const [renameSession, setRenameSession] = createSignal<Pty | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [connectionState, setConnectionState] = createSignal<TerminalConnectionState>("idle");
  const [writable, setWritable] = createSignal(false);
  const [terminalFocused, setTerminalFocused] = createSignal(false);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [coarseInput, setCoarseInput] = createSignal(false);
  const [mobileKeysVisible, setMobileKeysVisible] = createSignal(localStorage.getItem(MOBILE_KEYS_STORAGE_KEY) !== "false");
  const [controlArmed, setControlArmed] = createSignal(false);
  const [altArmed, setAltArmed] = createSignal(false);
  const [shortcuts, setShortcuts] = createSignal<TerminalShortcut[]>([]);
  const [shortcutEditorOpen, setShortcutEditorOpen] = createSignal(false);
  // The one shortcut open for editing, or a new one not yet saved.
  const [editingShortcut, setEditingShortcut] = createSignal<TerminalShortcut | null>(null);
  const [shortcutSaving, setShortcutSaving] = createSignal(false);
  const [shortcutError, setShortcutError] = createSignal("");
  const [draggingShortcut, setDraggingShortcut] = createSignal<number | null>(null);
  const [shortcutDropTarget, setShortcutDropTarget] = createSignal<number | null>(null);
  let shortcutGear: HTMLButtonElement | undefined;
  let shortcutOverflow: HTMLButtonElement | undefined;
  let openEditorAfterMenu = false;
  let host: HTMLDivElement | undefined;
  let pane: HTMLElement | undefined;
  let terminal: TerminalRenderer | undefined;
  let socket: WebSocket | undefined;
  let disposeConnection: (() => void) | undefined;
  let syncGeometry: (() => void) | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempts = 0;
  // Set when the server answers that this terminal no longer exists, which is
  // the one close the reconnect loop must not keep chasing.
  let terminalGone = false;
  let connectionGeneration = 0;
  let mounted = false;
  let wasInactive = false;
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
  /**
   * A terminal has nowhere to put an image, so a pasted one is spooled to a
   * file on the Conduit host and only its path is typed in. From the TUI's
   * side that is indistinguishable from pasting a path in a native terminal.
   */
  const spoolPastedImages: TerminalPasteFiles = async (files) => {
    const paths: string[] = [];
    for (const file of files) {
      try {
        const spooled = await api<{ path: string }>("/v0/terminal-paste", {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        paths.push(spooled.path);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Pasted image could not be saved");
      }
    }
    return paths.join(" ");
  };
  const pasteFromClipboard = async () => {
    clearMobileModifiers();
    // Reading the clipboard needs a secure context, which a plain-HTTP LAN
    // address is not. Say so rather than blaming a permission the browser
    // never offered to grant.
    if (!navigator.clipboard?.read && !navigator.clipboard?.readText) {
      setError("Pasting needs a secure connection. Use the keyboard's own paste, or reach Conduit over HTTPS or localhost.");
      return;
    }
    try {
      const text = await clipboardPasteText(spoolPastedImages);
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

  /*
   * The route to the server changed under an attached terminal.
   *
   * The pty is untouched -- same server, same tmux session, same scrollback --
   * so this reattaches rather than reporting an interruption. `connect` closes
   * the old socket through `disposeConnection`, which marks it deliberate, so
   * no error is shown and no backoff is scheduled for a close nobody suffered.
   * The renderer is kept and tmux repaints the pane on attach, which is why
   * the move costs a repaint rather than a blank terminal.
   */
  onPathChange(() => {
    const record = pty();
    if (!record || record.status !== "running" || props.active === false) return;
    void connect(record);
  });

  const ensureRenderer = async ({ fresh = false } = {}) => {
    if (!host) throw new Error("Terminal surface is unavailable");
    if (terminal && !fresh) return terminal;
    disposeRenderer();
    host.dataset.terminalReady = "false";
    const startedAt = performance.now();
    const created = await createTerminalRenderer(host, { pasteFiles: spoolPastedImages });
    if (!host || activeProjectId !== props.projectId) {
      created.dispose();
      throw new Error("Terminal Workspace changed while the renderer was loading");
    }
    terminal = created;
    host.dataset.terminalRenderer = created.id;
    host.dataset.terminalRendererReadyMs = String(Math.round(performance.now() - startedAt));
    return created;
  };

  const scheduleReconnect = (record: Pty, closeCode: number) => {
    if (
      record.status !== "running"
      || closeCode === PTY_IN_USE_CLOSE_CODE
      || closeCode === PTY_TAKEN_OVER_CLOSE_CODE
      || closeCode === 1013
      || terminalGone
      || activeProjectId !== record.projectId
      || props.active === false
    ) return false;
    const attempt = reconnectAttempts;
    reconnectAttempts += 1;
    // "Offline" here means "still trying, just slowly" — the same contract the
    // runtime stream keeps. Only a terminal the server can no longer offer
    // stops the loop, and that arrives as pty_not_found.
    const waiting = attempt >= RECONNECT_VISIBLE_ATTEMPTS;
    const delay = waiting ? RECONNECT_IDLE_MS : Math.min(250 * (2 ** attempt), RECONNECT_CEILING_MS);
    clearReconnect();
    setConnectionState(waiting ? "offline" : "reconnecting");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      // While the server is away, or back with a build that is about to
      // replace this page, the retry would only attach to be torn down. The
      // effect on `serverReady` picks it up the moment neither is true.
      if (props.connectivity && !serverReady()) return;
      // The renderer is deliberately kept across attempts: tmux repaints the
      // pane on attach, so rebuilding it only costs a visible flash on every
      // retry and throws away the screen the user was reading.
      void connect(record, { retrying: true });
    }, delay);
    return true;
  };

  const connect = async (
    record: Pty,
    { freshRenderer = false, retrying = false, takeover = false, initialInput }: { freshRenderer?: boolean; retrying?: boolean; takeover?: boolean; initialInput?: string } = {},
  ) => {
    const generation = ++connectionGeneration;
    closeConnection();
    setError("");
    terminalGone = false;
    if (!retrying) reconnectAttempts = 0;
    setConnectionState("connecting");
    const activeTerminal = await ensureRenderer({ fresh: freshRenderer });
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
            reconnectAttempts = 0;
            setConnectionState("live");
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
              setConnectionState("stopped");
              intentionallyClosed = true;
              connection.close(1000, "Terminal exited");
            }
            return;
          }
          if (message.type === "client_error") {
            if (message.code === "pty_not_found" || message.code === "pty_not_running") {
              // Conduit came back without this terminal. Retrying cannot
              // resurrect it, so settle on the state that offers a new one.
              terminalGone = true;
              intentionallyClosed = true;
              clearReconnect();
              setWritable(false);
              setTerminalFocused(false);
              setPty((current) => current ? { ...current, status: "exited" } : current);
              setConnectionState("stopped");
              void refreshSessions(activeProjectId).catch(() => {});
              notifyPtyChange();
            } else if (message.code === "pty_in_use") {
              setWritable(false);
              setTerminalFocused(false);
              setConnectionState("conflict");
              setError("Terminal is attached in another Conduit client.");
            } else if (message.code === "pty_taken_over") {
              setWritable(false);
              setTerminalFocused(false);
              setConnectionState("conflict");
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
      if (generation === connectionGeneration && connectionState() !== "stopped" && connectionState() !== "conflict") {
        setConnectionState("reconnecting");
        setError("Terminal connection failed.");
      }
    };
    connection.onclose = (event) => {
      if (generation !== connectionGeneration || intentionallyClosed) return;
      setWritable(false);
      setTerminalFocused(false);
      const isOwnershipConflict = event.code === PTY_IN_USE_CLOSE_CODE || event.code === PTY_TAKEN_OVER_CLOSE_CODE;
      if (isOwnershipConflict) {
        setConnectionState("conflict");
        setError(event.code === PTY_IN_USE_CLOSE_CODE
          ? "Terminal is attached in another Conduit client."
          : "Another Conduit client took control of this terminal.");
        return;
      }
      if (pty()?.status === "exited") {
        setConnectionState("stopped");
        return;
      }
      if (connectionState() === "conflict") return;
      const reason = event.code === 1013
          ? "Terminal connection was closed because this browser could not keep up with output."
          : event.code === SERVER_RESTART_CLOSE_CODE
            ? "Conduit is restarting. Waiting for the terminal to come back."
            : "Terminal connection was interrupted.";
      setError(reason);
      if (!scheduleReconnect({ ...record, status: "running" }, event.code)) setConnectionState("offline");
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
      const current = pty();
      const selected = ptys.find((item) => item.id === current?.id);
      if (selected?.status === "running") {
        setPty(selected);
      } else if (current && (!selected || ["conflict", "offline", "reconnecting"].includes(connectionState()))) {
        discardSelectedTerminal(selected ? "The terminal ended in another Conduit client." : "The terminal is no longer available.");
      } else if (selected?.status === "exited" && connectionState() !== "stopped") {
        connectionGeneration += 1;
        reconnectAttempts = 0;
        closeConnection();
        disposeRenderer();
        setPty(selected);
        setConnectionState("stopped");
      }
    }
    return running;
  };

  const attachExisting = async (projectId = props.projectId) => {
    if (projectId !== activeProjectId || props.active === false) return;
    const selected = pty();
    if (selected?.status === "running") {
      if (!socket) await connect(selected, { freshRenderer: true });
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
      setLooked(true);
    }
  };

  const attachSession = async (record: Pty) => {
    if (record.projectId !== activeProjectId || record.status !== "running") return;
    if (pty()?.id === record.id) {
      if (socket && connectionState() === "live") focusActiveTerminal();
      else {
        try { await connect(record, { freshRenderer: true }); }
        catch (cause) { setError((cause as Error).message); }
      }
      return;
    }
    setPty(record);
    notifyPtyChange();
    try { await connect(record, { freshRenderer: true }); }
    catch (cause) { setError((cause as Error).message); }
  };

  const start = async (initialInput?: string, title?: string) => {
    if (starting()) return;
    const projectId = activeProjectId;
    setStarting(true);
    setError("");
    try {
      const activeTerminal = await ensureRenderer();
      activeTerminal.fit();
      if (projectId !== activeProjectId) return;
      const record = await api<Pty>("/v0/ptys", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          ...(props.workingRoot ? { cwd: props.workingRoot } : {}),
          ...(title ? { title } : {}),
          cols: activeTerminal.cols(),
          rows: activeTerminal.rows(),
        }),
      });
      if (projectId !== activeProjectId) return;
      setPty(record);
      notifyPtyChange();
      await refreshSessions(projectId);
      await connect(record, { freshRenderer: true, initialInput });
    } catch (cause) {
      if (projectId === activeProjectId) setError((cause as Error).message);
    } finally {
      if (projectId === activeProjectId) setStarting(false);
    }
  };

  const openShortcutEditor = () => {
    setEditingShortcut(null);
    setShortcutError("");
    setShortcutEditorOpen(true);
  };
  // Whichever of the two ways in is on screen: the gear inline, the overflow
  // menu when the pane is too narrow for it.
  const shortcutAnchor = () => (shortcutGear?.offsetParent ? shortcutGear : shortcutOverflow);
  /*
   * Every change lands as it is made -- an edit on Done, a removal or a move
   * straight away -- the same way the sessions menu acts on a click. There is
   * no draft of the whole list to save or lose.
   */
  const saveShortcuts = async (next: TerminalShortcut[]) => {
    setShortcutSaving(true);
    setShortcutError("");
    try {
      const saved = await api<{ terminalShortcuts?: unknown }>("/v0/preferences", {
        method: "PATCH",
        body: JSON.stringify({ terminalShortcuts: next }),
      });
      setShortcuts(normalizeTerminalShortcuts(saved.terminalShortcuts));
      return true;
    } catch (cause) {
      setShortcutError((cause as Error).message);
      return false;
    } finally {
      setShortcutSaving(false);
    }
  };
  const addShortcut = () => {
    if (shortcuts().length >= 12) return;
    setEditingShortcut({ id: crypto.randomUUID(), label: "", command: "", target: "current" });
  };
  const updateEditingShortcut = (patch: Partial<TerminalShortcut>) => {
    setEditingShortcut((current) => current ? { ...current, ...patch } : current);
  };
  const commitShortcut = async () => {
    const draft = editingShortcut();
    if (!draft) return;
    const edited = { ...draft, label: draft.label.trim(), command: draft.command.trim() };
    if (!edited.label || !edited.command) return;
    const existing = shortcuts().some((shortcut) => shortcut.id === edited.id);
    const next = existing
      ? shortcuts().map((shortcut) => shortcut.id === edited.id ? edited : shortcut)
      : [...shortcuts(), edited];
    if (await saveShortcuts(next)) setEditingShortcut(null);
  };
  const removeShortcut = (id: string) => {
    if (editingShortcut()?.id === id) setEditingShortcut(null);
    void saveShortcuts(shortcuts().filter((shortcut) => shortcut.id !== id));
  };
  const moveShortcut = (from: number, to: number) => {
    const next = [...shortcuts()];
    if (from === to || to < 0 || to >= next.length) return;
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setShortcuts(next);
    void saveShortcuts(next);
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

  const retryConnection = async () => {
    const record = pty();
    if (!record || record.status !== "running") return;
    reconnectAttempts = 0;
    await connect(record);
  };

  const takeControl = async () => {
    const record = pty();
    if (!record || record.status !== "running") return;
    reconnectAttempts = 0;
    await connect(record, { takeover: true });
  };

  const discardSelectedTerminal = (message: string) => {
    if (!pty()) return;
    connectionGeneration += 1;
    reconnectAttempts = 0;
    closeConnection();
    disposeRenderer();
    setPty(null);
    setConnectionState("idle");
    setError("");
    toast.info(message, { duration: 6_000 });
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
        try { await connect(record, { freshRenderer: true }); }
        catch (reconnectCause) {
          setError((reconnectCause as Error).message);
          setConnectionState("offline");
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
    setError("");
    setConnectionState("offline");
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

  /*
   * Each retry passes through "connecting", which has no recovery view of its
   * own. Showing nothing there uncovered the stale screen underneath for the
   * length of every attempt, so a restart flashed it on and off. The view on
   * screen is held until the attempt settles one way or the other.
   */
  const recovery = createMemo<TerminalRecoveryView | null>((previous) => {
    const state = connectionState();
    if (state === "connecting" && previous) return previous;
    const view = terminalRecoveryView(state, error());
    // Not an interruption to explain: the server is back and handing over to
    // a new build, and the terminal is waiting for it on purpose.
    if (view && (state === "reconnecting" || state === "offline") && pwaUpdateImpending()) {
      return { ...view, title: "Updating Conduit", message: "A new build is installing. The terminal reattaches when it is ready.", action: null };
    }
    return view;
  }, null);

  // Mirrors the sidebar footer indicator so both terminal surfaces say the same
  // thing about the server the pane depends on.
  const serverState = () => props.connectivity?.();
  const shortcutForm = () => <form class="terminal-shortcut-form"
    onSubmit={(event) => { event.preventDefault(); void commitShortcut(); }}
    onKeyDown={(event) => {
      // Escape backs out of the edit, not out of the whole popover.
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setEditingShortcut(null);
    }}>
    <div class="terminal-shortcut-form-line">
      <Input class="terminal-shortcut-name" aria-label="Shortcut name" placeholder="Name" maxlength={32}
        ref={(element) => queueMicrotask(() => element.focus())}
        value={editingShortcut()?.label || ""} onInput={(event) => updateEditingShortcut({ label: event.currentTarget.value })} />
      <div class="terminal-shortcut-target" role="group" aria-label="Run in">
        <button type="button" aria-pressed={editingShortcut()?.target !== "new"} onClick={() => updateEditingShortcut({ target: "current" })}>This shell</button>
        <button type="button" aria-pressed={editingShortcut()?.target === "new"} onClick={() => updateEditingShortcut({ target: "new" })}>New shell</button>
      </div>
    </div>
    <label class="terminal-shortcut-command">
      <span aria-hidden="true">$</span>
      <Input aria-label="Command" placeholder="command" maxlength={2048}
        value={editingShortcut()?.command || ""} onInput={(event) => updateEditingShortcut({ command: event.currentTarget.value })} />
    </label>
    <div class="terminal-shortcut-form-actions">
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingShortcut(null)}>Cancel</Button>
      <Button type="submit" size="sm" disabled={shortcutSaving() || !editingShortcut()?.label.trim() || !editingShortcut()?.command.trim()}>
        {shortcutSaving() ? "Saving…" : "Done"}
      </Button>
    </div>
  </form>;

  /*
   * One indicator for the server and the terminal together. Healthy says
   * nothing beyond a green dot; every other state names itself, and the
   * server's condition wins because the terminal cannot be better than the
   * server it runs on.
   */
  const headerStatus = (): { tone: "success" | "busy" | "warn" | "danger" | "muted"; label: string; title: string } => {
    const server = serverState();
    if (server === "online" && pwaUpdateImpending()) return { tone: "busy", label: "Updating", title: "Conduit is updating. The terminal reattaches on the new build." };
    if (server === "offline") return { tone: "danger", label: "Server unavailable", title: "Server unavailable" };
    if (server === "connecting" || server === "reconnecting") return { tone: "busy", label: "Reconnecting", title: "Reconnecting to Conduit" };
    const state = connectionState();
    if (state === "connecting") return { tone: "busy", label: "Connecting", title: "Connecting to the terminal" };
    if (state === "reconnecting") return { tone: "busy", label: "Reconnecting", title: "Reconnecting to the terminal" };
    if (state === "offline") return { tone: "danger", label: "Offline", title: "Terminal offline" };
    if (state === "conflict") return { tone: "warn", label: "In use", title: "Attached in another Conduit client" };
    if (state === "stopped") return { tone: "muted", label: "Exited", title: "Terminal exited" };
    if (state === "live" && !writable()) return { tone: "warn", label: "Read only", title: "Read only" };
    if (state === "live") return { tone: "success", label: "", title: server ? "Server connected · Active" : "Active" };
    return { tone: "muted", label: "", title: server === "online" ? "Server connected" : "Idle" };
  };
  // Back, and not about to reload into a new build. Reattaching before the
  // update check finished put the terminal on screen for the few seconds the
  // new build took to install, then pulled it away again for the reload.
  const serverReady = () => serverState() === "online" && !pwaUpdateImpending();

  // The runtime stream notices Conduit returning long before a backed-off
  // terminal retry would. Collapse the wait: reattach at once, and when the
  // terminal did not survive, refresh the list so the recovery button offers a
  // new one that can actually be spawned.
  createEffect(on(serverReady, (ready, previous) => {
    if (!ready || previous === undefined || previous) return;
    if (!mounted || props.active === false || activeProjectId !== props.projectId) return;
    const record = pty();
    const recoverable = connectionState() === "offline" || connectionState() === "reconnecting";
    if (record?.status === "running" && recoverable) {
      clearReconnect();
      reconnectAttempts = 0;
      void connect(record).catch((cause) => setError((cause as Error).message));
      return;
    }
    void refreshSessions(activeProjectId).catch(() => {});
  }));

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
      wasInactive = true;
      closeConnection();
      disposeRenderer();
      if (pty()?.status === "running") setConnectionState("offline");
      return;
    }
    const reattach = wasInactive;
    wasInactive = false;
    queueMicrotask(() => {
      const record = pty();
      if (reattach && record?.status === "running" && !socket) {
        void connect(record, { freshRenderer: true }).catch((cause) => setError((cause as Error).message));
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
    <Popover open={shortcutEditorOpen()} anchorRef={shortcutAnchor}
      onOpenChange={(open) => { setShortcutEditorOpen(open); if (!open) setEditingShortcut(null); }}>
      <PopoverContent class="terminal-menu" aria-label="Terminal shortcuts"
        onPointerDownOutside={(event) => { if (shortcutGear?.contains(event.target as Node)) event.preventDefault(); }}>
        <div class="terminal-menu-label">Shortcuts</div>
        <Show when={shortcuts().length > 0 || editingShortcut()} fallback={<div class="terminal-menu-empty">No shortcuts yet. Add a command you run often.</div>}>
          <div class="terminal-menu-list">
            <For each={shortcuts()}>{(shortcut, index) =>
              <Show when={editingShortcut()?.id !== shortcut.id} fallback={shortcutForm()}>
                <div class="terminal-menu-row terminal-shortcut-row" draggable="true"
                  data-dragging={draggingShortcut() === index() ? "true" : undefined}
                  data-drop-target={shortcutDropTarget() === index() && draggingShortcut() !== index() ? "true" : undefined}
                  onClick={() => setEditingShortcut({ ...shortcut })}
                  onDragStart={(event) => { setDraggingShortcut(index()); event.dataTransfer?.setData("text/plain", shortcut.id); }}
                  onDragOver={(event) => { if (draggingShortcut() === null) return; event.preventDefault(); setShortcutDropTarget(index()); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = draggingShortcut();
                    setDraggingShortcut(null);
                    setShortcutDropTarget(null);
                    if (from !== null) moveShortcut(from, index());
                  }}
                  onDragEnd={() => { setDraggingShortcut(null); setShortcutDropTarget(null); }}>
                  <button type="button" class="terminal-menu-grip" aria-label={`Move ${shortcut.label}; use the arrow keys`} title="Drag to reorder"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      moveShortcut(index(), index() + (event.key === "ArrowUp" ? -1 : 1));
                    }}><GripVerticalIcon /></button>
                  <span class="terminal-menu-copy"><strong>{shortcut.label}</strong><small>$ {shortcut.command}</small></span>
                  <span class="terminal-menu-tag" title={shortcut.target === "new" ? "Runs in a new shell" : "Runs in this shell"}>{shortcut.target === "new" ? "new" : "this"}</span>
                  <span class="terminal-menu-actions">
                    <button type="button" class="terminal-menu-action" aria-label={`Edit ${shortcut.label}`} title="Edit"
                      onClick={(event) => { event.stopPropagation(); setEditingShortcut({ ...shortcut }); }}><PencilIcon /></button>
                    <button type="button" class="terminal-menu-action" data-variant="destructive" aria-label={`Remove ${shortcut.label}`} title="Remove"
                      disabled={shortcutSaving()} onClick={(event) => { event.stopPropagation(); removeShortcut(shortcut.id); }}><Trash2Icon /></button>
                  </span>
                </div>
              </Show>
            }</For>
            <Show when={editingShortcut() && !shortcuts().some((shortcut) => shortcut.id === editingShortcut()!.id)}>{shortcutForm()}</Show>
          </div>
        </Show>
        <Show when={shortcutError()}><p class="terminal-menu-error">{shortcutError()}</p></Show>
        <div class="terminal-menu-separator" />
        <button type="button" class="terminal-menu-footer" disabled={shortcuts().length >= 12 || Boolean(editingShortcut())} onClick={addShortcut}>
          <PlusIcon /><span>Add shortcut</span>
        </button>
      </PopoverContent>
    </Popover>
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
        <div class="terminal-status" role="status" data-tone={headerStatus().tone} title={headerStatus().title} aria-label={headerStatus().title}>
          <div class={`runtime-indicator runtime-indicator-${headerStatus().tone === "busy" ? "muted" : headerStatus().tone}`} aria-hidden="true">
            <Show when={headerStatus().tone === "busy"} fallback={<i class="runtime-indicator-dot" />}><Spinner class="size-3" /></Show>
          </div>
          <Show when={headerStatus().label}><small>{headerStatus().label}</small></Show>
        </div>
        <Show when={pty()?.title}><strong>{pty()!.title}</strong></Show>
        <span class="terminal-header-context">{[props.projectName || "Chats", pty()?.currentCommand].filter(Boolean).join(" · ")}</span>
      </div>
      <div class="terminal-shortcuts" aria-label="Terminal shortcuts">
        <For each={shortcuts()}>{(shortcut) =>
          <Button type="button" variant="ghost" size="sm" title={`${shortcut.target === "new" ? "New terminal" : "Current terminal"}: ${shortcut.command}`}
            disabled={starting() || (shortcut.target === "current" && !writable())} onClick={() => runShortcut(shortcut)}>
            {shortcut.label}
          </Button>
        }</For>
        <Button ref={shortcutGear} type="button" variant="ghost" size="icon-sm" aria-label="Edit terminal shortcuts" title="Edit terminal shortcuts" aria-expanded={shortcutEditorOpen()}
          onClick={() => shortcutEditorOpen() ? setShortcutEditorOpen(false) : openShortcutEditor()}>
          <Settings2Icon />
        </Button>
      </div>
      {/* The same shortcuts, for a pane too narrow to lay them out inline. */}
      <div class="terminal-shortcuts-overflow">
        <Menu>
          <MenuTrigger ref={shortcutOverflow} class="terminal-sessions-trigger" aria-label="Terminal shortcuts" title="Terminal shortcuts"><EllipsisIcon /></MenuTrigger>
          <MenuContent class="terminal-menu" onCloseAutoFocus={(event) => {
            // Handing focus back to the trigger would count as a click outside
            // the editor that is about to open, and close it again.
            if (!openEditorAfterMenu) return;
            event.preventDefault();
            openEditorAfterMenu = false;
            openShortcutEditor();
          }}>
            <MenuGroup>
              <MenuLabel class="terminal-menu-label">Shortcuts</MenuLabel>
              <For each={shortcuts()}>{(shortcut) =>
                <MenuItem class="terminal-menu-row" disabled={starting() || (shortcut.target === "current" && !writable())} onSelect={() => runShortcut(shortcut)}>
                  <span class="terminal-menu-copy"><strong>{shortcut.label}</strong><small>$ {shortcut.command}</small></span>
                </MenuItem>
              }</For>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem class="terminal-menu-footer" onSelect={() => { openEditorAfterMenu = true; }}><Settings2Icon /><span>Edit shortcuts…</span></MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <span class="terminal-header-divider" aria-hidden="true" />
      <div class="terminal-pane-actions">
        <Menu onOpenChange={(open) => { if (open) void refreshSessions().catch((cause) => setError((cause as Error).message)); }}>
          <MenuTrigger class="terminal-sessions-trigger" aria-label="Active terminal sessions" title="Active terminal sessions">
            <TerminalIcon /><span>{sessions().length}</span><ChevronDownIcon />
          </MenuTrigger>
          <MenuContent class="terminal-menu">
            <MenuGroup>
              <MenuLabel class="terminal-menu-label">Active terminals · {props.projectName || "Chats"}</MenuLabel>
              <Show when={sessions().length > 0} fallback={<div class="terminal-menu-empty">No active terminals in {props.projectName || "Chats"}.</div>}>
                <For each={sessions()}>{(session) => {
                  const name = () => session.title || "Shell";
                  return <div class="terminal-menu-row">
                    <MenuItem class="terminal-menu-primary" onSelect={() => void attachSession(session)}>
                      <CheckIcon class="terminal-menu-check" data-current={pty()?.id === session.id ? "true" : undefined} />
                      <span class="terminal-menu-copy"><strong>{name()}</strong><small>{sessionMetadata(session)}</small></span>
                    </MenuItem>
                    <span class="terminal-menu-actions">
                      <MenuItem class="terminal-menu-action" aria-label={`Rename ${name()}`} textValue={`Rename ${name()}`} onSelect={() => requestRename(session)}>
                        <PencilIcon />
                      </MenuItem>
                      <MenuItem class="terminal-menu-action" aria-label={`Detach from ${name()}`} textValue={`Detach from ${name()}`}
                        disabled={pty()?.id !== session.id || connectionState() !== "live"} onSelect={() => detachSession(session)}>
                        <UnplugIcon />
                      </MenuItem>
                      <MenuItem class="terminal-menu-action" variant="destructive" aria-label={`Destroy ${name()}`} textValue={`Destroy ${name()}`}
                        disabled={sessionBusy() === session.id} onSelect={() => void removeSession(session)}>
                        <Show when={sessionBusy() === session.id} fallback={<Trash2Icon />}><Spinner /></Show>
                      </MenuItem>
                    </span>
                  </div>;
                }}</For>
              </Show>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem class="terminal-menu-footer" disabled={starting()} onSelect={() => void start()}>
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
            disabled={!writable() || connectionState() !== "live"}
            onClick={focusActiveTerminal}
          >
            <FocusIcon /><span class="terminal-action-label">{terminalFocused() ? "Focused" : "Focus"}</span>
          </Button>
        </Show>
      </div>
    </header>
    <div class="terminal-pane-body">
      <div
        ref={host}
        class="terminal-canvas"
        data-shortcut-exclusive="terminal"
        data-active={pty() ? "true" : "false"}
        data-renderer="xterm"
        onClick={() => focusActiveTerminal()}
        onFocusIn={handleTerminalFocusIn}
        onFocusOut={handleTerminalFocusOut}
      />
      <Show when={!pty() && looked()}>
        <div class="terminal-pane-empty">
          <TerminalIcon />
          <strong>Start or reattach a terminal</strong>
          <p>Terminal processes stay resident in this Workspace when the browser or pane detaches. Use the sessions menu to reattach or cull them.</p>
          <Button disabled={starting()} onClick={() => void start()}>{starting() ? <Spinner /> : "Start terminal"}</Button>
        </div>
      </Show>
      <Show when={recovery()}>
        {(view) => <div class="terminal-pane-state" role="status" aria-live="polite">
          <strong>{view().title}</strong>
          <p>{view().message}</p>
          <Show when={view().action === "retry"}>
            <Button onClick={() => void retryConnection()}>Retry</Button>
          </Show>
          <Show when={view().action === "takeover"}>
            <Button onClick={() => void takeControl()}>Take control</Button>
          </Show>
          <Show when={view().action === "restart"}>
            <Button onClick={() => void restart()}>Start new terminal</Button>
          </Show>
        </div>}
      </Show>
      <Show when={error() && !recovery()}><p class="terminal-pane-error" role="alert">{error()}</p></Show>
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
