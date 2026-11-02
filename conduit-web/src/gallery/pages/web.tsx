// Web: a page in a pane -- the hub's browser (roadmap #7). The bar, then the live screen in each of its states.
import { onMount } from "solid-js";
import { Icons, ToolBar, WebAddress, WebScreen, WebView, IconButton } from "@/components/ui";
import { row, token, type Page } from "../model";

/** A stand-in frame, drawn as the stream would: a light page with a heading, a field and a link. */
function paint(canvas: HTMLCanvasElement) {
  canvas.width = 800; canvas.height = 520;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff"; context.fillRect(0, 0, 800, 520);
  context.fillStyle = "#111"; context.font = "600 40px system-ui"; context.fillText("Ryokan search", 32, 72);
  context.strokeStyle = "#222"; context.lineWidth = 2; context.strokeRect(32, 100, 420, 44);
  context.font = "22px system-ui"; context.fillText("Shirakawa-go, 2 nights", 44, 130);
  context.fillStyle = "#1a4fd8"; context.fillText("Gassho-zukuri farmhouses with a hearth", 32, 196);
  context.fillStyle = "#555"; for (let line = 0; line < 6; line += 1) context.fillRect(32, 236 + line * 34, 560 - (line % 3) * 90, 14);
}

function Demo(props: { live?: boolean; state?: string; tone?: "error"; address?: string }) {
  let canvas!: HTMLCanvasElement;
  onMount(() => { if (props.live) paint(canvas); });
  return <div style={{ display: "flex", height: "calc(18 * var(--u-space))", width: "min(100%, calc(32 * var(--u-space)))", "border-radius": "var(--radius-surface)", overflow: "hidden", background: "var(--background)" }}>
    <WebView label="Hub browser">
      <ToolBar>
        <IconButton label="Back"><Icons.Back /></IconButton>
        <IconButton label="Forward"><Icons.Forward /></IconButton>
        <IconButton label="Reload"><Icons.Refresh /></IconButton>
        <WebAddress aria-label="Address" placeholder="Search or type an address" value={props.address ?? ""} secure={(props.address ?? "").startsWith("https://")} />
      </ToolBar>
      <WebScreen canvas={(element) => { canvas = element; }} live={props.live} state={props.state} tone={props.tone} aria-label="Page" />
    </WebView>
  </div>;
}

export const webPage: Page = {
  title: "Web",
  summary: "A web page in a pane: the hub's browser, shared by the person and Conduit's agents. Its bar is the Pane family's ToolBar (back, forward, reload as ToolButtons) with the WebAddress -- the address in the data face, a lock when it is https -- and under it the WebScreen, the page drawn live onto its canvas, whole and from the top, taking the pointer and the keys once focused. While there is no frame it says why over the ground: starting, reconnecting, or (error) that the hub has no browser.",
  preview: () => <Demo live address="https://www.japan-guide.com/e/e5950.html" />,
  usage: `import { ToolBar, IconButton, WebAddress, WebScreen, WebView } from "@/components/ui";

<WebView label="Hub browser">
  <ToolBar><IconButton label="Back"><Icons.Back /></IconButton>…<WebAddress value={url} secure onKeyDown={go} /></ToolBar>
  <WebScreen canvas={(element) => canvas = element} live={live()} state={why()} tone="error" onPointerDown… />
</WebView>`,
  anatomy: { scene: () => <Demo live address="https://www.japan-guide.com/e/e5950.html" />, parts: [
    { selector: ".ui-tool-bar", name: "Bar", does: "back, forward, reload and the address", from: "ToolBar, IconButton" },
    { selector: ".ui-web-address", name: "Address", does: "where the page is; edited in place, Enter goes there", from: "WebAddress secure" },
    { selector: ".ui-web-screen", name: "Screen", does: "the page drawn live; takes the pointer and the keys", from: "WebScreen canvas live", side: "below" },
  ] },
  examples: [
    row("WebScreen · live", "A frame drawn: the page whole, from the top, on the pane's ground.", () => <Demo live address="https://www.japan-guide.com/e/e5950.html" />),
    row("WebScreen · starting", "No frame yet: the screen says so, quiet, over the ground.", () => <Demo state="Starting the hub's browser…" />, { code: '<WebScreen state="Starting the hub\'s browser…" />' }),
    row("WebScreen · unavailable", "The hub has no browser: tone error, with what to run.", () => <Demo tone="error" state="The hub has no browser yet. On the hub, install agent-browser: npm i -g agent-browser." />, { code: '<WebScreen tone="error" state={why} />' }),
    row("WebAddress · plain and secure", "A globe for an address that is not https; a lock for one that is.", () => <div style={{ display: "grid", gap: "var(--space-md)", width: "calc(28 * var(--u-space))" }}>
      <WebAddress aria-label="Address" value="http://127.0.0.1:4310/healthz" /><WebAddress aria-label="Address" value="https://example.com/" secure /><WebAddress aria-label="Address" placeholder="Search or type an address" value="" />
    </div>),
  ],
  tokens: [
    { title: "Address", tokens: [token("--control-tool", "Field height"), token("--tint", "Field fill"), token("--font-data", "Address face"), token("--ring", "Focused hairline")] },
    { title: "Screen", tokens: [token("--background", "Ground behind the page"), token("--duration-quick", "First frame's fade in"), token("--destructive", "Unavailable")] },
  ],
  api: ["WebView", "WebAddress", "WebScreen"],
};
