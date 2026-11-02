import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Button, Segmented, SettingDetails, SettingGroup, SettingLine, SettingLoading, SettingNote, SettingValue, Spinner } from "@/components/ui";
import { createDecisionScope } from "@/components/decision-dialog";
import { api } from "../api/client";

/** GET /v0/browsers/hub/settings (browser-host.js `describe`). */
type BrowserSettings = {
  available: boolean; running?: boolean; url?: string | null; title?: string | null; engine: string; version: string | null; runsOn: string; profile: boolean;
  settings: { fps: number; quality: number }; choices: { fps: number[]; quality: number[] };
};
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
  const put = (patch: Partial<BrowserSettings["settings"]>) => run(patch.quality ? "quality" : "fps", () =>
    api<BrowserSettings>("/v0/browsers/hub/settings", { method: "PUT", body: JSON.stringify(patch) }));
  const act = (action: "restart" | "clear") => run(action, () =>
    api("/v0/browsers/hub/actions", { method: "POST", body: JSON.stringify({ action }) }).then(() => api<BrowserSettings>("/v0/browsers/hub/settings")));
  const clear = async () => {
    if (!(await confirm("Clear the hub browser's data? Every site it is signed in to signs out, and its history and storage go.", { destructive: true, confirmLabel: "Clear data" }))) return;
    await act("clear");
  };
  const host = (url?: string | null) => { try { return url && url !== "about:blank" ? new URL(url).host : ""; } catch { return ""; } };

  return <Show when={found()} fallback={<Show when={error()} fallback={<SettingLoading>Loading the browser…</SettingLoading>}>
    <SettingNote tone="error"><span>{error()}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></SettingNote>
  </Show>}>{(browser) => <>
    <SettingGroup title="Hub browser">
      <SettingLine plain label="Status" title={browser().url || undefined}>
        <SettingValue>{!browser().available ? "Not available" : browser().running ? `Running${host(browser().url) ? ` · ${host(browser().url)}` : ""}` : "Starts when it is first opened"}</SettingValue>
      </SettingLine>
      <SettingLine plain label="Runs on" title="A browser on one of your devices, reachable from the others, comes later.">
        <SettingValue>This hub</SettingValue>
      </SettingLine>
      <SettingLine plain label="Engine" title="Vercel's agent-browser driving Chrome. Agents use agent-browser's own tools on the same page.">
        <SettingValue mono>{browser().engine}{browser().version ? ` · agent-browser ${browser().version}` : ""}</SettingValue>
      </SettingLine>
    </SettingGroup>
    <SettingGroup title="Stream">
      <SettingLine plain label="Frame rate" title="How often a Browser pane is sent the page; applied to open panes at once.">
        <Segmented label="Frame rate" size="sm" value={String(browser().settings.fps)} disabled={!!busy()}
          options={browser().choices.fps.map((fps) => ({ value: String(fps), label: `${fps} fps` }))} onChange={(value) => void put({ fps: Number(value) })} />
      </SettingLine>
      <SettingLine plain label="Quality" state={busy() === "quality" ? "restarting…" : undefined} title="The picture's JPEG quality. Changing it restarts the browser, back on the page it showed.">
        <Segmented label="Quality" size="sm" value={String(browser().settings.quality)} disabled={!!busy()}
          options={browser().choices.quality.map((quality) => ({ value: String(quality), label: QUALITY_LABELS[quality] || String(quality) }))} onChange={(value) => void put({ quality: Number(value) })} />
      </SettingLine>
    </SettingGroup>
    <SettingGroup title="Data">
      <SettingLine plain label="Signed-in sites" state={browser().profile ? "kept across restarts" : "kept while it runs"} title="The browser keeps its own profile on the hub: cookies, storage and history.">
        <Button variant="ghost" size="sm" disabled={!!busy() || !browser().available} onClick={() => void act("restart")}>{busy() === "restart" ? <Spinner /> : null}Restart</Button>
        <Button variant="destructive" outline size="sm" disabled={!!busy() || !browser().available} onClick={() => void clear()}>{busy() === "clear" ? <Spinner /> : null}Clear data</Button>
      </SettingLine>
      <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
      <SettingDetails summary="What the browser is">
        <SettingNote>One Chrome on the hub, shared: you see and drive it in a Browser pane, and Conduit's agents work the same page through
          agent-browser's tools (other harnesses through its MCP server, Settings › AI › Tools). Sites see the hub, signed in as whatever it signs in as.</SettingNote>
      </SettingDetails>
    </SettingGroup>
  </>}</Show>;
}
