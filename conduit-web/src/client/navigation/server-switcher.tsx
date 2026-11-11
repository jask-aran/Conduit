import { Icons, Note } from "@/components/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { DropdownMenu, MenuContent, MenuSection, MenuRow, MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";
import { Spinner } from "@/components/ui/controls";
import { Avatar, ServerControl } from "@/components/ui/connection";
import { accountName, accountPicture, loadAccount } from "../state/account";
import { isMobileLayout } from "./mobile-layout";
import { buildHttpUrl } from "../api/transport";
import { changesWaiting, heldWrites } from "../api/client";
import { proveServer } from "../platform/server-proof";
import { installerDownloads, type PublishedRelease } from "../platform/github-release";

const AUTOMATIC = "automatic";
import { canReachOtherOrigins, isInstalledClient, isStandaloneBrowser } from "../platform/installed-client.ts";
import { activePath, activeOrigin, activeServer, clearActivePath, dialOrigin, pathIsPinned, pathsOf, serverPathLabel, servers, setActivePath, switchToServer, type ServerEntry } from "../platform/servers.ts";

export const shortOrigin = (origin: string) => origin.replace(/^https?:\/\//, "");

const PROBE_TIMEOUT_MS = 4000;
const PROBE_INTERVAL_MS = 5000;
const FOCUS_GIVE_BACK_MS = 1000;

// `/healthz` needs no session, so a server this client has never signed in to still reports whether it is reachable.
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

// A browser page cannot measure another origin: Conduit grants cross-origin access to the installed shells only.
const canProbe = (origin: string) => isInstalledClient() || origin === location.origin;

export function ServerSwitcher(props: {
  connectivity: string;
  compact?: boolean;
  inline?: boolean;
  pwaUpdating: boolean;
  onOpenSettings: (section?: string) => void;
  onUpdatePwa: () => void;
  onAddServer: () => void;
  onLogout: () => void;
  downloads?: boolean;
}) {
  const [release, setRelease] = createSignal<Pick<PublishedRelease, "windowsUrl" | "apkUrl"> | null>(null);
  const releasesPage = "https://github.com/jask-aran/Conduit/releases/latest";
  onMount(() => { if (props.downloads) void installerDownloads().then(setRelease).catch(() => setRelease(null)); });
  const download = (url?: string | null) => window.open(url || releasesPage, "_blank", "noopener,noreferrer");
  const [latency, setLatency] = createSignal<Record<string, number | null>>({});
  const [probing, setProbing] = createSignal(false);
  const [checking, setChecking] = createSignal("");
  const [routeError, setRouteError] = createSignal("");
  let timer: ReturnType<typeof setInterval> | undefined;

  // Every address of every server, not just the one each is filed under: a path that cannot be reached from this
  // network has to be able to say so.
  const allPaths = () => servers().flatMap((entry) => pathsOf(entry).map((path) => ({ origin: path.origin, entry })));

  const measure = async () => {
    setProbing(true);
    // Timed as each route is really dialled, https included.
    const measured = await Promise.all(allPaths().map(async ({ origin, entry }) =>
      [origin, canProbe(origin) ? await probe(dialOrigin(origin, entry)) : undefined] as const));
    setLatency(Object.fromEntries(measured.filter(([, value]) => value !== undefined)) as Record<string, number | null>);
    setProbing(false);
  };

  // Probes run only while the menu is open: links may be metered.
  // The menu library focuses its trigger once it has closed, whatever it is told, so that focus is passed back on.
  let focusBefore: Element | null = null;
  let giveBack: Element | null | undefined;
  const onOpenChange = (open: boolean) => {
    clearInterval(timer);
    if (open) void loadAccount();
    if (!open) {
      giveBack = focusBefore;
      focusBefore = null;
      setTimeout(() => { giveBack = undefined; }, FOCUS_GIVE_BACK_MS);
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


  const serverName = () => activeServer()?.name || "Conduit";
  const activeLatency = () => {
    const origin = activePath();
    const value = origin ? latency()[origin] : undefined;
    return typeof value === "number" ? ` · ${value} ms` : "";
  };
  const waitingLabel = () => heldWrites() ? ` · ${changesWaiting(heldWrites())}` : "";
  const triggerDetail = () => `${connectionLabel()}${waitingLabel()}${activeLatency()}`;

  const latencyLabel = (origin: string) => {
    if (!canProbe(origin)) return "";
    const value = latency()[origin];
    if (value === undefined) return probing() ? "…" : "";
    return value === null ? "" : `${value} ms`;
  };

  const unreachable = (origin: string) => latency()[origin] === null;

  const activeServerPaths = () => {
    const entry = activeServer();
    // "This machine" is offered only while it answers from here: unlike a
    // network or internet route, one that does not is not a route this
    // client could have, so it is left out rather than struck through.
    return entry ? pathsOf(entry).filter((path) => path.scope !== "loopback"
      || path.origin === activePath() || typeof latency()[path.origin] === "number") : [];
  };

  /*
   * A browser navigates rather than changing route in place: its cookie, storage and worker belong to the origin that
   * served it. An installed client proves the address first, since choosing a route sends its token somewhere new.
   */
  const inUse = () => activeServerPaths().find((path) => path.origin === activePath());

  const chooseRoute = async (origin: string) => {
    const entry = activeServer();
    if (!entry) return;
    if (!isInstalledClient()) {
      // A standalone window cannot be sent anywhere and brought back.
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

  // Read as the menu opens; its content mounts afresh each time.
  const phone = () => isMobileLayout();
  const RouteChoices = () => <MenuSection title={`Route to ${serverName()}`}>
    <MenuRadioGroup value={pathIsPinned() ? activePath() || "" : AUTOMATIC} onChange={(origin) => void chooseRoute(origin)}>
      <Show when={isInstalledClient()}>
        <MenuRadioItem value={AUTOMATIC}
          detail={inUse() ? `${serverPathLabel(inUse()!)} · ${shortOrigin(inUse()!.origin)}` : undefined}
          meta={inUse() ? latencyLabel(inUse()!.origin) : ""}>Automatic</MenuRadioItem>
      </Show>
      <For each={activeServerPaths()}>{(path) =>
        <MenuRadioItem value={path.origin} title={path.origin} detailData detail={shortOrigin(path.origin)}
          disabled={(!canReachOtherOrigins() && path.origin !== location.origin) || unreachable(path.origin)}
          away={!isInstalledClient() && !isStandaloneBrowser() && path.origin !== location.origin}
          meta={checking() === path.origin ? "Checking…" : latencyLabel(path.origin)}>{serverPathLabel(path)}</MenuRadioItem>
      }</For>
    </MenuRadioGroup>
  </MenuSection>;
  const routeDetail = () => inUse() ? `${serverPathLabel(inUse()!)} · ${shortOrigin(inUse()!.origin)}` : undefined;

  return <><DropdownMenu onOpenChange={onOpenChange}>
    <DropdownMenu.Trigger as={ServerControl} compact={props.compact} inline={props.inline} name={serverName()} detail={triggerDetail()} connectivity={props.connectivity}
      tabIndex={-1} onPointerDown={() => { focusBefore = document.activeElement; }} onFocus={(event: FocusEvent) => {
        if (giveBack === undefined) return;
        const before = giveBack;
        giveBack = undefined;
        if (before instanceof HTMLElement && before.isConnected && before !== event.currentTarget) before.focus({ preventScroll: true });
        else (event.currentTarget as HTMLElement).blur();
      }} onMouseDown={(event: MouseEvent) => event.preventDefault()} aria-label={`${serverName()} · ${triggerDetail()}`} title={`${activeOrigin() || "No server"} — ${triggerDetail()}`} />
    <MenuContent width="md" height="2xl" onCloseAutoFocus={(event) => event.preventDefault()}>
      <Show when={servers().length > 0}>
        <MenuSection title="Servers">
          <MenuRadioGroup value={activeOrigin() || ""} onChange={(origin) => switchToServer(origin, isInstalledClient())}>
            <For each={servers()}>{(entry) =>
              <MenuRadioItem value={entry.origin} disabled={(!canReachOtherOrigins() && entry.origin !== location.origin)
                || (entry.origin !== activeOrigin() && pathsOf(entry).every((path) => unreachable(path.origin)))}
                away={away(entry)} meta={latencyLabel(entry.origin)}>{entry.name}</MenuRadioItem>
            }</For>
          </MenuRadioGroup>
          <Show when={activeServerPaths().length > 0}>
            <MenuSub phone={phone()}>
              <MenuSubTrigger detailData detail={routeDetail()} title={inUse()?.origin}>Route</MenuSubTrigger>
              <MenuSubContent><RouteChoices /><Show when={routeError()}><Note kind="menu" tone="error">{routeError()}</Note></Show></MenuSubContent>
            </MenuSub>
            <Show when={routeError()}><Note kind="menu" tone="error">{routeError()}</Note></Show>
          </Show>
        </MenuSection>
      </Show>
      <MenuSection title="App">
        <MenuRow disabled={props.pwaUpdating} onSelect={props.onUpdatePwa} icon={<Show when={props.pwaUpdating} fallback={<Icons.Refresh />}><Spinner /></Show>}>
          {props.pwaUpdating ? "Checking for updates…" : "Check for updates"}
        </MenuRow>
        <Show when={props.downloads}>
          <MenuRow icon={<Icons.Download />} onSelect={() => download(release()?.windowsUrl)}>Download for Windows</MenuRow>
          <MenuRow icon={<Icons.Download />} onSelect={() => download(release()?.apkUrl)}>Download for Android</MenuRow>
        </Show>
      </MenuSection>
      <MenuSection title="Account">
        <MenuRow icon={<Avatar name={accountName()} src={accountPicture()} />} onSelect={() => props.onOpenSettings("account")}>{accountName() || "Add your name"}</MenuRow>
        <MenuRow icon={<Icons.QrCode />} onSelect={() => setTimeout(() => props.onAddServer())}>Connect a device or server</MenuRow>
        <MenuRow icon={<Icons.Settings />} onSelect={props.onOpenSettings}>Manage settings</MenuRow>
        <MenuRow destructive icon={<Icons.LogOut />} onSelect={props.onLogout}>{servers().length > 1 ? `Sign out of ${serverName()}` : "Sign out"}</MenuRow>
      </MenuSection>
    </MenuContent>
  </DropdownMenu>
  </>;
}
