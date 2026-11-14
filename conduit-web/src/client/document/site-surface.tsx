import { createSignal, onCleanup, Show } from "solid-js";
import { Empty, WebPage } from "@/components/ui";
import type { ArtifactSurfaceProps } from "./artifact-kinds";
import { siteContent } from "./artifacts";
import { siteBridge } from "./site-bridge";

const LOOK_MS = 2000;

/** A site in its pane: its file's HTML in a frame with no origin (`allow-scripts` alone), the new version shown a moment after the file is saved, and Markup over it. */
export default function SiteSurface(props: ArtifactSurfaceProps) {
  let element: HTMLIFrameElement | undefined, revision: string | undefined, looking = false;
  const bridge = siteBridge(() => element), [html, setHtml] = createSignal<string>(), [failed, setFailed] = createSignal<string>(), [loaded, setLoaded] = createSignal(false);
  // A look that fails changes nothing once a version is shown: it stays. Before that the pane says why there is none.
  // One at a time: a slow answer (a file on another device) is never overtaken by the next, which would put the older file back.
  const look = () => { if (looking) return; looking = true; void siteContent(props.about().id, revision).then((now) => { revision = now.revision; if (now.html !== undefined) setHtml(bridge.document(now.html)); }, (error: Error) => setFailed(error.message)).finally(() => { looking = false; }); };
  // While something of Conduit's is dragged (a tab, a row), the frame lets it through to the pane, which takes the drop.
  const [dragging, setDragging] = createSignal(false), drag = (event: Event) => setDragging(event.type === "dragstart");
  for (const type of ["dragstart", "dragend", "drop"]) window.addEventListener(type, drag, true);
  look();
  const timer = setInterval(() => { if (document.visibilityState === "visible") look(); }, LOOK_MS);
  window.addEventListener("conduit:artifacts-changed", look);
  onCleanup(() => { clearInterval(timer); window.removeEventListener("conduit:artifacts-changed", look); for (const type of ["dragstart", "dragend", "drop"]) window.removeEventListener(type, drag, true); bridge.close(); });
  props.onSurface({ markup: {
    client: () => ({ kind: "site" }),
    subject: () => ({ site: props.about().name, file: props.about().path, change: "This is one HTML file in the project's folder. Change that file to answer: the person's pane shows the new version a moment after it is saved." }),
    under: (box) => bridge.under(box),
  }, drawn: () => loaded() || Boolean(failed()) });
  return <Show when={html() !== undefined} fallback={<Show when={failed()} fallback={<Empty role="status">Opening the site…</Empty>}><Empty role="alert">This site could not be opened: {failed()!.replace(/\.$/, "")}.</Empty></Show>}>
    <WebPage ref={element} still={dragging()} sandbox="allow-scripts" title={props.about().name} srcdoc={html()} onLoad={() => setLoaded(true)} />
  </Show>;
}
