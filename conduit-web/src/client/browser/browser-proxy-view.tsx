import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Loading, Note } from "@/components/ui";
import { api } from "../api/client";

type ProxyPage = { proxyOrigin: string; url: string };
type View = { kind: "loading" } | { kind: "error"; message: string } | { kind: "page"; page: ProxyPage };

const command = (frame: HTMLIFrameElement, action: "back" | "forward" | "reload") => {
  if (frame.src) frame.contentWindow?.postMessage({ type: "conduit-proxy-command", command: action }, new URL(frame.src).origin);
};
export const proxyBack = (frame: HTMLIFrameElement) => command(frame, "back");
export const proxyForward = (frame: HTMLIFrameElement) => command(frame, "forward");
export const proxyReload = (frame: HTMLIFrameElement) => command(frame, "reload");

export function BrowserProxyView(props: { url: string; onPage: (page: { url: string; title: string }) => void; onFrame?: (frame: HTMLIFrameElement) => void }) {
  const [view, setView] = createSignal<View>({ kind: "loading" });
  let iframe: HTMLIFrameElement | undefined;
  createEffect(() => {
    const url = props.url;
    const abort = new AbortController();
    let active = true;
    setView({ kind: "loading" });
    void api<unknown>("/v0/browsers/proxy/open", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }), signal: abort.signal }).then((answer) => {
      if (!active) return;
      if (!answer || typeof answer !== "object" || !("proxyOrigin" in answer) || typeof answer.proxyOrigin !== "string"
        || !("url" in answer) || typeof answer.url !== "string") throw new Error("Invalid proxy response.");
      const origin = new URL(answer.proxyOrigin);
      if (origin.protocol !== "http:" || origin.origin !== answer.proxyOrigin || new URL(answer.url).origin !== origin.origin) throw new Error("Invalid proxy origin.");
      setView({ kind: "page", page: { proxyOrigin: answer.proxyOrigin, url: answer.url } });
    }).catch((error: unknown) => {
      if (active) setView({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    });
    onCleanup(() => { active = false; abort.abort(); });
  });
  const page = () => { const state = view(); return state.kind === "page" ? state.page : undefined; };
  const receive = (event: MessageEvent<unknown>) => {
    const current = page();
    if (!current || event.origin !== current.proxyOrigin || event.source !== iframe?.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== "object" || !("type" in data) || data.type !== "conduit-proxy"
      || !("url" in data) || typeof data.url !== "string" || !("title" in data) || typeof data.title !== "string") return;
    try { if (!["http:", "https:"].includes(new URL(data.url).protocol)) return; } catch { return; }
    props.onPage({ url: data.url, title: data.title });
  };
  window.addEventListener("message", receive);
  onCleanup(() => window.removeEventListener("message", receive));
  return <Show when={page()} keyed fallback={<Show when={view().kind === "loading"} fallback={
    <Note kind="browser" tone="error">{(() => { const state = view(); return state.kind === "error" ? state.message : ""; })()} Use streaming to open this page.</Note>
  }><Loading kind="browser">Opening direct page…</Loading></Show>}>
    {(current) => <iframe ref={(element) => { iframe = element; props.onFrame?.(element); }} src={current.url} title="Experimental direct page"
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads" referrerpolicy="no-referrer"
      style={{ width: "100%", height: "100%", flex: "1", "min-height": "0", border: "0" }} />}
  </Show>;
}
