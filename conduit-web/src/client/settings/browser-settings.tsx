import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Button, Segmented, SettingDetails, SettingLine, SettingValue, Spinner, Group, Loading, Note, Switch } from "@/components/ui";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { api } from "../api/client";

/** GET /v0/browsers/hub/settings (browser-host.js `describe`). */
type BrowserSettings = {
  available: boolean; running?: boolean; url?: string | null; title?: string | null; engine: string; version: string | null; runsOn: string; profile: boolean;
  video: boolean; settings: { fps: number; quality: number; codec: "h264" | "h265" | "jpeg"; direct?: boolean }; choices: { fps: number[]; quality: number[]; codec: BrowserSettings["settings"]["codec"][] };
};
const CODEC_LABELS = { h264: "H.264", h265: "H.265", jpeg: "JPEG" };
const QUALITY_LABELS: Record<number, string> = { 30: "Low", 60: "Medium", 85: "High" };

/**
 * Services › Browser: the hub's browser that the person and Conduit's agents share (roadmap #16). Where it runs and on
 * what, its stream (frame rate, each viewer's, applied at once; quality, the browser's, which restarts it on the page it
 * showed), and its data: kept across restarts in its own profile, cleared only here.
 */
export function BrowserSettings() {
  const [found, setFound] = createSignal<BrowserSettings | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal("");
  const { confirm } = createDecisionScope(() => "browser-settings");
  const load = () => api<BrowserSettings>("/v0/browsers/hub/settings").then((value) => { setFound(value); setError(""); })
    .catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  onMount(() => void load());
  const changed = () => void load();
  window.addEventListener("conduit:browser-changed", changed);
  onCleanup(() => window.removeEventListener("conduit:browser-changed", changed));
  const run = async (what: string, request: () => Promise<BrowserSettings>) => {
    setBusy(what); setError("");
    try { setFound(await request()); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(""); }
  };
  const put = (patch: Partial<BrowserSettings["settings"]>) => run(patch.direct !== undefined ? "direct" : patch.codec ? "codec" : patch.quality ? "quality" : "fps", () =>
    api<BrowserSettings>("/v0/browsers/hub/settings", { method: "PUT", body: JSON.stringify(patch) }));
  const act = (action: "restart" | "clear") => run(action, () =>
    api("/v0/browsers/hub/actions", { method: "POST", body: JSON.stringify({ action }), timeout: false }).then(() => api<BrowserSettings>("/v0/browsers/hub/settings")));
  const clear = async () => {
    if (!(await confirm("Clear the hub browser's data? Every site it is signed in to signs out, and its history and storage go.", { destructive: true, confirmLabel: "Clear data" }))) return;
    await act("clear");
  };
  const host = (url?: string | null) => { try { return url && url !== "about:blank" ? new URL(url).host : ""; } catch { return ""; } };

  // The codecs this hub can encode: JPEG only without ffmpeg (the note below says why).
  const Picture = (props: { browser: BrowserSettings }) =>
    <Segmented label="Picture" size="sm" value={props.browser.video ? props.browser.settings.codec : "jpeg"} disabled={!!busy()}
      options={props.browser.choices.codec.filter((codec) => props.browser.video || codec === "jpeg").map((codec) => ({ value: codec, label: CODEC_LABELS[codec] }))}
      onChange={(codec) => void put({ codec })} />;

  return <Show when={found()} fallback={<Show when={error()} fallback={<Loading>Loading the browser…</Loading>}>
    <Note tone="error"><span>{error()}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>{(browser) => <>
    <Group title="Hub browser">
      <SettingLine plain label="Status" title={browser().url || undefined}>
        <SettingValue>{!browser().available ? "Not available" : browser().running ? `Running${host(browser().url) ? ` · ${host(browser().url)}` : ""}` : "Starts when it is first opened"}</SettingValue>
      </SettingLine>
      <SettingLine plain label="Runs on" title="A browser on one of your devices, reachable from the others, comes later.">
        <SettingValue>This hub</SettingValue>
      </SettingLine>
      <SettingLine plain label="Engine" title="Vercel's agent-browser driving Chrome. Agents use agent-browser's own tools on the same page.">
        <SettingValue mono>{browser().engine}{browser().version ? ` · agent-browser ${browser().version}` : ""}</SettingValue>
      </SettingLine>
    </Group>
    <Group title="Stream">
      <SettingLine plain label="Frame rate" title="How often a Browser pane is sent the page; applied to open panes at once.">
        <Segmented label="Frame rate" size="sm" value={String(browser().settings.fps)} disabled={!!busy()}
          options={browser().choices.fps.map((fps) => ({ value: String(fps), label: `${fps} fps` }))} onChange={(value) => void put({ fps: Number(value) })} />
      </SettingLine>
      <SettingLine plain label="Picture" title="The picture codec. Changing it reconnects open panes without restarting the browser.">
        <Picture browser={browser()} />
      </SettingLine>
      <Show when={!browser().video}><Note>The hub needs ffmpeg for H.264 and H.265.</Note></Show>
      <SettingLine plain label="Quality" state={busy() === "quality" ? "restarting…" : undefined} title="The picture's JPEG quality. Changing it restarts the browser, back on the page it showed.">
        <Segmented label="Quality" size="sm" value={String(browser().settings.quality)} disabled={!!busy()}
          options={browser().choices.quality.map((quality) => ({ value: String(quality), label: QUALITY_LABELS[quality] || String(quality) }))} onChange={(value) => void put({ quality: Number(value) })} />
      </SettingLine>
    </Group>
    <Group title="Experimental">
      <SettingLine plain label="Direct pages" title="Browser panes show the page itself, fetched through the hub, instead of the shared browser's picture.">
        <Switch label="Direct pages" checked={browser().settings.direct === true} disabled={!!busy()} onChange={(direct) => void put({ direct })} />
      </SettingLine>
      <Note>Partly broken by design: a page is fetched by the hub and shown in Conduit, so it is crisp and scrolls natively, but
        it is not the browser your agents use, and many sites will not work. Links built by a page's scripts leave the proxy,
        other sites' content loads from your own network, sites with bot checks refuse it, every proxied site shares cookies
        with the others (they are ports of one host), it needs Conduit opened over plain http, and live connections
        (WebSockets) do not pass. Conduit refuses anything a proxied page sends it.</Note>
    </Group>
    <Group title="Data">
      <SettingLine plain label="Signed-in sites" state={browser().profile ? "kept across restarts" : "kept while it runs"} title="The browser keeps its own profile on the hub: cookies, storage and history.">
        <Button variant="ghost" size="sm" disabled={!!busy() || !browser().available} onClick={() => void act("restart")}>{busy() === "restart" ? <Spinner /> : null}Restart</Button>
        <Button variant="destructive" outline size="sm" disabled={!!busy() || !browser().available} onClick={() => void clear()}>{busy() === "clear" ? <Spinner /> : null}Clear data</Button>
      </SettingLine>
      <Show when={error()}><Note tone="error">{error()}</Note></Show>
      <SettingDetails summary="What the browser is">
        <Note>One Chrome on the hub, shared: you see and drive it in a Browser pane, and Conduit's agents work the same page through
          agent-browser's tools (other harnesses through its MCP server, Settings › AI › Tools). Sites see the hub, signed in as whatever it signs in as.</Note>
      </SettingDetails>
    </Group>
  </>}</Show>;
}
