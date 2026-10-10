import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import "../client/project/dashboard.css";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "./gallery.css";
import { desktop, PhoneScreen } from "./stories";

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
    <main class="g-board">
      <section class="g-column">
        <h2>Desktop</h2>
        <For each={desktop}>{(entry) => <section class="g-card" id={entry.id}>
          <header><h3>{entry.name}</h3><code>{entry.source}</code></header>
          {entry.note && <p class="g-note">{entry.note}</p>}
          {entry.render()}
        </section>}</For>
      </section>
      <section class="g-column g-phone-column">
        <h2>Phone</h2>
        <p class="g-note">The app's own header, transcript and composer over a seeded chat, not wired to a server. Type and send to add a seeded reply.</p>
        <iframe class="g-phone" title="Phone" src="/gallery.html?frame=phone" onLoad={(event) => applyTune(event.currentTarget.contentDocument!, read())} />
      </section>
    </main>
  </div>;
}

export function mount(frame: string | null) {
  const root = document.getElementById("root")!;
  // Frosted only: the static material is on its way out.
  try { localStorage.setItem("conduit:composer-surface", "frosted-live"); localStorage.setItem("conduit:phone-composer", "bar"); } catch { /* private window */ }
  if (frame) { document.body.classList.add("g-solo-body"); render(() => <PhoneScreen />, root); }
  else render(() => <Canvas />, root);
}
