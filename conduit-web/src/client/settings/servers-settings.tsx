import { For, Show } from "solid-js";
import { Trash2Icon } from "lucide-solid";
import { Button, Input } from "@/components/primitives";
import { clearNativeBearerToken } from "../api/native-auth-client.ts";
import { isInstalledClient, isStandaloneBrowser } from "../platform/installed-client.ts";
import { saveServerDirectory } from "../platform/server-directory.ts";
import {
  activeOrigin, activePath, forgetServer, pathsOf, renameServer, servers, setServerShared,
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

  const rename = async (origin: string, name: string) => {
    renameServer(origin, name);
    await saveServerDirectory();
  };

  const share = async (origin: string, shared: boolean) => {
    setServerShared(origin, shared);
    await saveServerDirectory();
  };

  // What the address is, rather than what it says: "this machine" is the
  // useful fact about 127.0.0.1, and it is the same fact on every client.
  const reach = (path: ServerPath) => path.scope === "loopback" ? "This machine"
    : path.scope === "private" ? "This network" : "Anywhere";

  const inUse = (entry: ServerEntry, path: ServerPath) =>
    entry.origin === activeOrigin() && path.origin === (activePath() || activeOrigin());

  return <section class="settings-section-block">
    <For each={servers()}>{(entry) => <div class="settings-server">
      <div class="settings-server-row">
        <Input aria-label={`Name for ${entry.name}`} value={entry.name}
          onChange={(event) => void rename(entry.origin, event.currentTarget.value)} />
        <label class="settings-server-share"><input type="checkbox" aria-label={`Share ${entry.name} with other clients`}
          checked={entry.shared} onChange={(event) => void share(entry.origin, event.currentTarget.checked)} />Share with other clients</label>
        {/* The route below says which one is in use, and says it about the
            address rather than about the server, so the row does not repeat
            it -- it only withholds the button that would break it. */}
        <Show when={entry.origin !== activeOrigin()}>
          <Button variant="ghost" size="sm" aria-label={`Forget ${entry.name}`} onClick={() => void forget(entry.origin)}>
            <Trash2Icon /> Forget
          </Button>
        </Show>
      </div>
      {/*
        * Listed even when there is only one, because one address is still the
        * answer to "how does this client reach it" -- and a server that later
        * learns a second should read as having gained a route rather than as
        * having changed shape.
        */}
      <ul class="settings-server-paths">
        <For each={pathsOf(entry)}>{(path) => <li data-current={inUse(entry, path) || undefined}>
          <code>{path.origin}</code>
          <span>{reach(path)}</span>
          <Show when={inUse(entry, path)}><em>In use</em></Show>
        </li>}</For>
      </ul>
    </div>}</For>
    <Show when={!servers().length}><p class="settings-note">No servers yet.</p></Show>
    {/*
      * A standalone window is one origin and cannot be sent to another, so the
      * addresses above are shown to it as facts rather than as choices. Said
      * once, here, rather than beside every row it applies to.
      */}
    <Show when={isStandaloneBrowser() && servers().length > 0}>
      <p class="settings-note">Installed to the home screen, so this app stays on the address it was installed from. Open another in a browser to use it.</p>
    </Show>
  </section>;
}
