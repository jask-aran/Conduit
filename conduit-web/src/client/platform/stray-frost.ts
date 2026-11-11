import { clientBuild } from "./build-info.ts";
import { api } from "../api/client";

/**
 * A temporary watch for a frost parked below the phone composer's row, which no headless state reproduces. Remove
 * once found.
 */
export function watchStrayFrost() {
  if (clientBuild.release || typeof document === "undefined") return;
  const seen = new Set<Element>();
  // Parked means where it was last tick too: a bubble scrolling past the row is below it for one sample, not two.
  let last = new Map<Element, string>();
  let note: HTMLElement | undefined;
  const describe = (element: Element) => {
    const chain: string[] = [];
    for (let node: Element | null = element; node && chain.length < 4; node = node.parentElement) {
      const data = [...node.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-surface").map((a) => a.value ? `${a.name}=${a.value}` : a.name);
      chain.push(`${node.tagName.toLowerCase()}.${[...node.classList].join(".")}${data.length ? `[${data.join(" ")}]` : ""}`);
    }
    const r = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const motion = element.getAnimations({ subtree: false }).map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "script").join(",");
    return `${new Date().toLocaleTimeString()} · ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} of ${innerWidth}×${innerHeight} · op ${style.opacity} · tf ${style.transform} · ${motion || "still"}\n${chain.join("\n  < ")}`;
  };
  const scrolledPast = (element: Element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return true;
    }
    return false;
  };
  const report = (element: Element, said: string) => {
    const r = element.getBoundingClientRect();
    const around = (node: Element | null) => node ? { tag: node.tagName.toLowerCase(), class: node.className.toString(), rect: (({ left, top, width, height }) => ({ left, top, width, height }))(node.getBoundingClientRect()) } : null;
    const body = {
      build: clientBuild, url: location.pathname, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visual: visualViewport ? { height: visualViewport.height, offsetTop: visualViewport.offsetTop } : null },
      said, rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      style: (({ opacity, transform, translate, position, display, visibility }) => ({ opacity, transform, translate, position, display, visibility }))(getComputedStyle(element)),
      animations: element.getAnimations({ subtree: true }).map((a) => ({ name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "script", state: a.playState, time: a.currentTime })),
      html: element.outerHTML.slice(0, 6000),
      parents: (() => { const out = []; for (let node = element.parentElement; node && out.length < 10; node = node.parentElement) out.push(around(node)); return out; })(),
      row: around(document.querySelector(".ui-phone-row")), composer: document.querySelector(".ui-phone-composer")?.getAttribute("data-state") ?? null,
      keyboard: document.documentElement.style.getPropertyValue("--keyboard-height") || null,
    };
    void api("/v0/client-reports/stray-frost", { method: "POST", body: JSON.stringify(body) }).catch(() => undefined);
  };
  // In idle time: reading boxes lays the page out, which costs a frame mid-move.
  const idle = (run: () => void) => "requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run);
  setInterval(() => idle(() => {
    const row = document.querySelector(".ui-phone-row");
    if (!row || document.hidden) return;
    const floor = row.getBoundingClientRect().bottom - 2;
    const now = new Map<Element, string>();
    for (const element of document.querySelectorAll('[data-surface="frost"], .ui-frost')) {
      if (seen.has(element) || element.closest(".ui-phone-row")) continue;
      const r = element.getBoundingClientRect();
      // Below the screen is scrolled out of view, not parked under the row.
      if (r.top < floor || r.top >= innerHeight || r.width < 60 || r.height < 8) continue;
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      // Content that scrolls under the composer is not parked: its scroller goes on below it.
      if (scrolledPast(element)) continue;
      const at = `${r.left},${r.top}`;
      now.set(element, at);
      if (last.get(element) !== at) continue;
      seen.add(element);
      (element as HTMLElement).style.outline = "2px solid red";
      note ??= Object.assign(document.body.appendChild(document.createElement("pre")), { onclick: () => { note?.remove(); note = undefined; } });
      note.style.cssText = "position:fixed;z-index:2147483647;top:env(safe-area-inset-top,0px);left:0;right:0;margin:0;padding:8px;background:#400;color:#fff;font:11px/1.35 monospace;white-space:pre-wrap;max-height:40vh;overflow:auto";
      note.textContent = `Stray frost (tap to close)\n${describe(element)}\n\n${note.textContent?.replace(/^Stray frost \(tap to close\)\n/, "") ?? ""}`;
      console.warn("[stray-frost]", describe(element), element);
      report(element, describe(element));
    }
    last = now;
  }), 500);
}
