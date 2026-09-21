import { For, Show } from "solid-js";
import { CableIcon, ChevronRightIcon, Trash2Icon } from "lucide-solid";
import { Button, Input } from "@/components/primitives";
import { clearNativeBearerToken } from "../api/native-auth-client.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { saveServerDirectory } from "../platform/server-directory.ts";
import { activeOrigin, forgetServer, renameServer, servers, setServerShared } from "../platform/servers.ts";

/**
 * The servers this client knows, and the only place one can be removed.
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
  const active = () => servers().find((entry) => entry.origin === activeOrigin());

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

  return <details class="settings-tile" open>
    <summary><span><CableIcon /><strong>Servers</strong>
      <small>{servers().length === 1 ? "One server" : `${servers().length} servers`} · on {active()?.name || "none"}</small>
    </span><ChevronRightIcon class="settings-chevron" aria-hidden="true" /></summary>
    <div class="settings-disclosure-content">
      <p class="settings-note">A shared address is kept by every server you sign in to and handed to the next client that connects, so it is entered once. An address that is not shared stays on this device. Loopback starts unshared, because <code>127.0.0.1</code> means a different machine on each one.</p>
      <For each={servers()}>{(entry) => <div class="settings-server-row">
        <Input aria-label={`Name for ${entry.origin}`} value={entry.name}
          onChange={(event) => void rename(entry.origin, event.currentTarget.value)} />
        <code>{entry.origin}</code>
        <label class="settings-server-share"><input type="checkbox" aria-label={`Share ${entry.name} with other clients`}
          checked={entry.shared} onChange={(event) => void share(entry.origin, event.currentTarget.checked)} />Share</label>
        <Show when={entry.origin === activeOrigin()} fallback={
          <Button variant="ghost" size="sm" aria-label={`Forget ${entry.name}`} onClick={() => void forget(entry.origin)}>
            <Trash2Icon /> Forget
          </Button>
        }><span class="settings-server-current">In use</span></Show>
      </div>}</For>
      <Show when={!servers().length}><p class="settings-note">No servers yet.</p></Show>
    </div>
  </details>;
}
