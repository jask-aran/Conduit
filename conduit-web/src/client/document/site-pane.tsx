import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import type { MarkupHost } from "@/components/markup";
import { Empty, WebPage } from "@/components/ui";
import { siteContent, type Artifact } from "./artifacts";
import { siteBridge } from "./site-bridge";

const LOOK_MS = 2000;

/** A site in its pane: its file's HTML in a frame with no origin (`allow-scripts` alone), the new version shown a moment after the file is saved, and Markup over it. */
export default function SitePane(props: { about: () => Artifact; host: Omit<MarkupHost, "capabilities" | "client" | "subject" | "under">; tool: (host: MarkupHost) => JSX.Element }) {
  let element: HTMLIFrameElement | undefined, revision: string | undefined;
  const bridge = siteBridge(() => element), [html, setHtml] = createSignal<string>(), [failed, setFailed] = createSignal<string>();
  // A look that fails changes nothing once a version is shown: it stays. Before that the pane says why there is none.
  const look = () => void siteContent(props.about().id, revision).then((now) => { revision = now.revision; if (now.html !== undefined) setHtml(bridge.document(now.html)); }, (error: Error) => setFailed(error.message));
  look();
  const timer = setInterval(() => { if (document.visibilityState === "visible") look(); }, LOOK_MS);
  window.addEventListener("conduit:artifacts-changed", look);
  onCleanup(() => { clearInterval(timer); window.removeEventListener("conduit:artifacts-changed", look); bridge.close(); });
  const markup: MarkupHost = {
    ...props.host,
    capabilities: { deliveries: ["batched", "live"], tools: ["pen", "highlight", "shape", "text", "erase", "note"], screenshot: true, sent: "corner", thin: false, grounded: true },
    client: () => ({ kind: "site" }),
    subject: () => ({ site: props.about().name, file: props.about().path, change: "This is one HTML file in the project's folder. Change that file to answer: the person's pane shows the new version a moment after it is saved." }),
    under: (box) => bridge.under(box),
  };
  return <>
    <Show when={html() !== undefined} fallback={<Show when={failed()} fallback={<Empty role="status">Opening the site…</Empty>}><Empty role="alert">This site could not be opened: {failed()!.replace(/\.$/, "")}.</Empty></Show>}>
      <WebPage ref={element} sandbox="allow-scripts" title={props.about().name} srcdoc={html()} />
    </Show>
    {props.tool(markup)}
  </>;
}
