import { createSignal, For, lazy, onCleanup, Show } from "solid-js";
import { ExternalLinkIcon, PlusIcon, QrCodeIcon, RefreshCwIcon } from "lucide-solid";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, Spinner } from "@/components/primitives";
import { buildHttpUrl } from "../api/transport";
import { proveServer } from "../platform/server-proof";
const PairDialog = lazy(() => import("./pair-dialog").then((module) => ({ default: module.PairDialog })));

/** Not an address: the row that hands the choice back to the client. */
const AUTOMATIC = "automatic";
import { canReachOtherOrigins, isInstalledClient, isStandaloneBrowser } from "../platform/installed-client.ts";
import { activePath, activeOrigin, activeServer, clearActivePath, dialOrigin, pathIsPinned, pathsOf, serverPathLabel, servers, setActivePath, switchToServer, type ServerEntry } from "../platform/servers.ts";

/** An origin as somebody would say it aloud: no scheme, no default port. */
export const shortOrigin = (origin: string) => origin.replace(/^https?:\/\//, "");

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
  const [checking, setChecking] = createSignal("");
  const [routeError, setRouteError] = createSignal("");
  const [pairing, setPairing] = createSignal(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  // Every address of every server, not just the one each is filed under: the
  // question the menu answers is "which of these is quickest from here", and a
  // path that cannot be reached from this network has to be able to say so.
  const allPaths = () => servers().flatMap((entry) => pathsOf(entry).map((path) => ({ origin: path.origin, entry })));

  const measure = async () => {
    setProbing(true);
    // Timed as each route is really dialled, https included.
    const measured = await Promise.all(allPaths().map(async ({ origin, entry }) =>
      [origin, canProbe(origin) ? await probe(dialOrigin(origin, entry)) : undefined] as const));
    setLatency(Object.fromEntries(measured.filter(([, value]) => value !== undefined)) as Record<string, number | null>);
    setProbing(false);
  };

  // Only while the menu is open. A timer that pings every known address
  // forever is traffic nobody asked for, over links that may be metered.
  // The row is only a handle for its menu, not a place to stand. A click does
  // not focus it, and when the menu closes focus goes back to wherever it was
  // before -- the menu library focuses its trigger once it has closed,
  // whatever it is told, so that focus is passed straight on.
  let focusBefore: Element | null = null;
  let giveBack: Element | null | undefined;
  const onOpenChange = (open: boolean) => {
    clearInterval(timer);
    if (!open) {
      giveBack = focusBefore;
      focusBefore = null;
      setTimeout(() => { giveBack = undefined; }, 1000);
      return;
    }
    giveBack = undefined;
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
    const origin = activePath();
    const value = origin ? latency()[origin] : undefined;
    return typeof value === "number" ? ` · ${value} ms` : "";
  };
  const triggerDetail = () => `${connectionLabel()}${activeLatency()}`;

  const latencyLabel = (origin: string) => {
    if (!canProbe(origin)) return "";
    const value = latency()[origin];
    if (value === undefined) return probing() ? "…" : "";
    // An unreachable row says so by being struck through (`unreachable`).
    return value === null ? "" : `${value} ms`;
  };

  /*
   * Measured from here and found not to answer: a choice that cannot be
   * picked from this client, dimmed and struck through like any other. A
   * pinned route that has stopped answering reads the same way, with
   * Automatic above it as the way out.
   */
  const unreachable = (origin: string) => latency()[origin] === null;

  const activeServerPaths = () => {
    const entry = activeServer();
    return entry ? pathsOf(entry) : [];
  };

  /*
   * An installed client changes route in place. A browser navigates, for the
   * same reason it navigates between servers: its cookie, its storage and its
   * worker belong to the origin that served it, so another address is another
   * installation of this app however much it is the same machine behind it.
   * Offering the route anyway is the point -- the addresses were collapsed
   * into one server, and without this a browser would lose the only way it had
   * to reach the others.
   *
   * The address is made to prove itself first. Choosing a route is what sends
   * this client's token somewhere new, so "is that really the server" has to
   * be answered before the move rather than discovered by making it.
   */
  /** The route the client settled on, which is what "Automatic" resolved to. */
  const inUse = () => activeServerPaths().find((path) => path.origin === activePath());

  const chooseRoute = async (origin: string) => {
    const entry = activeServer();
    if (!entry) return;
    if (!isInstalledClient()) {
      // A standalone window cannot be sent anywhere and brought back. Nothing
      // offers this there, so reaching it means something went wrong; saying
      // nothing is better than ejecting somebody out of the app.
      if (isStandaloneBrowser()) return;
      if (origin !== AUTOMATIC && origin !== location.origin) location.assign(origin);
      return;
    }
    if (origin === AUTOMATIC) return clearActivePath({ manual: false });
    if (origin === entry.origin) return clearActivePath({ manual: true });

    setChecking(origin);
    setRouteError("");
    const proof = await proveServer(dialOrigin(origin, entry), entry.id || "", entry.publicKey || "");
    setChecking("");
    if (proof.ok) return setActivePath(origin, { manual: true });
    setRouteError(proof.reason === "unreachable" ? "That address did not answer."
      : proof.reason === "unverifiable" ? "This client cannot check a server's identity, so the route was left alone."
        : "That address answered, but it is not this server.");
  };

  // The arrow says "this opens elsewhere". A standalone window has no
  // elsewhere to open, so it is not offered the move and not shown the mark.
  const away = (entry: ServerEntry) => !isInstalledClient() && !isStandaloneBrowser() && entry.origin !== location.origin;

  return <><Menu onOpenChange={onOpenChange}>
    <MenuTrigger class="sidebar-user" tabIndex={-1} onPointerDown={() => { focusBefore = document.activeElement; }} onFocus={(event: FocusEvent) => {
      if (giveBack === undefined) return;
      const before = giveBack;
      giveBack = undefined;
      if (before instanceof HTMLElement && before.isConnected && before !== event.currentTarget) before.focus({ preventScroll: true });
      else (event.currentTarget as HTMLElement).blur();
    }} onMouseDown={(event: MouseEvent) => event.preventDefault()} aria-label={`${serverName()} · ${triggerDetail()}`} title={`${activeOrigin() || "No server"} — ${triggerDetail()}`}>
      <span class="sidebar-user-label"><strong>{serverName()}</strong><small>{triggerDetail()}</small></span>
      <span class={`server-status-indicator runtime-indicator runtime-indicator-${connectionTone()}`} aria-hidden="true">
        <Show when={props.connectivity === "connecting" || props.connectivity === "reconnecting"} fallback={<span class="runtime-indicator-dot" />}><Spinner class="size-3" /></Show>
      </span>
    </MenuTrigger>
    <MenuContent class="server-switcher-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
      <Show when={servers().length > 0}>
        <MenuGroup>
          <MenuLabel>Servers</MenuLabel>
          <MenuRadioGroup value={activeOrigin() || ""} onChange={(origin) => switchToServer(origin, isInstalledClient())}>
            <For each={servers()}>{(entry) =>
              <MenuRadioItem value={entry.origin} disabled={(!canReachOtherOrigins() && entry.origin !== location.origin)
                || (entry.origin !== activeOrigin() && pathsOf(entry).every((path) => unreachable(path.origin)))}>
                <span class="truncate">{entry.name}</span>
                <Show when={away(entry)}><ExternalLinkIcon class="size-3 text-muted-foreground" /></Show>
                <span class="server-row-latency ml-auto text-xs text-muted-foreground">{latencyLabel(entry.origin)}</span>
              </MenuRadioItem>}</For>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
      </Show>
      {/*
        * The routes to the server already open, which is a different question
        * from which server to open. Even one route says how it is reached.
        */}
      <Show when={activeServerPaths().length > 0}>
        <MenuGroup>
          {/*
            * One row for the route in use; every route behind it. Which route
            * is a rarer question than which server, so it does not take a
            * group's worth of the menu to ask.
            */}
          <MenuSub>
          <MenuSubTrigger class="server-route-choice">
            <span class="server-route-label"><span>Route</span>
              <Show when={inUse()}>{(path) => <code title={path().origin}>{serverPathLabel(path())} · {shortOrigin(path().origin)}</code>}</Show>
            </span>
          </MenuSubTrigger>
          <MenuSubContent class="server-switcher-menu server-route-menu">
          <MenuLabel>Route to {serverName()}</MenuLabel>
          {/*
            * An installed-to-home-screen browser is shown the routes and
            * offered none of them: it is one origin, and the only way it could
            * take another is to navigate, which would put the person in a
            * browser instead of the app they opened. The rows say so by being
            * unselectable; why they are is a fact about this client rather
            * than about this server, so it is stated once in Settings ->
            * Appearance -> About and not on top of the route list.
            */}
          <MenuRadioGroup value={pathIsPinned() ? activePath() || "" : AUTOMATIC} onChange={(origin) => void chooseRoute(origin)}>
            {/*
              * Left to itself, the client takes the nearest route that answers
              * and proves itself. Picking one by hand says otherwise, and is
              * respected until this is chosen again -- a route someone chose
              * should not be quietly overruled by something measuring in the
              * background.
              */}
            <Show when={isInstalledClient()}>
              <MenuRadioItem class="server-route-choice" value={AUTOMATIC}>
                <span class="server-route-label"><span>Automatic</span>
                  <Show when={inUse()}>{(path) => <code title={path().origin}>{serverPathLabel(path())} · {shortOrigin(path().origin)}</code>}</Show>
                </span>
                <span class="server-row-latency ml-auto text-xs text-muted-foreground">
                  {inUse() ? latencyLabel(inUse()!.origin) : ""}
                </span>
              </MenuRadioItem>
            </Show>
            <For each={activeServerPaths()}>{(path) =>
              <MenuRadioItem class="server-route-choice" value={path.origin} disabled={(!canReachOtherOrigins() && path.origin !== location.origin) || unreachable(path.origin)}>
                <span class="server-route-label"><span>{serverPathLabel(path)}</span><code title={path.origin}>{shortOrigin(path.origin)}</code></span>
                <Show when={!isInstalledClient() && !isStandaloneBrowser() && path.origin !== location.origin}><ExternalLinkIcon class="size-3 text-muted-foreground" /></Show>
                <span class="server-row-latency ml-auto text-xs text-muted-foreground">
                  {checking() === path.origin ? "Checking…" : latencyLabel(path.origin)}
                </span>
              </MenuRadioItem>}</For>
          </MenuRadioGroup>
          </MenuSubContent>
          </MenuSub>
          <Show when={routeError()}><MenuLabel class="server-route-error">{routeError()}</MenuLabel></Show>
        </MenuGroup>
        <MenuSeparator />
      </Show>
      <MenuItem onSelect={() => setTimeout(() => setPairing(true), 0)}><QrCodeIcon />Pair a device</MenuItem>
      <MenuItem onSelect={props.onAddServer}><PlusIcon />Add server</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onOpenSettings}>Manage settings</MenuItem>
      <MenuItem disabled={props.pwaUpdating} onSelect={props.onUpdatePwa}>
        <RefreshCwIcon class={props.pwaUpdating ? "pwa-update-icon pwa-update-icon-active" : "pwa-update-icon"} />
        {props.pwaUpdating ? "Checking for updates…" : "Check for updates"}
      </MenuItem>
      <MenuItem onSelect={props.onLogout}>{servers().length > 1 ? `Sign out of ${serverName()}` : "Sign out"}</MenuItem>
    </MenuContent>
  </Menu>
  <Show when={pairing()}><PairDialog open={pairing()} onOpenChange={setPairing} /></Show></>;
}
