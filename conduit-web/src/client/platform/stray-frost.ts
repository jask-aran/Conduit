import { clientBuild } from "./build-info.ts";

/**
 * A temporary watch for a frost seen parked below the phone composer's row ("under the nav bar"), which no headless
 * state reproduces. Builds that are not releases, phone layout only: twice a second, any visible frost whose top is
 * below the row is outlined, and a note at the top of the screen names it (screenshot the note). Remove once found.
 */
export function watchStrayFrost() {
  if (clientBuild.release || typeof document === "undefined") return;
  const seen = new Set<Element>();
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
  setInterval(() => {
    const row = document.querySelector(".ui-phone-row");
    if (!row || document.hidden) return;
    const floor = row.getBoundingClientRect().bottom - 2;
    for (const element of document.querySelectorAll('[data-surface="frost"], .ui-frost')) {
      if (seen.has(element) || element.closest(".ui-phone-row")) continue;
      const r = element.getBoundingClientRect();
      if (r.top < floor || r.width < 60 || r.height < 8) continue;
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      seen.add(element);
      (element as HTMLElement).style.outline = "2px solid red";
      note ??= Object.assign(document.body.appendChild(document.createElement("pre")), { onclick: () => { note?.remove(); note = undefined; } });
      note.style.cssText = "position:fixed;z-index:2147483647;top:env(safe-area-inset-top,0px);left:0;right:0;margin:0;padding:8px;background:#400;color:#fff;font:11px/1.35 monospace;white-space:pre-wrap;max-height:40vh;overflow:auto";
      note.textContent = `Stray frost (tap to close)\n${describe(element)}\n\n${note.textContent?.replace(/^Stray frost \(tap to close\)\n/, "") ?? ""}`;
      console.warn("[stray-frost]", describe(element), element);
    }
  }, 500);
}
