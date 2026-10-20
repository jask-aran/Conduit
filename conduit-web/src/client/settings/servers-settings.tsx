import { createSignal, For, onCleanup, Show } from "solid-js";
import { buildHttpUrl } from "../api/transport";
import { connectionId } from "../state/runtime.ts";
import { api } from "../api/client.ts";
import { Trash2Icon } from "lucide-solid";
import { Button, Input, Switch } from "@/components/ui/controls";
import { StatusDot } from "@/components/ui/nav";
import { SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";
import { clearNativeBearerToken } from "../api/native-auth-client.ts";
import { isInstalledClient, isStandaloneBrowser } from "../platform/installed-client.ts";
import { saveServerDirectory } from "../platform/server-directory.ts";
import {
  activeOrigin, activePath, dialOrigin, forgetServer, learnIdentity, pathIsPinned, pathsOf, serverPathLabel, servers, setServerShared, switchToServer,
  type ServerEntry, type ServerPath,
} from "../platform/servers.ts";

/**
 * The servers this client knows, and the only place one can be removed.
 *
 * A server is one thing with several ways in. The addresses underneath a name
 * are that server's routes, not other servers: the same machine answers on
 * every one of them, and which is in use is a fact about this client's
 * position rather than about the server. So the name, the sharing and the
 * forgetting belong to the identity, and the addresses are listed under it
 * with what each one costs to reach.
 *
 * Forgetting has to reach the directory as well as this device. The list is
 * shared through whichever server is being talked to, so an address dropped
 * only here comes back the next time anything connects -- removing it locally
 * and saying nothing would look like the delete had failed.
 *
 * The one being used cannot be forgotten. There is nothing sensible on the
 * other side of that click: the client would be signed in to a server it no
 * longer lists, with no way back to it.
 */
export function ServersSettingsTile() {
  const forget = async (origin: string) => {
    forgetServer(origin);
    await saveServerDirectory();
    // The token outlives the address unless it is dropped with it, and a
    // credential for a server nobody lists is one nothing can ever use again.
    if (isInstalledClient()) await clearNativeBearerToken(origin);
  };

  // The server owns its name, so a rename goes to it and comes back to every
  // client from there. Only the server this client is connected to can be
  // asked; the others are renamed from a client connected to them.
  const [renameError, setRenameError] = createSignal("");
  // Every live connection to the server this client is on: each tab, app and
  // desktop client on its own line, refreshed while this page is open.
  type Connection = { id?: string; kind: string; build: string; connectedAt: string };
  const [connected, setConnected] = createSignal<Connection[]>([]);
  const [now, setNow] = createSignal(Date.now());
  /*
   * Every route of every server, asked how long it takes and what it runs.
   * `/healthz` needs no session; a browser can only ask its own origin
   * (cross-origin access is granted to the installed shells), so it says
   * nothing about the rest rather than calling them unreachable.
   */
  type Health = { ms: number; release: string; startedAt: string } | null;
  const [health, setHealth] = createSignal<Record<string, Health>>({});
  const canProbe = (origin: string) => isInstalledClient() || origin === location.origin;
  const ask = async (origin: string, entry: ServerEntry): Promise<Health> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const started = performance.now();
    try {
      const response = await fetch(buildHttpUrl("/healthz", dialOrigin(origin, entry)), { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({})) as { release?: string; startedAt?: string };
      return { ms: Math.round(performance.now() - started), release: body.release || "", startedAt: body.startedAt || "" };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const probeAll = async () => {
    const pairs = await Promise.all(servers().flatMap((entry) => pathsOf(entry)
      .filter((path) => canProbe(path.origin))
      .map(async (path) => [path.origin, await ask(path.origin, entry)] as const)));
    setHealth(Object.fromEntries(pairs));
  };
  const refresh = () => {
    void api<{ clients?: Connection[] }>("/v0/runtime/clients")
      .then(({ clients = [] }) => { setConnected(clients); setNow(Date.now()); }).catch(() => {});
    void probeAll();
  };
  refresh();
  const timer = setInterval(refresh, 10_000);
  onCleanup(() => clearInterval(timer));
  // A dev build's stamp carries its build time; the version and commit say which.
  const shortBuild = (build: string) => build ? build.replace(/\.\d{14}\./, " · ") : "Older build";
  const kindLabel = (kind: string) => kind === "android" ? "Android" : kind === "desktop" ? "Desktop" : "Browser";
  const since = (at: string) => {
    const minutes = Math.max(0, Math.round((now() - Date.parse(at)) / 60_000));
    return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  };
  const rename = async (origin: string, name: string) => {
    setRenameError("");
    try {
      const identity = await api<{ id?: string; name?: string; publicKey?: string; paths?: unknown }>("/v0/server/name", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
      });
      learnIdentity(origin, identity);
      await saveServerDirectory();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "The server did not take that name.");
    }
  };

  const share = async (origin: string, shared: boolean) => {
    setServerShared(origin, shared);
    await saveServerDirectory();
  };

  const inUse = (entry: ServerEntry, path: ServerPath) =>
    entry.origin === activeOrigin() && path.origin === (activePath() || activeOrigin());
  const isActive = (entry: ServerEntry) => entry.origin === activeOrigin();
  // What the server says about itself: through the route in use, else the
  // quickest one that answered.
  const serverHealth = (entry: ServerEntry) => {
    const answers = pathsOf(entry).map((path) => ({ path, health: health()[path.origin] })).filter((item) => item.health);
    return (answers.find((item) => inUse(entry, item.path)) ?? answers.sort((a, b) => a.health!.ms - b.health!.ms)[0])?.health ?? null;
  };
  const measured = (entry: ServerEntry) => pathsOf(entry).some((path) => path.origin in health());
  const reachable = (entry: ServerEntry) => serverHealth(entry) !== null;
  const status = (entry: ServerEntry) => {
    const answer = serverHealth(entry);
    const where = isActive(entry) ? "In use" : "Not in use";
    if (answer) return `${where} · ${answer.ms}ms`;
    return measured(entry) ? `${where} · Not answering` : where;
  };
  const tone = (entry: ServerEntry) => reachable(entry) ? (isActive(entry) ? "success" : "muted") : measured(entry) ? "danger" : "muted";
  const uptime = (startedAt: string) => {
    const minutes = Math.max(0, Math.round((now() - Date.parse(startedAt)) / 60_000));
    if (minutes < 60) return `up ${minutes}m`;
    if (minutes < 1440) return `up ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `up ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  };
  const routeValue = (entry: ServerEntry, path: ServerPath) => {
    const answer = health()[path.origin];
    const parts = [inUse(entry, path) ? (pathIsPinned() ? "Pinned · in use" : "In use") : ""];
    if (answer) parts.push(`${answer.ms}ms`);
    else if (path.origin in health()) parts.push("Not answering");
    return parts.filter(Boolean).join(" · ");
  };
  const switchTo = (origin: string) => switchToServer(origin, isInstalledClient());

  return <>
    <For each={[...servers()].sort((a, b) => Number(isActive(b)) - Number(isActive(a)))}>{(entry) => <SettingGroup title={entry.name}>
      <SettingLine label={status(entry)} plain>
        <StatusDot label={status(entry)} tone={tone(entry)} />
        <Show when={!isActive(entry)}>
          <Button variant="ghost" size="sm" onClick={() => switchTo(entry.origin)}>Switch to</Button>
          <Button variant="ghost" size="sm" aria-label={`Forget ${entry.name}`} onClick={() => void forget(entry.origin)}>
            <Trash2Icon /> Forget
          </Button>
        </Show>
      </SettingLine>
      <Show when={serverHealth(entry)}>{(answer) =>
        <SettingNote>{shortBuild(answer().release)}{answer().startedAt ? ` · ${uptime(answer().startedAt)}` : ""}</SettingNote>}</Show>

      <Show when={isActive(entry)} fallback={
        <SettingLine label="Name" title="A server is renamed from a client connected to it." plain><SettingValue>{entry.name}</SettingValue></SettingLine>}>
        <SettingLine label="Name" title="The server's name, for every client and on the network.">
          <Input aria-label={`Name of ${entry.name}`} value={entry.name}
            onChange={(event) => void rename(entry.origin, event.currentTarget.value)} /></SettingLine>
        <Show when={renameError()}><SettingNote>{renameError()}</SettingNote></Show>
      </Show>
      <SettingLine label="Share with other clients">
        <Switch label={`Share ${entry.name} with other clients`} checked={entry.shared} onChange={(shared) => void share(entry.origin, shared)} /></SettingLine>
      <Show when={entry.id}>
        <SettingLine label="Identity" title={`The server's identity key, which vouches for its TLS certificate.${entry.publicKey ? `\n${entry.publicKey}` : ""}`} plain>
          <SettingValue mono>{entry.id?.slice(0, 8)}{entry.tls ? " · TLS verified" : ""}</SettingValue></SettingLine>
      </Show>

      {/* Its routes, listed even when there is only one: how this client reaches it. Chosen in the server switcher, which proves the identity first. */}
      <For each={pathsOf(entry)}>{(path) => <SettingLine label={serverPathLabel(path)} state={path.origin.replace(/^https?:\/\//, "")} plain>
        <SettingValue>{routeValue(entry, path)}</SettingValue>
      </SettingLine>}</For>

      {/* Live connections, so only the server this client is on can say. */}
      <Show when={isActive(entry) && connected().length}>
        <SettingLine label="Connected" plain><SettingValue>{connected().length}</SettingValue></SettingLine>
        <For each={connected()}>{(client) => <SettingLine label={kindLabel(client.kind)} state={client.id && client.id === connectionId() ? "This client" : ""} plain>
          <SettingValue>{shortBuild(client.build)} · {since(client.connectedAt)}</SettingValue>
        </SettingLine>}</For>
      </Show>
    </SettingGroup>}</For>
    <Show when={!servers().length}><SettingNote tone="quiet">No servers yet.</SettingNote></Show>
    {/*
      * A standalone window is one origin and cannot be sent to another, so the
      * addresses above are shown to it as facts rather than as choices. Said
      * once, here, rather than beside every row it applies to.
      */}
    <Show when={isStandaloneBrowser() && servers().length > 0}>
      <SettingNote tone="quiet">Installed to the home screen, so this app stays on the address it was installed from. Open another in a browser to use it.</SettingNote>
    </Show>
  </>;
}
