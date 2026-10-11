import { createEffect, createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import "../client/project/dashboard.css";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "./gallery.css";
import { ChatScreen } from "./stories";
import { LibraryContext } from "@/components/ui/swap";
import { SidebarScreen } from "./sidebar-story";
import { atoms, phoneAtoms, type Atom } from "./atoms";
import { libraryFamilies } from "./library";

/*
 * Components on the left, each centred in a cell of one grid with a bubble
 * naming it, primitives first. The preview on the right is the app's
 * own chat screen, desktop or phone. Phone-only pieces sit in a frame of this
 * page that passes for a phone (phone-emulation.ts). The tuning box applies CSS
 * everywhere at once and never writes source.
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

/** A cell. A piece used in both layouts gets a toggle to draw it at either; fixed: drawn at that layout only. */
function Piece(props: { atom: Atom; fixed?: "desktop" | "phone" }) {
  const toggles = () => !props.fixed && props.atom.scope === "both";
  const [density, setDensity] = createSignal<"desktop" | "phone">(props.fixed ?? (props.atom.scope === "phone" ? "phone" : "desktop"));
  return <figure class="g-cell" id={props.atom.id} data-wide={props.atom.wide ? "" : undefined}>
    <figcaption class="g-tag" title={props.atom.source}><strong>{props.atom.name}</strong><span data-scope={props.atom.scope}>{props.atom.scope === "both" ? "desktop + phone" : props.atom.scope + " only"}</span><span data-kind={props.atom.kind}>{props.atom.kind}</span></figcaption>
    <Show when={toggles()}><div class="g-cell-toggle" role="group" aria-label="Layout">
      <button type="button" aria-pressed={density() === "desktop"} onClick={() => setDensity("desktop")}>Desktop</button>
      <button type="button" aria-pressed={density() === "phone"} onClick={() => setDensity("phone")}>Phone</button>
    </div></Show>
    <div class="g-cell-body" data-density={density()}>{props.atom.render()}</div>
  </figure>;
}

function Canvas() {
  const [tune, setTune] = createSignal(read());
  const [preview, setPreview] = createSignal<"phone" | "sidebar" | "desktop">("phone");
  const [source, setSource] = createSignal<"live" | "library">("live");
  const [seen, setSeen] = createSignal(new Set<string>(["phone-live"]));
  createEffect(() => { const key = `${preview()}-${source()}`; if (!seen().has(key)) setSeen(new Set([...seen(), key])); });
  const views = [
    { key: "phone-live", render: () => <iframe class="g-phone" title="Phone" src="/gallery.html?frame=phone" onLoad={tuneFrame} /> },
    { key: "sidebar-live", render: () => <iframe class="g-phone" title="Phone sidebar" src="/gallery.html?frame=sidebar" onLoad={tuneFrame} /> },
    { key: "desktop-live", render: () => <div class="g-desktop-screen"><ChatScreen /></div> },
    { key: "phone-library", render: () => <iframe class="g-phone" title="Phone · library" src="/gallery.html?frame=library-phone" onLoad={tuneFrame} /> },
    { key: "sidebar-library", render: () => <iframe class="g-phone" title="Phone sidebar · library" src="/gallery.html?frame=library-sidebar" onLoad={tuneFrame} /> },
    { key: "desktop-library", render: () => <div class="g-desktop-screen"><LibraryContext.Provider value={true}><ChatScreen /></LibraryContext.Provider></div> },
  ];
  const [tuning, setTuning] = createSignal(false);
  const update = (css: string) => {
    setTune(css);
    try { localStorage.setItem(TUNE_KEY, css); } catch { /* private window */ }
    applyTune(document, css);
    for (const frame of frames()) if (frame.contentDocument) applyTune(frame.contentDocument, css);
  };
  applyTune(document, tune());
  return <div class="g-canvas" data-preview={preview()}>
    <section class="g-left">
      <div class="g-bar">
        <h1>Gallery</h1>
        <button type="button" aria-pressed={tuning()} onClick={() => setTuning(!tuning())}>Tune CSS</button>
        <Show when={tuning()}><button type="button" onClick={() => void navigator.clipboard.writeText(tune())}>Copy</button></Show>
      </div>
      <Show when={tuning()}><textarea class="g-tune" spellcheck={false} value={tune()} onInput={(event) => update(event.currentTarget.value)}
        placeholder={".composer-surface-material[data-composer-surface=\"frosted-live\"] {\n  backdrop-filter: blur(30px);\n}"} /></Show>
      <For each={libraryFamilies}>{(family) => <section class="g-family">
        <h2 class="g-family-title">{family.title} <small>{family.note}</small></h2>
        <For each={family.groups}>{(group) => <>
          <Show when={group.title}><h3 class="g-heading">{group.title} <small>{group.note}</small></h3></Show>
          <div class="g-grid g-dense"><For each={group.atoms}>{(atom) => <Piece atom={atom} fixed={group.layout} />}</For></div>
        </>}</For>
      </section>}</For>
      <h2 class="g-heading">In the app now</h2>
      <div class="g-grid">
        <For each={atoms}>{(atom) => <Piece atom={atom} />}</For>
      </div>
    </section>
    <aside class="g-right">
      <div class="g-toggles">
        <div class="g-toggle" role="group" aria-label="Preview">
          <button type="button" aria-pressed={preview() === "phone"} onClick={() => setPreview("phone")}>Phone</button>
          <button type="button" aria-pressed={preview() === "sidebar"} onClick={() => setPreview("sidebar")}>Phone sidebar</button>
          <button type="button" aria-pressed={preview() === "desktop"} onClick={() => setPreview("desktop")}>Desktop</button>
        </div>
        <div class="g-toggle" role="group" aria-label="Drawn with">
          <button type="button" aria-pressed={source() === "live"} onClick={() => setSource("live")}>Live</button>
          <button type="button" aria-pressed={source() === "library"} onClick={() => setSource("library")}>Library</button>
        </div>
      </div>
      {/* Every view stays mounted once opened, so switching is instant: no frame reloads. */}
      <For each={views}>{(view) => <Show when={seen().has(view.key)}>
        <div class="g-view" hidden={`${preview()}-${source()}` !== view.key}>{view.render()}</div>
      </Show>}</For>
    </aside>
  </div>;
}

/** The phone-only pieces, alone in a phone frame. */
function Parts() {
  return <div class="g-grid g-parts-grid"><For each={phoneAtoms}>{(atom) => <Piece atom={atom} />}</For></div>;
}

export function mount(frame: string | null) {
  const root = document.getElementById("root")!;
  // Frosted only: the static material is on its way out.
  try { localStorage.setItem("conduit:composer-surface", "frosted-live"); localStorage.setItem("conduit:phone-composer", "bar"); } catch { /* private window */ }
  if (frame === "parts") { document.body.classList.add("g-parts-body"); render(() => <Parts />, root); }
  // The library's phone screens, in the same kind of frame as the live ones: a phone's root size and media rules.
  // The same real screens, their frosted pieces and menus drawn by the library (components/ui/swap.ts).
  else if (frame === "library-phone") { document.body.classList.add("g-solo-body"); render(() => <LibraryContext.Provider value={true}><ChatScreen /></LibraryContext.Provider>, root); }
  else if (frame === "library-sidebar") { document.body.classList.add("g-solo-body"); render(() => <LibraryContext.Provider value={true}><SidebarScreen /></LibraryContext.Provider>, root); }
  else if (frame === "sidebar") { document.body.classList.add("g-solo-body"); render(() => <SidebarScreen />, root); }
  else if (frame) { document.body.classList.add("g-solo-body"); render(() => <ChatScreen />, root); }
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
