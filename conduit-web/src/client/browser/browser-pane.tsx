import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { ToolBar, WebAddress, WebScreen, WebView, IconButton } from "@/components/ui";
import * as Icons from "@/components/ui/icons";
import { api } from "../api/client";
import { webSocketUrl } from "../api/transport.js";

/*
 * A Browser pane (`browser:<id>`, roadmap #7): the hub's browser, shared with Conduit's agents (server/browser-host.js,
 * the `browser` tool). Its frames come over the hub's stream and are drawn as they arrive; the pointer, wheel and keys
 * on the screen go back as the page's own input, mapped from the pane to the page; the bar goes to an address, back,
 * forward and reloads; and the page's viewport follows the pane's size.
 */
type Status = { id: string; available: boolean; running?: boolean; url?: string | null; title?: string | null; fps?: number };

const BUTTONS: Record<number, string> = { 0: "left", 1: "middle", 2: "right" };
const modifiers = (event: KeyboardEvent | MouseEvent) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
/** What was typed as an address: a URL as it is, a bare domain as https, anything else a search. */
export const addressOf = (typed: string) => {
  const text = typed.trim();
  if (!text) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  if (/^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(text) || /^localhost(:\d+)?(\/|$)/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
};

export function BrowserPane(props: { id: string; header: JSX.Element; onTitle?: (title: string) => void }) {
  const [status, setStatus] = createSignal<Status | null>(null);
  const [address, setAddress] = createSignal("");
  const [live, setLive] = createSignal(false);
  // Whose browser: the hub's, or a device's (roadmap #9), named while it starts and when its page has no name.
  const [where, setWhere] = createSignal(props.id === "hub" ? "the hub" : "the device");
  const [state, setState] = createSignal<{ text: JSX.Element; tone?: "error" } | null>({ text: `Starting ${props.id === "hub" ? "the hub" : "the device"}'s browser…` });
  let canvas: HTMLCanvasElement | undefined;
  let screen: HTMLDivElement | undefined;
  let editing = false;
  let socket: WebSocket | null = null;
  let frame = { width: 0, height: 0 };
  let closed = false;
  let retry = 0;
  let drawing = Promise.resolve();

  const act = (action: string, value?: unknown) => api<Status>(`/v0/browsers/${encodeURIComponent(props.id)}/actions`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, value }) })
    .then((next) => { setStatus(next); name(next); return next; })
    .catch((error) => setState({ text: error instanceof Error ? error.message : String(error), tone: "error" }));
  // The tab's name: the page's title, else its host; a blank page is the Browser.
  const name = (found: Pick<Status, "title" | "url">) => {
    let host = "";
    try { host = found.url && found.url !== "about:blank" ? new URL(found.url).host : ""; } catch { /* not a URL */ }
    props.onTitle?.(found.title?.trim() || host || (props.id === "hub" ? "Browser" : `Browser · ${where()}`));
  };
  const send = (event: Record<string, unknown>) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };

  const draw = (data: string) => {
    // One frame at a time, the newest winning: a slow decode never queues stale frames behind it.
    drawing = drawing.then(async () => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      if (!canvas) return;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close();
      if (!live()) { setLive(true); setState(null); }
    }).catch(() => {});
  };

  const connect = async () => {
    if (closed) return;
    try {
      const next = new WebSocket(await webSocketUrl(`/v0/browsers/${encodeURIComponent(props.id)}/stream?maxFps=${status()?.fps || 24}`));
      socket = next;
      next.onmessage = (message) => {
        let event: { type?: string; data?: string; url?: string; message?: string; metadata?: { deviceWidth: number; deviceHeight: number } };
        try { event = JSON.parse(String(message.data)); } catch { return; }
        if (event.type === "frame" && event.data) { if (event.metadata) frame = { width: event.metadata.deviceWidth, height: event.metadata.deviceHeight }; draw(event.data); }
        else if (event.type === "url" && event.url) {
          if (!editing) setAddress(event.url === "about:blank" ? "" : event.url);
          setStatus((current) => current && { ...current, url: event.url });
          // A page someone else opened (an agent) names the tab too, once it has its title.
          void api<Status>(`/v0/browsers/${encodeURIComponent(props.id)}`).then(name).catch(() => {});
        }
        else if (event.type === "error") setState({ text: event.message || "The hub's browser stopped.", tone: "error" });
      };
      next.onopen = () => { retry = 0; };
      next.onclose = () => {
        if (closed || socket !== next) return;
        setLive(false);
        setState({ text: "Reconnecting to the hub's browser…" });
        window.setTimeout(() => void connect(), Math.min(8000, 500 * 2 ** retry++));
      };
    } catch (error) { setState({ text: error instanceof Error ? error.message : String(error), tone: "error" }); }
  };

  /** A point on the screen as the page's: the frame is drawn whole, centred across and from the top. */
  const point = (event: MouseEvent) => {
    const rect = screen!.getBoundingClientRect();
    const width = frame.width || canvas?.width || rect.width;
    const height = frame.height || canvas?.height || rect.height;
    const scale = Math.min(rect.width / width, rect.height / height) || 1;
    const left = (rect.width - width * scale) / 2;
    return { x: Math.round((event.clientX - rect.left - left) / scale), y: Math.round((event.clientY - rect.top) / scale) };
  };
  let moving = 0;
  let lastMove: MouseEvent | null = null;
  const mouse = (eventType: string, event: MouseEvent, extra: Record<string, unknown> = {}) =>
    send({ type: "input_mouse", eventType, ...point(event), button: BUTTONS[event.button] ?? "none", clickCount: event.detail || 1, modifiers: modifiers(event), ...extra });
  const onPointerDown = (event: PointerEvent) => { screen?.focus(); screen?.setPointerCapture(event.pointerId); mouse("mousePressed", event); event.preventDefault(); };
  const onPointerUp = (event: PointerEvent) => { mouse("mouseReleased", event); };
  const onPointerMove = (event: PointerEvent) => {
    lastMove = event;
    // Moves go once a frame: a page needs where the pointer is, not every point it passed.
    if (!moving) moving = requestAnimationFrame(() => { moving = 0; if (lastMove) mouse("mouseMoved", lastMove, { button: lastMove.buttons ? "left" : "none" }); });
  };
  const onWheel = (event: WheelEvent) => { event.preventDefault(); send({ type: "input_mouse", eventType: "mouseWheel", ...point(event), button: "none", deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifiers(event) }); };
  const key = (eventType: string, event: KeyboardEvent) => {
    event.preventDefault();
    send({ type: "input_keyboard", eventType, key: event.key, code: event.code, modifiers: modifiers(event),
      ...(eventType === "keyDown" && event.key.length === 1 && !event.ctrlKey && !event.metaKey ? { text: event.key } : {}) });
  };
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    for (const char of text.slice(0, 2000)) { send({ type: "input_keyboard", eventType: "keyDown", key: char, text: char }); send({ type: "input_keyboard", eventType: "keyUp", key: char }); }
  };

  onMount(() => {
    if (props.id !== "hub") void api<{ browsers: { id: string; name: string }[] }>("/v0/browsers").then(({ browsers }) => {
      const found = browsers.find((item) => item.id === props.id);
      if (found) { setWhere(found.name); if (!live()) setState({ text: `Starting ${found.name}'s browser…` }); }
    }).catch(() => {});
    void api<Status>(`/v0/browsers/${encodeURIComponent(props.id)}`).then((found) => {
      setStatus(found);
      if (!found.available) {
        setState({ tone: "error", text: props.id === "hub"
          ? <span>The hub's browser is not available: Conduit's agent-browser is missing for this machine. Reinstall Conduit, or set <code>CONDUIT_AGENT_BROWSER</code> to an agent-browser binary.</span>
          : <span>{where()}'s browser is not reachable: the device is away, or no longer shares a folder that may run commands.</span> });
        return;
      }
      if (found.url && found.url !== "about:blank") setAddress(found.url);
      name(found);
      void connect();
    }).catch((error) => setState({ text: error instanceof Error ? error.message : String(error), tone: "error" }));
    // The page as big as the pane: its viewport follows the screen's size, settled for a moment first.
    let sizing = 0;
    let sized = "";
    let measured: { width: number; height: number } | null = null;
    // The page as big as the pane, once the browser is known to be there: a size measured before that is kept, and
    // sent when it is (the first measure comes before the status does).
    const size = () => {
      if (!measured || measured.width < 50 || measured.height < 50 || !status()?.available) return;
      const next = `${Math.round(measured.width)}x${Math.round(measured.height)}`;
      if (next === sized) return;
      sized = next;
      void act("viewport", measured);
    };
    const observer = new ResizeObserver(([entry]) => {
      measured = { width: entry!.contentRect.width, height: entry!.contentRect.height };
      clearTimeout(sizing);
      sizing = window.setTimeout(size, 400);
    });
    if (screen) observer.observe(screen);
    createEffect(() => { if (status()?.available) size(); });
    onCleanup(() => { observer.disconnect(); clearTimeout(sizing); });
  });
  // Services › Browser changed it: the frame rate is this viewer's own, sent on the open stream; a restart reconnects.
  const changed = () => void api<Status>(`/v0/browsers/${encodeURIComponent(props.id)}`).then((found) => {
    setStatus(found); name(found);
    if (found.fps) send({ type: "config", maxFps: found.fps });
  }).catch(() => {});
  window.addEventListener("conduit:browser-changed", changed);
  onCleanup(() => { closed = true; cancelAnimationFrame(moving); socket?.close(); window.removeEventListener("conduit:browser-changed", changed); });

  const go = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape") { editing = false; setAddress(status()?.url && status()!.url !== "about:blank" ? status()!.url! : ""); event.currentTarget.blur(); return; }
    if (event.key !== "Enter") return;
    const url = addressOf(event.currentTarget.value);
    if (!url) return;
    editing = false;
    setAddress(url);
    event.currentTarget.blur();
    void act("open", url);
    screen?.focus();
  };

  return <>
    {props.header}
    <WebView label="Hub browser">
      <ToolBar>
        <IconButton label="Back" onClick={() => void act("back")}><Icons.Back /></IconButton>
        <IconButton label="Forward" onClick={() => void act("forward")}><Icons.Forward /></IconButton>
        <IconButton label="Reload" onClick={() => void act("reload")}><Icons.Refresh /></IconButton>
        <WebAddress aria-label="Address" placeholder="Search or type an address" value={address()} secure={address().startsWith("https://")}
          onFocus={(event) => { editing = true; event.currentTarget.select(); }} onBlur={() => { editing = false; }}
          onInput={(event) => setAddress(event.currentTarget.value)} onKeyDown={go} />
      </ToolBar>
      <WebScreen ref={(element: HTMLDivElement) => { screen = element; }} canvas={(element) => { canvas = element; }} live={live()} aria-label="Page"
        state={state()?.text} tone={state()?.tone} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerMove={onPointerMove}
        onWheel={onWheel} onKeyDown={(event) => key("keyDown", event)} onKeyUp={(event) => key("keyUp", event)} onPaste={onPaste}
        onContextMenu={(event) => event.preventDefault()} />
    </WebView>
  </>;
}
