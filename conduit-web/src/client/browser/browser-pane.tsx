import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ToolBar, LeadInput, WebScreen, WebView, IconButton } from "@/components/ui";
import * as Icons from "@/components/ui/icons";
import { api } from "../api/client";
import { webSocketUrl } from "../api/transport.js";
import { BrowserProxyView, proxyBack, proxyForward, proxyReload } from "./browser-proxy-view";

/*
 * A Browser pane (`browser:<id>`, roadmap #7): the hub's browser, shared with Conduit's agents (server/browser-host.js,
 * the `browser` tool). Its frames come over the hub's stream and are drawn as they arrive; the pointer, wheel and keys
 * on the screen go back as the page's own input, mapped from the pane to the page; the bar goes to an address, back,
 * forward and reloads; and the page's viewport follows the pane's size.
 */
type Codec = "h264" | "h265" | "jpeg";
type PictureSettings = { settings: { codec: Codec; direct?: boolean }; video: boolean };
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
  let drawing = false;
  let pending: { data: string; generation: number } | null = null;
  let generation = 0;
  let picture: PictureSettings = { settings: { codec: "h264" }, video: true };
  let jpegOnly = false;
  let decoder: VideoDecoder | null = null;
  let connecting = 0;
  // Direct pages (Services › Browser, experimental): the hub's browser only; the page fetched through the hub's proxy and
  // shown as itself, the bar driving it, with no stream while it is on.
  const [direct, setDirect] = createSignal(false);
  const [directUrl, setDirectUrl] = createSignal("");
  let directFrame: HTMLIFrameElement | undefined;

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

  // A blank page is the pane's own quiet start, not a white frame.
  const blank = () => direct() ? !directUrl() : live() && !state() && (!status()?.url || status()!.url === "about:blank");
  const painted = () => { if (!live()) { setLive(true); setState(null); } };
  const closeDecoder = () => { if (decoder && decoder.state !== "closed") decoder.close(); decoder = null; };
  const draw = async (data: string) => {
    pending = { data, generation };
    if (drawing) return;
    drawing = true;
    try {
      while (pending) {
        const next = pending;
        pending = null;
        let bitmap: ImageBitmap | null = null;
        try {
          const bytes = Uint8Array.from(atob(next.data), (char) => char.charCodeAt(0));
          bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
          if (!canvas || closed || next.generation !== generation) continue;
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          painted();
        } catch { /* a later frame can still decode */ }
        finally { bitmap?.close(); }
      }
    } finally { drawing = false; }
  };

  const selectCodec = async (): Promise<{ codec: Codec; config?: VideoDecoderConfig }> => {
    if (jpegOnly || !picture.video || picture.settings.codec === "jpeg" || typeof VideoDecoder === "undefined") return { codec: "jpeg" };
    const candidates: Codec[] = picture.settings.codec === "h265" ? ["h265", "h264"] : ["h264"];
    for (const codec of candidates) {
      for (const name of codec === "h265" ? ["hev1.1.6.L93.B0", "hvc1.1.6.L93.B0"] : ["avc1.42E01F"]) {
        const config = { codec: name, optimizeForLatency: true };
        try { if ((await VideoDecoder.isConfigSupported(config)).supported) return { codec, config }; } catch { /* try the next codec */ }
      }
    }
    return { codec: "jpeg" };
  };
  const connect = async () => {
    if (closed || direct()) return;
    const attempt = ++connecting;
    try {
      const selected = await selectCodec();
      const url = await webSocketUrl(`/v0/browsers/${encodeURIComponent(props.id)}/stream?maxFps=${status()?.fps || 24}&codec=${selected.codec}`);
      if (closed || connecting !== attempt) return;
      const next = new WebSocket(url);
      next.binaryType = "arraybuffer";
      socket = next;
      generation++;
      pending = null;
      closeDecoder();
      let waitingKey = true;
      let timestamp = 0;
      let dimensions = "";
      const fallback = () => {
        if (closed || socket !== next) return;
        jpegOnly = true;
        closeDecoder();
        next.close();
      };
      const configure = () => {
        closeDecoder();
        waitingKey = true;
        if (!selected.config) { fallback(); return; }
        const current = new VideoDecoder({
          output: (image) => {
            try {
              if (closed || socket !== next || decoder !== current || !canvas) return;
              const width = frame.width || image.displayWidth;
              const height = frame.height || image.displayHeight;
              if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
              canvas.getContext("2d")?.drawImage(image, 0, 0, width, height, 0, 0, width, height);
              painted();
            } finally { image.close(); }
          },
          error: () => { if (decoder === current) fallback(); },
        });
        decoder = current;
        current.configure(selected.config);
      };
      next.onmessage = (message) => {
        if (closed || socket !== next) return;
        if (typeof message.data !== "string") {
          if (!(message.data instanceof ArrayBuffer) || message.data.byteLength <= 5 || !decoder) return;
          const header = new DataView(message.data);
          const key = Boolean(header.getUint8(0) & 1);
          const width = header.getUint16(1);
          const height = header.getUint16(3);
          if (!width || !height) return;
          frame = { width, height };
          try {
            const size = `${width}x${height}`;
            if (dimensions && dimensions !== size) configure();
            dimensions = size;
            if (!decoder || decoder.state !== "configured") return;
            if (decoder.decodeQueueSize > 2) {
              waitingKey = true;
              if (!key) return;
              configure();
              if (!decoder || decoder.state !== "configured") return;
            }
            if (waitingKey && !key) return;
            waitingKey = false;
            decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: timestamp++, data: new Uint8Array(message.data, 5) }));
          } catch { fallback(); }
          return;
        }
        let event: { type?: string; codec?: string; data?: string; url?: string; message?: string; metadata?: { deviceWidth: number; deviceHeight: number } };
        try { event = JSON.parse(message.data); } catch { return; }
        if (event.type === "codec") {
          generation++;
          pending = null;
          dimensions = "";
          if (event.codec === "jpeg") closeDecoder();
          else if (event.codec === selected.codec && selected.config) { try { configure(); } catch { fallback(); } }
          else fallback();
        }
        else if (event.type === "frame" && event.data) { if (event.metadata) frame = { width: event.metadata.deviceWidth, height: event.metadata.deviceHeight }; void draw(event.data); }
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
        generation++;
        pending = null;
        closeDecoder();
        setLive(false);
        setState({ text: "Reconnecting to the hub's browser…" });
        window.setTimeout(() => { if (socket === next) void connect(); }, Math.min(8000, 500 * 2 ** retry++));
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
    void Promise.all([
      api<Status>(`/v0/browsers/${encodeURIComponent(props.id)}`),
      api<PictureSettings>(`/v0/browsers/${encodeURIComponent(props.id)}/settings`).catch((): PictureSettings => ({ settings: { codec: "jpeg" }, video: false })),
    ]).then(([found, settings]) => {
      picture = settings;
      setDirect(props.id === "hub" && settings.settings.direct === true);
      setStatus(found);
      // The page it is already on (a browser opened before, or by an agent): its address until the stream says another.
      if (!editing && found.url && found.url !== "about:blank") setAddress(found.url);
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
  // Frame rate applies live; a picture codec change reconnects only this viewer.
  const changed = () => void Promise.all([
    api<Status>(`/v0/browsers/${encodeURIComponent(props.id)}`),
    api<PictureSettings>(`/v0/browsers/${encodeURIComponent(props.id)}/settings`),
  ]).then(([found, settings]) => {
    if (closed) return;
    setStatus(found); name(found);
    const reconnect = picture.settings.codec !== settings.settings.codec || picture.video !== settings.video;
    picture = settings;
    const nowDirect = props.id === "hub" && settings.settings.direct === true;
    if (nowDirect !== direct()) { setDirect(nowDirect); if (nowDirect) socket?.close(); else void connect(); return; }
    if (reconnect) { jpegOnly = false; socket?.close(); }
    else if (found.fps) send({ type: "config", maxFps: found.fps });
  }).catch(() => {});
  window.addEventListener("conduit:browser-changed", changed);
  onCleanup(() => { closed = true; generation++; pending = null; closeDecoder(); cancelAnimationFrame(moving); socket?.close(); window.removeEventListener("conduit:browser-changed", changed); });

  const go = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape") { editing = false; setAddress(status()?.url && status()!.url !== "about:blank" ? status()!.url! : ""); event.currentTarget.blur(); return; }
    if (event.key !== "Enter") return;
    const url = addressOf(event.currentTarget.value);
    if (!url) return;
    editing = false;
    setAddress(url);
    event.currentTarget.blur();
    if (direct()) return void setDirectUrl(url);
    void act("open", url);
    screen?.focus();
  };

  return <>
    {props.header}
    <WebView label="Hub browser">
      <ToolBar>
        <IconButton label="Back" onClick={() => direct() ? directFrame && proxyBack(directFrame) : void act("back")}><Icons.Back /></IconButton>
        <IconButton label="Forward" onClick={() => direct() ? directFrame && proxyForward(directFrame) : void act("forward")}><Icons.Forward /></IconButton>
        <IconButton label="Reload" onClick={() => direct() ? directFrame && proxyReload(directFrame) : void act("reload")}><Icons.Refresh /></IconButton>
        <LeadInput kind="web" aria-label="Address" placeholder="Search or type an address" value={address()} lead={address().startsWith("https://") ? <Icons.Lock /> : <Icons.Browser />}
          onFocus={(event) => { editing = true; event.currentTarget.select(); }} onBlur={() => { editing = false; }}
          onInput={(event) => setAddress(event.currentTarget.value)} onKeyDown={go} />
      </ToolBar>
      <Show when={!(direct() && directUrl())} fallback={<BrowserProxyView url={directUrl()} onFrame={(frame) => { directFrame = frame; }}
        onPage={(page) => { if (!editing) setAddress(page.url); props.onTitle?.(page.title || new URL(page.url).host); }} />}>
      <WebScreen ref={(element: HTMLDivElement) => { screen = element; }} canvas={(element) => { canvas = element; }} live={live() && !blank()} aria-label="Page"
        state={blank() ? "Type an address or a search above." : state()?.text} tone={blank() ? "quiet" : state()?.tone} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerMove={onPointerMove}
        onWheel={onWheel} onKeyDown={(event) => key("keyDown", event)} onKeyUp={(event) => key("keyUp", event)} onPaste={onPaste}
        onContextMenu={(event) => event.preventDefault()} />
      </Show>
    </WebView>
  </>;
}
