import terminalFontUrl from "../assets/MesloLGSNerdFontMono-Regular.ttf";
import { isMobileLayout } from "../navigation/mobile-layout";
import "./terminal-pane.css";

export type TerminalRenderer = {
  id: "xterm";
  cols: () => number;
  rows: () => number;
  write: (bytes: Uint8Array) => void;
  input: (data: string) => void;
  focus: () => void;
  fit: () => void;
  setFontSize: (fontSize: number) => void;
  repaint: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (listener: (data: string) => void) => () => void;
  onResize: (listener: (size: { cols: number; rows: number }) => void) => () => void;
  dispose: () => void;
};

// Keep the terminal palette owned by Conduit rather than inheriting xterm defaults.
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

export async function createTerminalRenderer(host: HTMLElement): Promise<TerminalRenderer> {
  await loadTerminalFont();
  host.style.setProperty("--conduit-terminal-background", CONDUIT_TERMINAL_THEME.background);
  return createXtermRenderer(host);
}

type TerminalFit = {
  fit: () => void;
  dispose?: () => void;
};
type ResizableTerminal = { cols: number; rows: number; resize: (cols: number, rows: number) => void };
type RefreshableTerminal = { refresh?: (start: number, end: number) => void };
type ClipboardTerminal = {
  attachCustomKeyEventHandler?: (handler: (event: KeyboardEvent) => boolean) => void;
  hasSelection?: () => boolean;
  getSelection?: () => string;
  paste?: (data: string) => void;
};

type WritableTerminal = ResizableTerminal & RefreshableTerminal & {
  write: (bytes: Uint8Array, callback?: () => void) => void;
};

function resizeTerminal(terminal: ResizableTerminal, cols: number, rows: number) {
  const width = Math.max(1, Math.min(500, Math.trunc(Number(cols)) || 1));
  const height = Math.max(1, Math.min(500, Math.trunc(Number(rows)) || 1));
  if (width === terminal.cols && height === terminal.rows) return;
  terminal.resize(width, height);
}

function writeTerminal(terminal: WritableTerminal, bytes: Uint8Array) {
  terminal.write(bytes);
}

function repaintTerminal(terminal?: ResizableTerminal & RefreshableTerminal) {
  terminal?.refresh?.(0, Math.max(0, terminal.rows - 1));
}

function applyFit(fit: TerminalFit) {
  // FitAddon owns geometry. Repaint is reserved for visibility changes and must
  // not sit on the resize or live-output hot path.
  fit.fit();
}

function terminalFontSize() {
  const fallback = isMobileLayout() ? 13 : 10.4;
  return Math.max(8, Math.min(24, Number(localStorage.getItem("conduit:terminal-font-size")) || fallback));
}

function observeHostSize(host: HTMLElement, terminal: ResizableTerminal & RefreshableTerminal, fit: TerminalFit) {
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
  fitNow();
  scheduleFit();

  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

function installClipboardShortcuts(terminal: ClipboardTerminal) {
  terminal.attachCustomKeyEventHandler?.((event) => {
    if (event.type !== "keydown") return true;
    const key = event.key.toLowerCase();
    const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const copy = key === "c" && (isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey);
    const paste = key === "v" && (isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey);

    if (copy && terminal.hasSelection?.()) {
      event.preventDefault();
      const selection = terminal.getSelection?.() || "";
      if (selection) void navigator.clipboard.writeText(selection).catch(() => {});
      return false;
    }
    if (paste && terminal.paste) {
      event.preventDefault();
      void navigator.clipboard.readText()
        .then((text) => { if (text) terminal.paste?.(text); })
        .catch(() => {});
      return false;
    }
    return true;
  });
}

async function createXtermRenderer(host: HTMLElement): Promise<TerminalRenderer> {
  const [{ Terminal }, { FitAddon }, { ClipboardAddon, Base64 }, { WebglAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-clipboard"),
    import("@xterm/addon-webgl"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const terminal = new Terminal({
    fontSize: terminalFontSize(),
    fontFamily: '"Conduit Terminal Font", monospace',
    cursorBlink: false,
    scrollback: 1000,
    theme: CONDUIT_TERMINAL_THEME,
  });
  const fit = new FitAddon();
  const clipboard = new ClipboardAddon(new Base64(), {
    // OSC 52 output may offer text to the system clipboard, but a terminal
    // process cannot read the user's clipboard. Clipboard reads remain an
    // explicit user gesture through the paste shortcut below.
    readText: async () => "",
    writeText: async (selection: string, text: string) => {
      if (selection !== "c") return;
      await navigator.clipboard.writeText(text).catch(() => {});
    },
  });
  terminal.loadAddon(fit);
  terminal.loadAddon(clipboard);
  terminal.open(host);
  const webgl = new WebglAddon();
  const contextLoss = webgl.onContextLoss(() => webgl.dispose());
  try {
    terminal.loadAddon(webgl);
  } catch {
    webgl.dispose();
  }
  installClipboardShortcuts(terminal);
  const stopObservingHost = observeHostSize(host, terminal, fit);
  return {
    id: "xterm",
    cols: () => terminal.cols,
    rows: () => terminal.rows,
    write: (bytes) => writeTerminal(terminal, bytes),
    input: (data) => terminal.input(data),
    focus: () => terminal.focus(),
    fit: () => applyFit(fit),
    setFontSize: (fontSize) => { terminal.options.fontSize = fontSize; applyFit(fit); },
    repaint: () => repaintTerminal(terminal),
    resize: (cols, rows) => resizeTerminal(terminal, cols, rows),
    onData: (listener) => { const subscription = terminal.onData(listener); return () => subscription.dispose(); },
    onResize: (listener) => { const subscription = terminal.onResize(listener); return () => subscription.dispose(); },
    dispose: () => { stopObservingHost(); contextLoss.dispose(); webgl.dispose(); clipboard.dispose(); fit.dispose?.(); terminal.dispose(); },
  };
}
