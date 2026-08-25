import terminalFontUrl from "../assets/MesloLGSNerdFontMono-Regular.ttf";
import { isMobileLayout } from "../navigation/mobile-layout";
import "./terminal-pane.css";

export type TerminalRendererId = "ghostty" | "xterm";

export type TerminalRenderer = {
  id: TerminalRendererId;
  cols: () => number;
  rows: () => number;
  write: (bytes: Uint8Array) => Promise<void>;
  focus: () => void;
  fit: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (listener: (data: string) => void) => () => void;
  onResize: (listener: (size: { cols: number; rows: number }) => void) => () => void;
  dispose: () => void;
};

// Keep the terminal palette owned by Conduit rather than inheriting renderer
// defaults. Both renderers receive exactly the same ANSI/default colours so TUI
// output does not change merely because the browser renderer changed.
export const CONDUIT_TERMINAL_THEME = {
  background: "#121315",
  foreground: "#e6e8ea",
  cursor: "#91a0af",
  cursorAccent: "#121315",
  selectionBackground: "#35404b",
  selectionForeground: "#f3f4f6",
  black: "#25272b",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#d7dae0",
  brightBlack: "#6b7078",
  brightRed: "#ef7f88",
  brightGreen: "#a9d58a",
  brightYellow: "#f0cd8b",
  brightBlue: "#77b9f2",
  brightMagenta: "#d48be6",
  brightCyan: "#6cc5d0",
  brightWhite: "#f3f4f6",
};

let fontPromise: Promise<void> | undefined;

async function loadTerminalFont() {
  if (!fontPromise) {
    fontPromise = (async () => {
      const font = new FontFace("Conduit Terminal Font", `url(${terminalFontUrl}) format('truetype')`);
      await font.load();
      document.fonts.add(font);
    })();
  }
  return fontPromise;
}

export function selectedTerminalRenderer(): TerminalRendererId {
  const value = new URLSearchParams(location.search).get("terminalRenderer") || localStorage.getItem("conduit:terminal-renderer");
  return value === "xterm" ? "xterm" : "ghostty";
}

export async function createTerminalRenderer(host: HTMLElement, id = selectedTerminalRenderer()): Promise<TerminalRenderer> {
  await loadTerminalFont();
  host.style.setProperty("--conduit-terminal-background", CONDUIT_TERMINAL_THEME.background);
  if (id === "xterm") return createXtermRenderer(host);
  return createGhosttyRenderer(host);
}

type TerminalFit = {
  fit: () => void;
  dispose?: () => void;
};
type ResizableTerminal = { cols: number; rows: number; resize: (cols: number, rows: number) => void };

type WritableTerminal = ResizableTerminal & {
  write: (bytes: Uint8Array, callback?: () => void) => void;
  options: { cursorBlink?: boolean };
};

function resizeTerminal(terminal: ResizableTerminal, cols: number, rows: number) {
  const width = Math.max(1, Math.min(500, Math.trunc(Number(cols)) || 1));
  const height = Math.max(1, Math.min(500, Math.trunc(Number(rows)) || 1));
  if (width === terminal.cols && height === terminal.rows) return;
  terminal.resize(width, height);
}

function writeTerminal(terminal: WritableTerminal, bytes: Uint8Array) {
  return new Promise<void>((resolve) => {
    terminal.write(bytes, () => {
      terminal.options.cursorBlink = false;
      resolve();
    });
  });
}

function applyFit(fit: TerminalFit) {
  // FitAddon owns renderer-specific cell metrics and the render invalidation
  // needed after a resize. Calling fit() also keeps xterm's scrollback viewport
  // in sync; resizing from proposeDimensions() alone can leave stale geometry.
  fit.fit();
}

function observeHostSize(host: HTMLElement, terminal: ResizableTerminal, fit: TerminalFit) {
  let frame: number | undefined;
  let disposed = false;
  let width = -1;
  let height = -1;

  const fitNow = () => {
    frame = undefined;
    if (disposed || !host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) return;
    applyFit(fit);
  };
  const scheduleFit = () => {
    if (frame === undefined) frame = requestAnimationFrame(fitNow);
  };
  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const nextWidth = entry.contentRect.width;
    const nextHeight = entry.contentRect.height;
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    scheduleFit();
  });

  observer.observe(host);
  // The font has loaded before the renderer is opened. Fit immediately so a new
  // PTY can be spawned at the real initial grid instead of 80x24 -> SIGWINCH.
  fitNow();
  scheduleFit();

  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

async function createGhosttyRenderer(host: HTMLElement): Promise<TerminalRenderer> {
  const { init, Terminal, FitAddon } = await import("ghostty-web");
  await init();
  const terminal = new Terminal({
    fontSize: isMobileLayout() ? 13 : 10.4,
    fontFamily: '"Conduit Terminal Font", monospace',
    cursorBlink: false,
    theme: CONDUIT_TERMINAL_THEME,
  });
  terminal.open(host);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.reset();
  const stopObservingHost = observeHostSize(host, terminal, fit);
  return {
    id: "ghostty",
    cols: () => terminal.cols,
    rows: () => terminal.rows,
    write: (bytes) => writeTerminal(terminal, bytes),
    focus: () => terminal.focus(),
    fit: () => applyFit(fit),
    resize: (cols, rows) => resizeTerminal(terminal, cols, rows),
    onData: (listener) => { const subscription = terminal.onData(listener); return () => subscription.dispose(); },
    onResize: (listener) => { const subscription = terminal.onResize(listener); return () => subscription.dispose(); },
    dispose: () => { stopObservingHost(); fit.dispose?.(); terminal.dispose(); },
  };
}

async function createXtermRenderer(host: HTMLElement): Promise<TerminalRenderer> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const terminal = new Terminal({
    fontSize: isMobileLayout() ? 13 : 10.4,
    fontFamily: '"Conduit Terminal Font", monospace',
    cursorBlink: false,
    theme: CONDUIT_TERMINAL_THEME,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  const stopObservingHost = observeHostSize(host, terminal, fit);
  return {
    id: "xterm",
    cols: () => terminal.cols,
    rows: () => terminal.rows,
    write: (bytes) => writeTerminal(terminal, bytes),
    focus: () => terminal.focus(),
    fit: () => applyFit(fit),
    resize: (cols, rows) => resizeTerminal(terminal, cols, rows),
    onData: (listener) => { const subscription = terminal.onData(listener); return () => subscription.dispose(); },
    onResize: (listener) => { const subscription = terminal.onResize(listener); return () => subscription.dispose(); },
    dispose: () => { stopObservingHost(); fit.dispose?.(); terminal.dispose(); },
  };
}
