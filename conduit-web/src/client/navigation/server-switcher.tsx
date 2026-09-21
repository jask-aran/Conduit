import { createSignal, For, onCleanup, Show } from "solid-js";
import { ExternalLinkIcon, PlusIcon, RefreshCwIcon } from "lucide-solid";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Spinner } from "@/components/primitives";
import { buildHttpUrl } from "../api/transport";
import { isInstalledClient } from "../platform/installed-client.ts";
import { activeOrigin, activeServer, servers, switchToServer, type ServerEntry } from "../platform/servers.ts";

const PROBE_TIMEOUT_MS = 4000;
const PROBE_INTERVAL_MS = 5000;

/**
 * How long this server takes to answer, or null when it did not.
 *
 * `/healthz` needs no session, so a server this client has never signed in to
 * still reports whether it is reachable -- which is the question a list of
 * addresses mostly has to answer.
 */
async function probe(origin: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = performance.now();
  try {
    await fetch(buildHttpUrl("/healthz", origin), { cache: "no-store", signal: controller.signal });
    return Math.round(performance.now() - started);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A browser page cannot measure another origin: Conduit grants cross-origin
// access to the two installed shells only, so the request is refused before it
// is timed. It reports on the server it was served by, and says nothing it
// cannot know about the rest.
const canProbe = (origin: string) => isInstalledClient() || origin === location.origin;

export function ServerSwitcher(props: {
  connectivity: string;
  pwaUpdating: boolean;
  onOpenSettings: () => void;
  onUpdatePwa: () => void;
  onAddServer: () => void;
  onLogout: () => void;
}) {
  const [latency, setLatency] = createSignal<Record<string, number | null>>({});
  const [probing, setProbing] = createSignal(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  const measure = async () => {
    setProbing(true);
    const measured = await Promise.all(servers().map(async (entry) =>
      [entry.origin, canProbe(entry.origin) ? await probe(entry.origin) : undefined] as const));
    setLatency(Object.fromEntries(measured.filter(([, value]) => value !== undefined)) as Record<string, number | null>);
    setProbing(false);
  };

  // Only while the menu is open. A timer that pings every known address
  // forever is traffic nobody asked for, over links that may be metered.
  const onOpenChange = (open: boolean) => {
    clearInterval(timer);
    if (!open) return;
    void measure();
    timer = setInterval(() => void measure(), PROBE_INTERVAL_MS);
  };
  onCleanup(() => clearInterval(timer));

  const connectionLabel = () => props.connectivity === "online" ? "Connected"
    : props.connectivity === "offline" ? "Server unavailable"
      : props.connectivity === "reconnecting" ? "Reconnecting" : "Connecting";
  const connectionTone = () => props.connectivity === "online" ? "success"
    : props.connectivity === "offline" ? "danger"
      : props.connectivity === "reconnecting" ? "warn" : "muted";

  const serverName = () => activeServer()?.name || "Conduit";
  const activeLatency = () => {
    const origin = activeOrigin();
    const value = origin ? latency()[origin] : undefined;
    return typeof value === "number" ? ` · ${value} ms` : "";
  };
  const triggerDetail = () => `${connectionLabel()}${activeLatency()}`;

  const latencyLabel = (entry: ServerEntry) => {
    if (!canProbe(entry.origin)) return "";
    const value = latency()[entry.origin];
    if (value === undefined) return probing() ? "…" : "";
    return value === null ? "Unreachable" : `${value} ms`;
  };

  const away = (entry: ServerEntry) => !isInstalledClient() && entry.origin !== location.origin;

  return <Menu onOpenChange={onOpenChange}>
    <MenuTrigger class="sidebar-user" aria-label={`${serverName()} · ${triggerDetail()}`} title={`${activeOrigin() || "No server"} — ${triggerDetail()}`}>
      <span class="sidebar-user-label"><strong>{serverName()}</strong><small>{triggerDetail()}</small></span>
      <span class={`server-status-indicator runtime-indicator runtime-indicator-${connectionTone()}`} aria-hidden="true">
        <Show when={props.connectivity === "connecting" || props.connectivity === "reconnecting"} fallback={<span class="runtime-indicator-dot" />}><Spinner class="size-3" /></Show>
      </span>
    </MenuTrigger>
    <MenuContent>
      <Show when={servers().length > 0}>
        <MenuGroup>
          <MenuLabel>Servers</MenuLabel>
          <MenuRadioGroup value={activeOrigin() || ""} onChange={(origin) => switchToServer(origin, isInstalledClient())}>
            <For each={servers()}>{(entry) =>
              <MenuRadioItem value={entry.origin}>
                <span class="truncate">{entry.name}</span>
                <Show when={away(entry)}><ExternalLinkIcon class="size-3 text-muted-foreground" /></Show>
                <span class="server-row-latency ml-auto text-xs text-muted-foreground">{latencyLabel(entry)}</span>
              </MenuRadioItem>}</For>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
      </Show>
      <MenuItem onSelect={props.onAddServer}><PlusIcon />Add server</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onOpenSettings}>Manage settings</MenuItem>
      <MenuItem disabled={props.pwaUpdating} onSelect={props.onUpdatePwa}>
        <RefreshCwIcon class={props.pwaUpdating ? "pwa-update-icon pwa-update-icon-active" : "pwa-update-icon"} />
        {props.pwaUpdating ? "Checking for updates…" : "Check for updates"}
      </MenuItem>
      <MenuItem onSelect={props.onLogout}>{servers().length > 1 ? `Sign out of ${serverName()}` : "Sign out"}</MenuItem>
    </MenuContent>
  </Menu>;
}
