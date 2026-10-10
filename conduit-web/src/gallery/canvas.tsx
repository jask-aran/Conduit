import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import "../client/project/dashboard.css";
import "../client/chat/composer-geometry.css";
import "../client/styles.css";
import "../client/navigation/sidebar.css";
import "./gallery.css";
import { stories, type Story } from "./stories";

/*
 * One canvas of every component, live: the base components, the materials,
 * and surfaces from the app that use them customised. Desktop and both-scope
 * entries render on the canvas itself; phone renders are frames of this page
 * passing for a phone (phone-emulation.ts). The tuning box applies CSS to the
 * canvas and every frame at once, so a change to a base reaches each surface
 * built on it as you type. It never writes source: copy what you settle on.
 */

const TUNE_KEY = "conduit:gallery-tune";
const TUNE_STYLE = "gallery-tune";
const readTune = () => { try { return localStorage.getItem(TUNE_KEY) || ""; } catch { return ""; } };

function applyTune(doc: Document, css: string) {
  let style = doc.getElementById(TUNE_STYLE);
  if (!style) { style = doc.createElement("style"); style.id = TUNE_STYLE; doc.head.append(style); }
  // Last in the head, so it wins over the app's own rules at equal specificity.
  if (style !== doc.head.lastElementChild) doc.head.append(style);
  style.textContent = css;
}

function Frame(props: { story: Story }) {
  let iframe!: HTMLIFrameElement;
  return <iframe ref={iframe} class="g-phone" loading="lazy" title={`${props.story.name} on a phone`} src={`/gallery.html?frame=${props.story.id}`}
    style={{ height: `${props.story.frame ?? 200}px` }} onLoad={() => applyTune(iframe.contentDocument!, readTune())} />;
}

function Card(props: { story: Story }) {
  const story = props.story;
  return <section class="g-card" id={story.id} data-scope={story.scope} data-status={story.status}>
    <header>
      <h3>{story.name}</h3>
      <span class="g-tag" data-kind="scope">{story.scope}</span>
      <span class="g-tag" data-kind={story.status}>{story.status}</span>
      <code>{story.source}</code>
    </header>
    <Show when={story.note}><p class="g-note">{story.note}</p></Show>
    <div class="g-renders">
      <Show when={story.scope !== "phone"}><div class="g-desktop" data-label="desktop">{story.render()}</div></Show>
      <Show when={story.scope !== "desktop"}><div class="g-frame" data-label="phone · 412"><Frame story={story} /></div></Show>
    </div>
  </section>;
}

function Canvas() {
  const [tune, setTune] = createSignal(readTune());
  const [scope, setScope] = createSignal<"all" | "both" | "desktop" | "phone">("all");
  const update = (css: string) => {
    setTune(css);
    try { localStorage.setItem(TUNE_KEY, css); } catch { /* private window */ }
    applyTune(document, css);
    for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.g-phone"))) if (frame.contentDocument) applyTune(frame.contentDocument, css);
  };
  applyTune(document, tune());
  const groups = ["Base", "Materials", "Surfaces"] as const;
  return <div class="g-canvas">
    <aside class="g-panel">
      <h1>Conduit gallery</h1>
      <p>Real components on the app's stylesheet. Phone renders are frames that pass for a phone.</p>
      <div class="g-filter"><For each={["all", "both", "desktop", "phone"] as const}>{(value) =>
        <button type="button" aria-pressed={scope() === value} onClick={() => setScope(value)}>{value}</button>}</For></div>
      <nav><For each={groups}>{(group) => <><h2>{group}</h2><For each={stories.filter((story) => story.group === group)}>{(story) => <a href={`#${story.id}`}>{story.name}</a>}</For></>}</For></nav>
      <label for="g-tune">Tune (CSS, live everywhere)</label>
      <textarea id="g-tune" spellcheck={false} value={tune()} onInput={(event) => update(event.currentTarget.value)}
        placeholder={".composer-surface-material[data-composer-surface=\"frosted-live\"] {\n  backdrop-filter: blur(30px);\n}"} />
      <button type="button" onClick={() => void navigator.clipboard.writeText(tune())}>Copy CSS</button>
    </aside>
    <main class="g-board">
      <For each={groups}>{(group) => <>
        <h2 class="g-group">{group}</h2>
        <div class="g-grid"><For each={stories.filter((story) => story.group === group && (scope() === "all" || story.scope === scope()))}>{(story) => <Card story={story} />}</For></div>
      </>}</For>
    </main>
  </div>;
}

/** One story alone, filling a phone frame. */
function Solo(props: { story: Story }) {
  return <div class="g-solo">{props.story.render()}</div>;
}

export function mount(frame: string | null) {
  const root = document.getElementById("root")!;
  const story = frame ? stories.find((entry) => entry.id === frame) : null;
  if (frame) {
    document.body.classList.add("g-solo-body");
    render(() => story ? <Solo story={story} /> : <p>No story "{frame}".</p>, root);
  } else render(() => <Canvas />, root);
}
