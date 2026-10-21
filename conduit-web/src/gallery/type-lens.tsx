import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { TYPE_ROLES, type TypeSig, type TypeRole } from "./foundations";

const sizes: TypeSig["size"][] = ["label", "caption", "row", "body", "heading", "display"];
const weights: Record<string, string> = { "400": "rest", "500": "lift", "600": "strong", "660": "current" };
const excluded = ".g-rail, .g-bar, .g-lens-legend, .g-lens-layer, .g-lens-probe";
const palette = ["#f6bd60", "#84dcc6", "#c6a0f6", "#f5a9b8", "#91d7e3", "#eed49f", "#a6da95", "#f5bde6", "#8aadf4", "#f0a080", "#c4db75", "#b7bdf8", "#73c9ae"];
const colour = (name: string) => name === "Unnamed" ? "#ff5858" : palette[Math.max(0, TYPE_ROLES.findIndex((role) => role.name === name)) % palette.length] ?? "#f6bd60";
const layerStyle = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
type TextInfo = { roles: TypeRole[]; name: string; size: string; weight: string; face: string; caps: boolean; style: CSSStyleDeclaration; rect: DOMRect };
type Scope = { doc: Document; frame?: HTMLIFrameElement; layer: HTMLDivElement; card: HTMLDivElement; boxes: HTMLDivElement; observer: MutationObserver; texts: Map<Element, TextInfo>; cache: Map<string, number[]>; dispose: () => void };

// Counts use the visible part of a piece, including its scrolling pane.
function onScreen(el: Element, doc: Document) {
  const view = doc.defaultView;
  if (!view || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = el.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
  if (!rect.width || !rect.height) return false;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent), clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
  }
  return right > left && bottom > top;
}

function classify(el: Element, scope: Scope): TextInfo | undefined {
  const view = scope.doc.defaultView, parent = el.parentElement;
  if (!view || !parent) return;
  const style = view.getComputedStyle(el);
  const key = JSON.stringify([el.closest("[data-density]")?.getAttribute("data-density") ?? "root", !!el.closest(".ui-transcript, .ui-read, .ui-bubble, .ui-answer")]);
  let pixels = scope.cache.get(key);
  if (!pixels) {
    const probe = scope.doc.createElement("span");
    probe.className = "g-lens-probe";
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;";
    parent.append(probe);
    pixels = sizes.map((size) => { probe.style.fontSize = `var(--text-${size})`; return parseFloat(view.getComputedStyle(probe).fontSize); });
    probe.remove();
    scope.cache.set(key, pixels);
  }
  const px = parseFloat(style.fontSize);
  const size = sizes.find((_, index) => Math.abs(px - (pixels[index] ?? NaN)) <= .3) ?? `off-scale ${px}px`;
  const weight = weights[style.fontWeight] ?? style.fontWeight;
  const face = style.fontFamily.includes("Paper Mono") ? "mono" : "sans";
  const caps = style.textTransform === "uppercase";
  const roles = TYPE_ROLES.filter(({ sig }) => sig && sig.size === size && sig.weight === weight && sig.face === face && !!sig.caps === caps);
  return { roles, name: roles.map((role) => role.name).join(" / ") || "Unnamed", size, weight, face, caps, style, rect: el.getBoundingClientRect() };
}

export function TypeLens(props: { on: boolean; frames: () => HTMLIFrameElement[] }) {
  const [counts, setCounts] = createSignal<[string, number][]>([]);
  const [isolated, setIsolated] = createSignal<string | null>(null);
  let schedule = () => {};
  createEffect(() => { isolated(); schedule(); });
  createEffect(() => {
    if (!props.on) return;
    const scopes = new Map<Document, Scope>();
    const loads = new Map<HTMLIFrameElement, () => void>();
    let pending = 0, stopped = false;
    const observe = (scope: Scope) => scope.observer.observe(scope.doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-density"] });
    const request = () => { if (!stopped && !pending) pending = requestAnimationFrame(draw); };
    schedule = request;
    const tune = () => { for (const scope of scopes.values()) scope.cache.clear(); request(); };
    const attach = (doc: Document, frame?: HTMLIFrameElement) => {
      if (scopes.has(doc) || !doc.body) return;
      const layer = doc.createElement("div"), boxes = doc.createElement("div"), card = doc.createElement("div");
      layer.className = "g-lens-layer";
      layer.style.cssText = layerStyle;
      layer.setAttribute("aria-hidden", "true");
      card.className = "g-lens-detail";
      card.style.cssText = "display:none;position:fixed;max-width:320px;padding:8px 10px;border:1px solid #666;border-radius:6px;background:#18191c;color:#fff;font:11px/1.45 system-ui;white-space:pre-line;overflow-wrap:anywhere;box-shadow:0 4px 16px #0008;";
      layer.append(boxes, card);
      doc.body.append(layer);
      const observer = new MutationObserver((records) => {
        if (records.some((record) => {
          const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          return !(el && "closest" in el && typeof el.closest === "function" && el.closest(excluded));
        })) request();
      });
      const move = (event: PointerEvent) => {
        let el = doc.elementFromPoint(event.clientX, event.clientY);
        while (el && !scope.texts.has(el)) el = el.parentElement;
        const info = el ? scope.texts.get(el) : undefined;
        if (!info || (isolated() && !matches(info, isolated()))) { card.style.display = "none"; return; }
        const font = info.style.fontFamily.split(",")[0]?.trim().replace(/["']/g, "");
        card.textContent = `${info.name}\n${info.style.fontSize} / ${info.style.lineHeight} · ${info.style.fontWeight} · ${font}${info.caps ? " · caps" : ""}\n${info.size.startsWith("off-scale") ? info.size : `--text-${info.size}`} · ${weights[info.style.fontWeight] ? `--weight-${info.weight}` : info.weight} · ${info.face}${info.roles.length ? `\n${info.roles.map((role) => role.where).join("\n")}` : ""}`;
        card.style.display = "block";
        const view = doc.defaultView;
        card.style.left = `${Math.max(0, Math.min(event.clientX + 12, (view?.innerWidth ?? 0) - card.offsetWidth - 8))}px`;
        card.style.top = `${Math.max(0, Math.min(event.clientY + 12, (view?.innerHeight ?? 0) - card.offsetHeight - 8))}px`;
      };
      const hide = () => { card.style.display = "none"; };
      const scope: Scope = { doc, frame, layer, card, boxes, observer, texts: new Map(), cache: new Map(), dispose: () => {
        observer.disconnect(); layer.remove(); doc.removeEventListener("scroll", request, true); doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerleave", hide); doc.defaultView?.removeEventListener("resize", request); doc.defaultView?.removeEventListener("gallery:tune", tune);
      } };
      scopes.set(doc, scope);
      observe(scope);
      doc.addEventListener("scroll", request, true);
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerleave", hide);
      doc.defaultView?.addEventListener("resize", request);
      doc.defaultView?.addEventListener("gallery:tune", tune);
      void doc.fonts.ready.then(request);
    };
    const matches = (info: TextInfo, name: string | null) => !name || (name === "Unnamed" ? !info.roles.length : info.roles.some((role) => role.name === name));
    function draw() {
      pending = 0;
      const frames = props.frames();
      for (const [frame, load] of loads) if (!frames.includes(frame)) { frame.removeEventListener("load", load); loads.delete(frame); }
      // A reloaded frame can reuse its window; remove old listeners before adding new ones.
      for (const [doc, scope] of scopes) {
        if (scope.frame && (!frames.includes(scope.frame) || scope.frame.contentDocument !== doc)) { scope.dispose(); scopes.delete(doc); }
      }
      for (const frame of frames) {
        if (!loads.has(frame)) { frame.addEventListener("load", request); loads.set(frame, request); }
        if (frame.contentDocument) attach(frame.contentDocument, frame);
      }
      const totals = new Map<string, number>();
      for (const [doc, scope] of scopes) {
        scope.observer.disconnect();
        scope.texts.clear();
        scope.card.style.display = "none";
        const fragment = doc.createDocumentFragment();
        if (!scope.frame || onScreen(scope.frame, document)) for (const el of doc.body.querySelectorAll("*")) {
          if (el.closest(excluded) || !el.closest('[class*="ui-"]') || !Array.from(el.childNodes).some((node) => node.nodeType === 3 && node.textContent?.trim()) || !onScreen(el, doc)) continue;
          const info = classify(el, scope);
          if (!info) continue;
          scope.texts.set(el, info);
          for (const name of info.roles.length ? info.roles.map((role) => role.name) : ["Unnamed"]) totals.set(name, (totals.get(name) ?? 0) + 1);
          if (!matches(info, isolated())) continue;
          const box = doc.createElement("div"), tag = doc.createElement("span");
          const tint = colour(info.roles.find((role) => role.name === isolated())?.name ?? info.roles[0]?.name ?? "Unnamed");
          const rect = info.rect;
          box.className = "g-lens-box";
          box.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;outline:1px ${info.roles.length ? "solid" : "dashed"} ${tint};`;
          tag.className = "g-lens-tag";
          tag.style.cssText = `position:absolute;left:0;top:0;padding:1px 3px;background:${tint};color:#111;font:9px/12px system-ui;white-space:nowrap;opacity:1;`;
          tag.textContent = info.name;
          box.append(tag); fragment.append(box);
        }
        scope.boxes.replaceChildren(fragment);
        observe(scope);
      }
      setCounts([...totals].sort(([a], [b]) => a === "Unnamed" ? -1 : b === "Unnamed" ? 1 : TYPE_ROLES.findIndex((role) => role.name === a) - TYPE_ROLES.findIndex((role) => role.name === b)));
    }
    attach(document);
    request();
    onCleanup(() => {
      stopped = true; cancelAnimationFrame(pending); schedule = () => {};
      for (const scope of scopes.values()) scope.dispose();
      for (const [frame, load] of loads) frame.removeEventListener("load", load);
    });
  });
  return <Show when={props.on}><aside class="g-lens-legend" aria-label="Type lens">
    <p>Every text on screen named by its type role (Foundations · Type). Red dashed: a combination with no role. Hover for its sizes.</p>
    <div class="g-lens-roles"><For each={counts()}>{([name, count]) => <button type="button" aria-pressed={isolated() === name} onClick={() => setIsolated(isolated() === name ? null : name)}>
      <span class="g-lens-swatch" style={{ background: colour(name) }} />{name}<span class="g-lens-count">{count}</span>
    </button>}</For></div>
  </aside></Show>;
}
