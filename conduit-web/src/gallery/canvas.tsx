import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import "../client/project/dashboard.css";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "./gallery.css";
import { ChatScreen } from "./stories";
import { atoms, phoneAtoms, type Atom } from "./atoms";
import { libraryAtoms } from "./library";

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

function Piece(props: { atom: Atom }) {
  return <figure class="g-cell" id={props.atom.id}>
    <figcaption class="g-tag" title={props.atom.source}><strong>{props.atom.name}</strong><span>{props.atom.scope}</span><span data-kind={props.atom.kind}>{props.atom.kind}</span></figcaption>
    <div class="g-cell-body">{props.atom.render()}</div>
  </figure>;
}

function Canvas() {
  const [tune, setTune] = createSignal(read());
  const [preview, setPreview] = createSignal<"desktop" | "phone">("phone");
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
      <h2 class="g-heading">Library</h2>
      <div class="g-grid">
        <For each={libraryAtoms}>{(atom) => <Piece atom={atom} />}</For>
      </div>
      <h2 class="g-heading">In the app now</h2>
      <div class="g-grid">
        <For each={atoms}>{(atom) => <Piece atom={atom} />}</For>
      </div>
    </section>
    <aside class="g-right">
      <div class="g-toggle" role="group" aria-label="Preview">
        <button type="button" aria-pressed={preview() === "phone"} onClick={() => setPreview("phone")}>Phone</button>
        <button type="button" aria-pressed={preview() === "desktop"} onClick={() => setPreview("desktop")}>Desktop</button>
      </div>
      <Show when={preview() === "phone"} fallback={<div class="g-desktop-screen"><ChatScreen /></div>}>
        <iframe class="g-phone" title="Phone preview" src="/gallery.html?frame=phone" onLoad={tuneFrame} />
      </Show>
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
  else if (frame) { document.body.classList.add("g-solo-body"); render(() => <ChatScreen />, root); }
  else render(() => <Canvas />, root);
}
