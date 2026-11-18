import { createEffect, on, onCleanup, onMount } from "solid-js";

/* Not in the library's barrel: only an open thread draws one, so the app's first load does not carry it. */
/**
 * A message's own HTML, as its sender made it, at its full height in the reading column. The frame is the boundary: it
 * runs no script and submits no form, its policy lets nothing load but pictures when `images` says so, and its base
 * address sends a relative address nowhere (the frame shares the app's origin only so its height can be read, so one
 * left to resolve would reach the hub). A link pressed in it is handed to `onLink` and never followed in the frame.
 */
export function MailPage(props: { html: string; images?: boolean; title: string; onLink(url: string): void }) {
  let frame: HTMLIFrameElement | undefined;
  const watch = new ResizeObserver(() => fit());
  // A page made wider than the column (a newsletter's fixed table) is drawn smaller, whole, never cut off.
  const fit = () => {
    const page = frame?.contentDocument?.documentElement;
    if (!frame || !page) return;
    page.style.zoom = "1";
    const scale = Math.min(1, frame.clientWidth / page.scrollWidth);
    page.style.zoom = String(scale);
    frame.style.height = `${Math.ceil(page.scrollHeight * scale)}px`;
  };
  // The frame's load waits for every picture: it is fitted as soon as its page is there, and again as it grows.
  let wired: Document | undefined, early: ReturnType<typeof setInterval> | undefined;
  const begin = () => { clearInterval(early); let tries = 0; early = setInterval(() => { ready(); if (++tries > 50 || frame?.contentDocument?.readyState === "complete") clearInterval(early); }, 100); };
  onCleanup(() => clearInterval(early));
  onMount(() => { watch.observe(frame!); begin(); });
  createEffect(on(() => [props.html, props.images], begin, { defer: true }));
  const ready = () => {
    const page = frame?.contentDocument;
    if (!page?.body || page.URL !== "about:srcdoc") return;
    if (wired === page) return fit();
    wired = page;
    watch.disconnect(); watch.observe(page.body);
    page.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      event.preventDefault();
      const url = link?.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(url)) props.onLink(url);
    });
    // The pane's keys (Escape, its arrows) work with the keyboard in the message.
    page.addEventListener("keydown", (event) => { if (event.key === "Escape") frame!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    page.addEventListener("load", fit, true);
    fit();
  };
  onCleanup(() => watch.disconnect());
  // With pictures on, one addressed to the hub itself would be fetched with the person's session: its address is broken.
  const source = () => `<!doctype html><meta charset="utf-8"><base href="about:blank"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; img-src data:${props.images ? " https:" : ""}">`
    + `<style>html{background:#fff;color:#1a1a1a;font:14px/1.5 system-ui,sans-serif;color-scheme:light}body{margin:0;padding:12px 16px;overflow-wrap:anywhere}img{max-width:100%}${props.images ? "" : "img{display:none!important}"}</style>${props.images ? props.html.replaceAll(location.host, "hub.invalid") : props.html}`;
  return <iframe ref={frame} class="ui-mail-page" title={props.title} sandbox="allow-same-origin" scrolling="no" srcdoc={source()} onLoad={ready} />;
}
