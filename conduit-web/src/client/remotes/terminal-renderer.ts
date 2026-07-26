import terminalFontUrl from "../assets/MesloLGSNerdFontMono-Regular.ttf";

export type TerminalRendererId = "ghostty" | "xterm";

export type TerminalRenderer = {
  id: TerminalRendererId;
  cols: () => number;
  rows: () => number;
  write: (bytes: Uint8Array) => void;
  focus: () => void;
  fit: () => void;
  onData: (listener: (data: string) => void) => () => void;
  onResize: (listener: (size: { cols: number; rows: number }) => void) => () => void;
  dispose: () => void;
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
  if (id === "xterm") return createXtermRenderer(host);
  return createGhosttyRenderer(host);
}

export async function preloadTerminalRenderer(id = selectedTerminalRenderer()) {
  await loadTerminalFont();
  if (id === "xterm") {
    await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/xterm/css/xterm.css")]);
    return;
  }
  const { init } = await import("ghostty-web");
  await init();
}

async function createGhosttyRenderer(host: HTMLElement): Promise<TerminalRenderer> {
  const { init, Terminal, FitAddon } = await import("ghostty-web");
  await init();
  const terminal = new Terminal({ fontSize: 13, fontFamily: '"Conduit Terminal Font", monospace' });
  terminal.open(host);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  fit.observeResize();
  return {
    id: "ghostty",
    cols: () => terminal.cols,
    rows: () => terminal.rows,
    write: (bytes) => terminal.write(bytes),
    focus: () => terminal.focus(),
    fit: () => fit.fit(),
    onData: (listener) => { const subscription = terminal.onData(listener); return () => subscription.dispose(); },
    onResize: (listener) => { const subscription = terminal.onResize(listener); return () => subscription.dispose(); },
    dispose: () => { fit.dispose(); terminal.dispose(); },
  };
}

async function createXtermRenderer(host: HTMLElement): Promise<TerminalRenderer> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const terminal = new Terminal({ fontSize: 13, fontFamily: '"Conduit Terminal Font", monospace' });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  const observer = new ResizeObserver(() => fit.fit());
  observer.observe(host);
  return {
    id: "xterm",
    cols: () => terminal.cols,
    rows: () => terminal.rows,
    write: (bytes) => terminal.write(bytes),
    focus: () => terminal.focus(),
    fit: () => fit.fit(),
    onData: (listener) => { const subscription = terminal.onData(listener); return () => subscription.dispose(); },
    onResize: (listener) => { const subscription = terminal.onResize(listener); return () => subscription.dispose(); },
    dispose: () => { observer.disconnect(); fit.dispose(); terminal.dispose(); },
  };
}
