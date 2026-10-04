import { createSignal, For, onCleanup, Show } from "solid-js";
import { connectionId } from "../state/runtime.ts";
import { api } from "../api/client.ts";
import { Trash2Icon } from "lucide-solid";
import { Button, Input } from "@/components/primitives";
import { Switch } from "./settings-controls";
import { clearNativeBearerToken } from "../api/native-auth-client.ts";
import { isInstalledClient, isStandaloneBrowser } from "../platform/installed-client.ts";
import { saveServerDirectory } from "../platform/server-directory.ts";
import {
  activeOrigin, activePath, forgetServer, learnIdentity, pathsOf, serverPathLabel, servers, setServerShared,
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
  const refresh = () => void api<{ clients?: Connection[] }>("/v0/runtime/clients")
    .then(({ clients = [] }) => { setConnected(clients); setNow(Date.now()); }).catch(() => {});
  refresh();
  const timer = setInterval(refresh, 10_000);
  onCleanup(() => clearInterval(timer));
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

  return <div class="settings-list">
    <For each={servers()}>{(entry) => <section class="settings-group" aria-label={entry.name}>
      <h3>{entry.name}</h3>
      <Show when={entry.id}>
        <div class="settings-line"><span>Identity</span><span class="settings-line-value"><code>{entry.id?.slice(0, 8)}</code></span></div>
      </Show>
      <Show when={entry.origin === activeOrigin() && connected().length}>
        <For each={connected()}>{(client) => <div class="settings-line">
          <span>{kindLabel(client.kind)}{client.id && client.id === connectionId() ? " · this client" : ""}</span>
          <span class="settings-line-value">{client.build || "older build"} · {since(client.connectedAt)}</span>
        </div>}</For>
      </Show>
      <Show when={entry.origin === activeOrigin()} fallback={
        <div class="settings-line"><span>Name</span><span class="settings-line-value">Rename it while connected to it</span></div>}>
        <label class="settings-line" title="The server's name, for every client and on the network."><span>Name</span>
          <Input aria-label={`Name of ${entry.name}`} value={entry.name}
            onChange={(event) => void rename(entry.origin, event.currentTarget.value)} /></label>
        <Show when={renameError()}><div class="settings-line"><span class="settings-line-value">{renameError()}</span></div></Show>
      </Show>
      <div class="settings-line"><span>Share with other clients</span>
        <Switch label={`Share ${entry.name} with other clients`} checked={entry.shared} onChange={(shared) => void share(entry.origin, shared)} /></div>
      {/*
        * Listed even when there is only one, because one address is still the
        * answer to "how does this client reach it" -- and a server that later
        * learns a second should read as having gained a route rather than as
        * having changed shape. The row says which one is in use, about the
        * address rather than about the server.
        */}
      <For each={pathsOf(entry)}>{(path) => <div class="settings-line" data-current={inUse(entry, path) || undefined}>
        <span><code>{path.origin}</code><em>{serverPathLabel(path)}</em></span>
        <span class="settings-line-value">{inUse(entry, path) ? "In use" : ""}</span>
      </div>}</For>
      {/* The one in use withholds only the button that would break it. */}
      <Show when={entry.origin !== activeOrigin()}>
        <div class="settings-line"><span>Forget this server</span>
          <Button variant="ghost" size="sm" aria-label={`Forget ${entry.name}`} onClick={() => void forget(entry.origin)}>
            <Trash2Icon /> Forget
          </Button></div>
      </Show>
    </section>}</For>
    <Show when={!servers().length}><p class="settings-line-note" data-tone="quiet">No servers yet.</p></Show>
    {/*
      * A standalone window is one origin and cannot be sent to another, so the
      * addresses above are shown to it as facts rather than as choices. Said
      * once, here, rather than beside every row it applies to.
      */}
    <Show when={isStandaloneBrowser() && servers().length > 0}>
      <p class="settings-line-note" data-tone="quiet">Installed to the home screen, so this app stays on the address it was installed from. Open another in a browser to use it.</p>
    </Show>
  </div>;
}
