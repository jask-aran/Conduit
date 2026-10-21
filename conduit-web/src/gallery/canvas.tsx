import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { render } from "solid-js/web";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "./gallery.css";
import "@/components/ui/styles";
import { ChatScreen } from "./stories";
import { NavGroup, NavRow, Frost } from "@/components/ui";
import { SidebarScreen } from "./sidebar-story";
import { TypeLens } from "./type-lens";

// The gallery is all library: its rules that the app keeps to library pieces (no focus ring) hold on the whole page.
document.documentElement.setAttribute("data-library", "");
import { applyFaces, applyScale, foundationFamilies } from "./foundations";
import { libraryFamilies, overlayViews, type Atom, type OverlayView } from "./library";

/*
 * Components v2 (components/ui) on the left, by family: the base piece, its
 * constituents, then the app's pieces assembled from them. On the right the
 * app's own screens, desktop or phone, drawn with components v2. The tuning
 * box applies CSS everywhere at once and never writes source.
 */

const TUNE_KEY = "conduit:gallery-tune";
const read = () => { try { return localStorage.getItem(TUNE_KEY) || ""; } catch { return ""; } };

function applyTune(doc: Document, css: string) {
  let style = doc.getElementById("gallery-tune");
  if (!style) { style = doc.createElement("style"); style.id = "gallery-tune"; }
  doc.head.append(style);
  style.textContent = css;
}
const SPEEDS = [1, .5, .25, .1];
const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
const tuneFrame = (event: Event) => { const doc = (event.currentTarget as HTMLIFrameElement).contentDocument; if (doc) applyTune(doc, read()); };

type Density = "desktop" | "phone";
type Surface = "ground" | "frost";
/** The surface a staged cell is drawn on: the ground, or a raised frost. */
const OnSurface = (props: { surface: Surface; children: () => JSX.Element }) => <>{props.surface === "frost"
  ? <Frost lift="raised" class="g-surface g-stage-surface">{props.children()}</Frost>
  : <div class="g-surface g-stage-surface" data-surface="ground">{props.children()}</div>}</>;

/** A cell. A piece used in both layouts gets a toggle to draw it at either; fixed: drawn at that layout only; surface: drawn on it. */
function Piece(props: { atom: Atom; fixed?: Density; surface?: Surface }) {
  const toggles = () => !props.fixed && props.atom.scope === "both";
  const [own, setDensity] = createSignal<Density>(props.atom.scope === "phone" ? "phone" : "desktop");
  const density = () => props.fixed ?? own();
  return <figure class="g-cell" id={props.atom.id} data-wide={props.atom.wide === "row" ? "row" : props.atom.wide ? "" : undefined}>
    <figcaption class="g-tag" title={props.atom.source}><strong>{props.atom.name}</strong><span data-scope={props.atom.scope}>{props.atom.scope === "both" ? "desktop + phone" : props.atom.scope + " only"}</span><span data-kind={props.atom.kind}>{props.atom.kind}</span></figcaption>
    <Show when={toggles()}><div class="g-cell-toggle" role="group" aria-label="Layout">
      <button type="button" aria-pressed={density() === "desktop"} onClick={() => setDensity("desktop")}>Desktop</button>
      <button type="button" aria-pressed={density() === "phone"} onClick={() => setDensity("phone")}>Phone</button>
    </div></Show>
    <div class="g-cell-body" data-density={density()}>{props.surface ? <OnSurface surface={props.surface}>{() => props.atom.render()}</OnSurface> : props.atom.render()}</div>
  </figure>;
}

function Canvas() {
  const [tune, setTune] = createSignal(read());
  const [preview, setPreview] = createSignal<"phone" | "sidebar" | "desktop" | "live">("phone");
  // gallery.html?live=<chat id>: a phone on that real chat, from the server (live-chat.tsx).
  const liveChat = new URLSearchParams(location.search).get("live");
  const [seen, setSeen] = createSignal(new Set<string>(["phone"]));
  createEffect(() => { const key = preview(); if (!seen().has(key)) setSeen(new Set([...seen(), key])); });
  // The app's real screens, drawn with components v2 (components/ui/swap.ts); phones in a frame that passes for one.
  const views = [
    { key: "phone", render: () => <iframe class="g-phone" title="Phone" src="gallery.html?frame=phone" onLoad={tuneFrame} /> },
    { key: "live", render: () => <iframe class="g-phone" title="Phone live" src={`http://127.0.0.1:${location.port}/gallery.html?frame=live&chat=${encodeURIComponent(liveChat ?? "")}`} onLoad={tuneFrame} /> },
    { key: "sidebar", render: () => <iframe class="g-phone" title="Phone sidebar" src="gallery.html?frame=sidebar" onLoad={tuneFrame} /> },
    { key: "desktop", render: () => <div ref={desktop} class="g-desktop-screen" onKeyDown={(event) => { if (event.key === "Escape") setOverlay(null); }}>
      <ChatScreen />
      <Show when={overlay()} keyed>{(view) => <div class="g-desktop-overlay" onPointerDown={(event) => { if ((event.target as Element).classList.contains("ui-scrim")) setOverlay(null); }}>
        {overlayViews[view]({ close: () => setOverlay(null), class: "g-preview-scrim", ...(view === "leader" ? litComposer() : {}) })}
      </div>}</Show>
    </div> },
  ];
  const [tuning, setTuning] = createSignal(false);
  // One desktop preview; its overlays open over it from buttons, not as copies of it.
  const [overlay, setOverlay] = createSignal<OverlayView | null>(null);
  let desktop: HTMLDivElement | undefined;
  const litComposer = () => {
    const wrap = desktop?.querySelector(".ui-desktop-composer"); if (!desktop || !wrap) return undefined;
    const frame = desktop.getBoundingClientRect(), box = wrap.getBoundingClientRect();
    return { lit: { top: `${box.top - frame.top}px`, left: `${box.left - frame.left}px`, width: `${box.width}px`, height: `${box.height}px`, radius: getComputedStyle(wrap).borderRadius },
      leaderBottom: `${frame.bottom - box.top + 12}px` };
  };
  const overlays: [OverlayView, string][] = [["leader", "Leader"], ["palette", "Command palette"], ["search", "Chat search"], ["settings", "Settings"]];
  // The phone's overlays open full screen inside its frame; the leader is a desktop key.
  const phoneOverlays = overlays.filter(([view]) => view !== "leader");
  const [phoneOverlay, setPhoneOverlay] = createSignal<OverlayView | null>(null);
  const phoneFrame = () => document.querySelector<HTMLIFrameElement>('iframe[title="Phone"]');
  const openOnPhone = (view: OverlayView | null) => { setPhoneOverlay(view); phoneFrame()?.contentWindow?.postMessage({ galleryOverlay: view }, location.origin); };
  addEventListener("message", (event) => { if (event.origin === location.origin && event.data?.galleryOverlayClosed) setPhoneOverlay(null); });
  // One family at a time, picked from the rail: Foundations (Controls among them), the frosted families, then the Transcript.
  const families = [...foundationFamilies, ...libraryFamilies];
  const stored = (() => { try { return localStorage.getItem("gallery:family"); } catch { return null; } })();
  const [current, setCurrent] = createSignal(families.find((family) => family.title === stored)?.title ?? libraryFamilies[0]!.title);
  let left!: HTMLElement;
  const pick = (title: string) => { setCurrent(title); left.scrollTop = 0; try { localStorage.setItem("gallery:family", title); } catch { /* private window */ } };
  const shown = () => families.filter((family) => family.title === current());
  // A staged page (Controls) draws its staged groups once, on one surface at one density, picked at its top and remembered.
  const remembered = <T extends string>(key: string, values: T[]) => { try { const value = localStorage.getItem(key) as T; return values.includes(value) ? value : values[0]!; } catch { return values[0]!; } };
  const [lens, setLens] = createSignal(remembered("gallery:type-lens", ["false", "true"]) === "true");
  const toggleLens = () => { const value = !lens(); setLens(value); try { localStorage.setItem("gallery:type-lens", String(value)); } catch { /* private window */ } };
  const [surface, setSurface] = createSignal(remembered<Surface>("gallery:stage-surface", ["ground", "frost"]));
  const [stageDensity, setStageDensity] = createSignal(remembered<Density>("gallery:stage-density", ["desktop", "phone"]));
  const stage = <T extends string>(set: (value: T) => void, key: string) => (value: T) => { set(value); try { localStorage.setItem(key, value); } catch { /* private window */ } };
  const pickSurface = stage(setSurface, "gallery:stage-surface"), pickDensity = stage(setStageDensity, "gallery:stage-density");
  // A piece for one layout only keeps it on a staged page.
  const staged = (atom: Atom): Density => atom.scope === "both" ? stageDensity() : atom.scope;
  const rail = [...new Set(families.map((family) => family.rail ?? "Frosted"))].map((label) => [label, families.filter((family) => (family.rail ?? "Frosted") === label)] as const);
  const update = (css: string) => {
    setTune(css);
    try { localStorage.setItem(TUNE_KEY, css); } catch { /* private window */ }
    applyTune(document, css);
    for (const frame of frames()) if (frame.contentDocument) applyTune(frame.contentDocument, css);
    dispatchEvent(new Event("gallery:tune"));
  };
  applyTune(document, tune());
  // Animation speed: every animation and transition here and in the previews plays at the picked rate (each new one
  // is caught on the frame after it starts), so a move can be watched slowly. Remembered on this browser.
  const [speed, setSpeed] = createSignal<number>((() => { try { const rate = Number(localStorage.getItem("gallery:speed")); return SPEEDS.includes(rate) ? rate : 1; } catch { return 1; } })());
  createEffect(() => {
    const rate = speed();
    try { localStorage.setItem("gallery:speed", String(rate)); } catch { /* this session only */ }
    let frame = 0;
    const tick = () => {
      for (const doc of [document, ...frames().map((iframe) => iframe.contentDocument)]) doc?.getAnimations().forEach((animation) => { if (animation.playbackRate !== rate) animation.playbackRate = rate; });
      if (rate !== 1) frame = requestAnimationFrame(tick);
    };
    tick();
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return <div class="g-canvas" data-preview={preview()}>
    <TypeLens on={lens()} frames={frames} />
    {/* The rail is drawn as the sidebar is, with the library's NavGroups and NavRows, at the desktop's density. */}
    <nav class="g-rail" aria-label="Families" data-density="desktop">
      <div class="g-rail-head"><strong>Gallery</strong><small>components v2</small></div>
      <For each={rail}>{([label, families]) => <NavGroup label={label}>
        <For each={families}>{(family) => <NavRow current={current() === family.title} onClick={() => pick(family.title)}>{family.title}</NavRow>}</For>
      </NavGroup>}</For>
    </nav>
    <section class="g-left" ref={left}>
      <div class="g-bar">
        <button type="button" aria-pressed={tuning()} onClick={() => setTuning(!tuning())}>Tune CSS</button>
        <button type="button" aria-pressed={lens()} onClick={toggleLens}>Type lens</button>
        <Show when={tuning()}><button type="button" onClick={() => void navigator.clipboard.writeText(tune())}>Copy</button></Show>
        <div class="g-toggle g-speed" role="group" aria-label="Animation speed"><span>Speed</span>
          <For each={SPEEDS}>{(rate) => <button type="button" aria-pressed={speed() === rate} onClick={() => setSpeed(rate)}>{rate}×</button>}</For>
        </div>
      </div>
      <Show when={tuning()}><textarea class="g-tune" spellcheck={false} value={tune()} onInput={(event) => update(event.currentTarget.value)}
        placeholder={".ui-frost {\n  backdrop-filter: blur(30px);\n}"} /></Show>
      <For each={shown()}>{(family) => <section class="g-family">
        <h2 class="g-family-title">{family.title} <small>{family.note}</small></h2>
        <Show when={family.stage}><div class="g-stage">
          <div class="g-toggle" role="group" aria-label="Surface">
            <For each={["ground", "frost"] as Surface[]}>{(value) => <button type="button" aria-pressed={surface() === value} onClick={() => pickSurface(value)}>{value === "ground" ? "Ground" : "Frost"}</button>}</For>
          </div>
          <div class="g-toggle" role="group" aria-label="Density">
            <For each={["desktop", "phone"] as Density[]}>{(value) => <button type="button" aria-pressed={stageDensity() === value} onClick={() => pickDensity(value)}>{value === "desktop" ? "Desktop" : "Phone"}</button>}</For>
          </div>
        </div></Show>
        <For each={family.groups}>{(group) => <>
          <Show when={group.title}><h3 class="g-heading">{group.title} <small>{group.note}</small></h3></Show>
          <div class="g-grid g-dense"><For each={group.atoms}>{(atom) => <Piece atom={atom} fixed={group.staged ? staged(atom) : group.layout} surface={group.staged === true ? surface() : undefined} />}</For></div>
        </>}</For>
      </section>}</For>
    </section>
    <aside class="g-right">
      <div class="g-toggles">
        <div class="g-toggle" role="group" aria-label="Preview">
          <button type="button" aria-pressed={preview() === "phone"} onClick={() => setPreview("phone")}>Phone</button>
          <button type="button" aria-pressed={preview() === "sidebar"} onClick={() => setPreview("sidebar")}>Phone sidebar</button>
          <button type="button" aria-pressed={preview() === "desktop"} onClick={() => setPreview("desktop")}>Desktop</button>
          <Show when={liveChat}><button type="button" aria-pressed={preview() === "live"} onClick={() => setPreview("live")}>Phone · live chat</button></Show>
        </div>
        <Show when={preview() === "desktop"}><div class="g-toggle" role="group" aria-label="Open over the desktop">
          <For each={overlays}>{([view, label]) => <button type="button" aria-pressed={overlay() === view} onClick={() => setOverlay(overlay() === view ? null : view)}>{label}</button>}</For>
        </div></Show>
        <Show when={preview() === "phone"}><div class="g-toggle" role="group" aria-label="Open over the phone">
          <For each={phoneOverlays}>{([view, label]) => <button type="button" aria-pressed={phoneOverlay() === view} onClick={() => openOnPhone(phoneOverlay() === view ? null : view)}>{label}</button>}</For>
        </div></Show>
      </div>
      {/* Every view stays mounted once opened, so switching is instant: no frame reloads. */}
      <For each={views}>{(view) => <Show when={seen().has(view.key)}>
        <div class="g-view" hidden={preview() !== view.key}>{view.render()}</div>
      </Show>}</For>
    </aside>
  </div>;
}

/** In the phone frame: the overlay the gallery opened, full screen over the chat; closing tells the gallery. */
function PhoneOverlay() {
  const [view, setView] = createSignal<OverlayView | null>(null);
  addEventListener("message", (event) => { if (event.origin === location.origin && "galleryOverlay" in (event.data ?? {})) setView(event.data.galleryOverlay); });
  const close = () => { setView(null); parent.postMessage({ galleryOverlayClosed: true }, location.origin); };
  return <Show when={view()} keyed>{(open) => <div class="g-phone-overlay" data-density="phone" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    {overlayViews[open]({ close, phone: true })}
  </div>}</Show>;
}

export function mount(frame: string | null) {
  const root = document.getElementById("root")!;
  applyFaces(document);
  applyScale(document);
  // The phone screens, drawn with components v2, in a frame with a phone's root size and media rules.
  if (frame === "sidebar") { document.body.classList.add("g-solo-body"); render(() => <SidebarScreen />, root); }
  else if (frame === "live") { document.body.classList.add("g-solo-body"); const chat = new URLSearchParams(location.search).get("chat") ?? ""; void import("./live-chat").then(({ LiveChatScreen }) => render(() => <LiveChatScreen chatId={chat} />, root)); }
  else if (frame) { document.body.classList.add("g-solo-body"); render(() => <><ChatScreen /><PhoneOverlay /></>, root); }
  else {
    render(() => <Canvas />, root);
    // The chat screens scroll themselves to their latest message as they
    // mount, which pulls the gallery to the bottom; hold it at the top until
    // the first thing the viewer does.
    const left = () => document.querySelector<HTMLElement>(".g-left");
    const hold = () => { left()?.scrollTo(0, 0); window.scrollTo(0, 0); };
    const stop = () => { clearInterval(timer); for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) removeEventListener(type, stop, true); };
    const timer = setInterval(hold, 50);
    setTimeout(stop, 2500);
    for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) addEventListener(type, stop, true);
  }
}
