import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import { render } from "solid-js/web";
import "../client/project/dashboard.css";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "./gallery.css";
// The library's styles load with the gallery only; the app never ships them until it adopts the library.
import "@/components/ui/library.css";
import { ChatScreen } from "./stories";
import { Frost } from "@/components/ui";
import { LibraryContext } from "@/components/ui/swap";
import { SidebarScreen } from "./sidebar-story";
import { applyFaces, foundationFamilies } from "./foundations";
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
  const [preview, setPreview] = createSignal<"phone" | "sidebar" | "desktop">("phone");
  const [seen, setSeen] = createSignal(new Set<string>(["phone"]));
  createEffect(() => { const key = preview(); if (!seen().has(key)) setSeen(new Set([...seen(), key])); });
  // The app's real screens, drawn with components v2 (components/ui/swap.ts); phones in a frame that passes for one.
  const views = [
    { key: "phone", render: () => <iframe class="g-phone" title="Phone" src="/gallery.html?frame=phone" onLoad={tuneFrame} /> },
    { key: "sidebar", render: () => <iframe class="g-phone" title="Phone sidebar" src="/gallery.html?frame=sidebar" onLoad={tuneFrame} /> },
    { key: "desktop", render: () => <div ref={desktop} class="g-desktop-screen" onKeyDown={(event) => { if (event.key === "Escape") setOverlay(null); }}>
      <LibraryContext.Provider value={true}><ChatScreen /></LibraryContext.Provider>
      <Show when={overlay()} keyed>{(view) => <div class="g-desktop-overlay" onPointerDown={(event) => { if ((event.target as Element).classList.contains("ui-scrim")) setOverlay(null); }}>
        <LibraryContext.Provider value={true}>{overlayViews[view]({ close: () => setOverlay(null), class: "g-preview-scrim", ...(view === "leader" ? litComposer() : {}) })}</LibraryContext.Provider>
      </div>}</Show>
    </div> },
  ];
  const [tuning, setTuning] = createSignal(false);
  // One desktop preview; its overlays open over it from buttons, not as copies of it.
  const [overlay, setOverlay] = createSignal<OverlayView | null>(null);
  let desktop: HTMLDivElement | undefined;
  const litComposer = () => {
    const wrap = desktop?.querySelector(".composer-wrap"); if (!desktop || !wrap) return undefined;
    const frame = desktop.getBoundingClientRect(), box = wrap.getBoundingClientRect();
    return { lit: { top: `${box.top - frame.top}px`, left: `${box.left - frame.left}px`, width: `${box.width}px`, height: `${box.height}px`, radius: getComputedStyle(wrap.querySelector(".composer") ?? wrap).borderRadius },
      leaderBottom: `${frame.bottom - box.top + 12}px` };
  };
  const overlays: [OverlayView, string][] = [["leader", "Leader"], ["palette", "Command palette"], ["search", "Chat search"], ["settings", "Settings"]];
  // One family at a time, picked from the rail: Foundations (Controls among them), then the frosted families.
  const families = [...foundationFamilies, ...libraryFamilies];
  const stored = (() => { try { return localStorage.getItem("gallery:family"); } catch { return null; } })();
  const [current, setCurrent] = createSignal(families.find((family) => family.title === stored)?.title ?? libraryFamilies[0]!.title);
  let left!: HTMLElement;
  const pick = (title: string) => { setCurrent(title); left.scrollTop = 0; try { localStorage.setItem("gallery:family", title); } catch { /* private window */ } };
  const shown = () => families.filter((family) => family.title === current());
  // A staged page (Controls) draws its staged groups once, on one surface at one density, picked at its top and remembered.
  const remembered = <T extends string>(key: string, values: T[]) => { try { const value = localStorage.getItem(key) as T; return values.includes(value) ? value : values[0]!; } catch { return values[0]!; } };
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
  return <div class="g-canvas" data-preview={preview()}>
    <nav class="g-rail" aria-label="Families">
      <h1>Gallery</h1>
      <For each={rail}>{([label, families]) => <>
        <h2>{label}</h2>
        <For each={families}>{(family) => <button type="button" aria-current={current() === family.title} onClick={() => pick(family.title)}>{family.title}</button>}</For>
      </>}</For>
    </nav>
    <section class="g-left" ref={left}>
      <div class="g-bar">
        <button type="button" aria-pressed={tuning()} onClick={() => setTuning(!tuning())}>Tune CSS</button>
        <Show when={tuning()}><button type="button" onClick={() => void navigator.clipboard.writeText(tune())}>Copy</button></Show>
      </div>
      <Show when={tuning()}><textarea class="g-tune" spellcheck={false} value={tune()} onInput={(event) => update(event.currentTarget.value)}
        placeholder={".composer-surface-material[data-composer-surface=\"frosted-live\"] {\n  backdrop-filter: blur(30px);\n}"} /></Show>
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
        </div>
        <Show when={preview() === "desktop"}><div class="g-toggle" role="group" aria-label="Open over the desktop">
          <For each={overlays}>{([view, label]) => <button type="button" aria-pressed={overlay() === view} onClick={() => setOverlay(overlay() === view ? null : view)}>{label}</button>}</For>
        </div></Show>
      </div>
      {/* Every view stays mounted once opened, so switching is instant: no frame reloads. */}
      <For each={views}>{(view) => <Show when={seen().has(view.key)}>
        <div class="g-view" hidden={preview() !== view.key}>{view.render()}</div>
      </Show>}</For>
    </aside>
  </div>;
}

export function mount(frame: string | null) {
  const root = document.getElementById("root")!;
  applyFaces(document);
  // Frosted only: the static material is on its way out.
  try { localStorage.setItem("conduit:composer-surface", "frosted-live"); localStorage.setItem("conduit:phone-composer", "bar"); } catch { /* private window */ }
  // The phone screens, drawn with components v2, in a frame with a phone's root size and media rules.
  if (frame === "sidebar") { document.body.classList.add("g-solo-body"); render(() => <LibraryContext.Provider value={true}><SidebarScreen /></LibraryContext.Provider>, root); }
  else if (frame) { document.body.classList.add("g-solo-body"); render(() => <LibraryContext.Provider value={true}><ChatScreen /></LibraryContext.Provider>, root); }
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
