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

/**
 * Turns the image files on a paste into the text to type into the PTY. The
 * renderer does not know where they go; the pane spools them and hands back a
 * path, which reaches the TUI as an ordinary bracketed paste.
 */
export type TerminalPasteFiles = (files: File[]) => Promise<string>;

export type TerminalRendererOptions = { pasteFiles?: TerminalPasteFiles };

export async function createTerminalRenderer(host: HTMLElement, options: TerminalRendererOptions = {}): Promise<TerminalRenderer> {
  await loadTerminalFont();
  host.style.setProperty("--conduit-terminal-background", CONDUIT_TERMINAL_THEME.background);
  return createXtermRenderer(host, options);
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

/**
 * An image on the clipboard still carries a text flavour, and that flavour is
 * usually whitespace. A terminal cannot render the image, so pasting the
 * flavour only injects blank lines into whatever is reading the prompt. Text
 * with something in it is the only text worth sending.
 */
export function pastableText(text: string | null | undefined): string {
  return text && text.trim() ? text : "";
}

function imageFiles(items: FileList | null | undefined): File[] {
  return [...(items ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * Reads whatever the clipboard is offering and reduces it to the text a
 * terminal can accept: real text as-is, an image as the path it was spooled to.
 * Text wins when both are present, which is what every other terminal does.
 */
export async function clipboardPasteText(pasteFiles?: TerminalPasteFiles): Promise<string> {
  if (navigator.clipboard?.read) {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/plain")) {
          const text = pastableText(await (await item.getType("text/plain")).text());
          if (text) return text;
        }
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType || !pasteFiles) continue;
        const blob = await item.getType(imageType);
        return await pasteFiles([new File([blob], "pasted", { type: imageType })]);
      }
      return "";
    } catch {
      // `read()` may be refused where `readText()` is still granted.
    }
  }
  if (!navigator.clipboard?.readText) return "";
  return pastableText(await navigator.clipboard.readText());
}

function installClipboardShortcuts(host: HTMLElement, terminal: ClipboardTerminal, options: TerminalRendererOptions) {
  // The browser's own paste is the only one a non-secure context has, so it
  // stays enabled and keeps working there. It just must not hand xterm an
  // image's text flavour, which is whitespace and arrives as blank lines.
  // Capturing on the host runs this ahead of xterm's handler on the textarea.
  const interceptPaste = (event: ClipboardEvent) => {
    if (pastableText(event.clipboardData?.getData("text/plain"))) return;
    event.preventDefault();
    const files = imageFiles(event.clipboardData?.files);
    if (!files.length || !options.pasteFiles) return;
    void options.pasteFiles(files).then((text) => { if (text) terminal.paste?.(text); }).catch(() => {});
  };
  host.addEventListener("paste", interceptPaste, { capture: true });

  terminal.attachCustomKeyEventHandler?.((event) => {
    // xterm uses the bare Alt key to enter rectangular-selection mode. That
    // conflicts with terminal programs such as Codex that own Alt shortcuts,
    // and can remain latched when the OS consumes the matching key-up event.
    if (event.key === "Alt") return false;
    if (event.type !== "keydown") return true;
    const key = event.key.toLowerCase();
    const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const copy = key === "c" && (isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey);

    // A terminal reached through a browser is almost never running on the
    // machine the browser is on, so a paste has to mean the browser's
    // clipboard. TUIs disagree on which modifier pastes -- Ctrl+V, Alt+V,
    // Cmd+V -- and one left unclaimed reaches the TUI, which then reads the
    // host's clipboard instead: the wrong machine's, and silently so. Conduit
    // claims all three.
    const paste = key === "v" && (event.ctrlKey || event.metaKey || event.altKey);
    const browserPasteGesture = isApple ? event.metaKey : event.ctrlKey;

    // The async Clipboard API only exists in a secure context, so it is absent
    // whenever Conduit is reached over plain HTTP on a LAN address. Falling
    // through leaves the browser's own copy/paste on xterm's textarea intact,
    // which still works there; swallowing the key would break it outright.
    if (copy && terminal.hasSelection?.()) {
      if (!navigator.clipboard?.writeText) return true;
      event.preventDefault();
      const selection = terminal.getSelection?.() || "";
      if (selection) void navigator.clipboard.writeText(selection).catch(() => {});
      return false;
    }
    if (paste && terminal.paste) {
      // Without the async Clipboard API the browser's own paste is the only
      // way in, and it answers to Ctrl/Cmd+V alone. Alt+V has no fallback, so
      // swallow it rather than let it through to read the host's clipboard.
      if (!navigator.clipboard?.read && !navigator.clipboard?.readText) return browserPasteGesture;
      event.preventDefault();
      void clipboardPasteText(options.pasteFiles)
        .then((text) => { if (text) terminal.paste?.(text); })
        .catch(() => {});
      return false;
    }
    return true;
  });

  return () => host.removeEventListener("paste", interceptPaste, { capture: true });
}

async function createXtermRenderer(host: HTMLElement, options: TerminalRendererOptions): Promise<TerminalRenderer> {
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
    altClickMovesCursor: false,
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
  const stopClipboardShortcuts = installClipboardShortcuts(host, terminal, options);
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
    dispose: () => { stopClipboardShortcuts(); stopObservingHost(); contextLoss.dispose(); webgl.dispose(); clipboard.dispose(); fit.dispose?.(); terminal.dispose(); },
  };
}
