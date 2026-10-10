import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import "../client/project/dashboard.css";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "./gallery.css";
import { ChatScreen, pieces } from "./stories";

/*
 * The frosted family on one canvas, live: desktop pieces drawn here, the phone
 * in one frame of this page that passes for a phone (phone-emulation.ts). The
 * tuning box applies CSS here and in the frame at once. It never writes
 * source: copy what you settle on.
 */

const TUNE_KEY = "conduit:gallery-tune";
const read = () => { try { return localStorage.getItem(TUNE_KEY) || ""; } catch { return ""; } };

function applyTune(doc: Document, css: string) {
  let style = doc.getElementById("gallery-tune");
  if (!style) { style = doc.createElement("style"); style.id = "gallery-tune"; }
  // Last in the head, so it wins over the app's rules at equal specificity.
  doc.head.append(style);
  style.textContent = css;
}

const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.g-phone"));

function Canvas() {
  const [tune, setTune] = createSignal(read());
  const update = (css: string) => {
    setTune(css);
    try { localStorage.setItem(TUNE_KEY, css); } catch { /* private window */ }
    applyTune(document, css);
    for (const frame of frames()) if (frame.contentDocument) applyTune(frame.contentDocument, css);
  };
  applyTune(document, tune());
  return <div class="g-canvas">
    <aside class="g-panel">
      <h1>Frost</h1>
      <label for="g-tune">Tune (CSS, live everywhere)</label>
      <textarea id="g-tune" spellcheck={false} value={tune()} onInput={(event) => update(event.currentTarget.value)}
        placeholder={".composer-surface-material[data-composer-surface=\"frosted-live\"] {\n  backdrop-filter: blur(30px);\n}"} />
      <button type="button" onClick={() => void navigator.clipboard.writeText(tune())}>Copy CSS</button>
    </aside>
    <main class="g-sheet">
      {/* Text under everything: frost reads as frost only over something. */}
      <div class="g-sheet-text" aria-hidden="true"><For each={Array.from({ length: 40 })}>{() =>
        <p>Conduit keeps the answer, the trace and the files in one place. <code>createComposerSurfaceSignal()</code> follows the setting, and every pill, bubble and menu here is drawn by the app's own code over this text.</p>}</For></div>
      <div class="g-pieces">
        <For each={pieces}>{(piece) => <figure class="g-piece" id={piece.id}>{piece.render()}<figcaption>{piece.name}</figcaption></figure>}</For>
      </div>
      <div class="g-screens">
        <figure class="g-piece" id="desktop"><div class="g-desktop-screen"><ChatScreen /></div><figcaption>Desktop</figcaption></figure>
        <figure class="g-piece" id="phone"><iframe class="g-phone" title="Phone" src="/gallery.html?frame=phone" onLoad={(event) => applyTune(event.currentTarget.contentDocument!, read())} /><figcaption>Phone</figcaption></figure>
      </div>
    </main>
  </div>;
}

export function mount(frame: string | null) {
  const root = document.getElementById("root")!;
  // Frosted only: the static material is on its way out.
  try { localStorage.setItem("conduit:composer-surface", "frosted-live"); localStorage.setItem("conduit:phone-composer", "bar"); } catch { /* private window */ }
  if (frame) { document.body.classList.add("g-solo-body"); render(() => <ChatScreen />, root); }
  else render(() => <Canvas />, root);
}
