import { PasswordGroup, SignInsGroup } from "./sign-ins-settings";
import { createSignal, For, Show } from "solid-js";
import { DropdownMenu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSection } from "@/components/ui/menus";
import { ServerControl } from "@/components/ui/connection";
import { activeOrigin, servers, switchToServer } from "../platform/servers.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { createServerHealth, ServerFacts } from "./server-inspect.tsx";
import type { Project } from "../api/contracts";
import { Button } from "@/components/ui/controls";
import { Reading, ReadingStat, ReadingStats } from "@/components/ui/reading";
import { SettingLine } from "@/components/ui/overlay";
import { Note } from "@/components/ui/state";
import { MachineReadout } from "./machine-readout.tsx";
import { createNetwork, DeviceHarnesses, isWorkspace } from "./network-state.tsx";

/**
 * The servers this client knows, one at a time: picked at the top (each with its status), then the server's figures --
 * what its network holds, the machine it runs on, its harnesses -- and what this client knows of it. Another server is
 * inspected, not changed: the installed apps ask it with the sign-in they keep for it; a browser can only ask its own,
 * and offers Switch to.
 */
export function ServerSettings(props: { projects: Project[] }) {
  const health = createServerHealth();
  const [inspected, setInspected] = createSignal(activeOrigin() || "");
  const net = createNetwork({ origin: inspected, projects: () => props.projects });
  const { entry, active, readable, devices, network, hubDevice, hubNode, server, projects } = net;

  return <>
    {/* Which server: each with its status, the one in use first; picking one inspects it, Switch to uses it. */}
    <SettingLine plain label={<DropdownMenu>
        <DropdownMenu.Trigger as={ServerControl} inline name={entry()?.name || "No server"} detail={entry() ? health.status(entry()!) : ""}
          connectivity={entry() ? health.connectivity(entry()!) : "unknown"} aria-label={`Server: ${entry()?.name || "none"}`} />
        <MenuContent width="md">
          <MenuSection title="Servers">
            <MenuRadioGroup value={inspected()} onChange={setInspected}>
              <For each={[...servers()].sort((a, b) => Number(b.origin === activeOrigin()) - Number(a.origin === activeOrigin()))}>{(item) =>
                <MenuRadioItem value={item.origin} meta={health.status(item)}>{item.name}</MenuRadioItem>}</For>
            </MenuRadioGroup>
          </MenuSection>
        </MenuContent>
      </DropdownMenu>}>
      <Show when={!active() && entry()}>
        <Button variant="ghost" size="sm" onClick={() => switchToServer(entry()!.origin, isInstalledClient())}>Switch to {entry()!.name}</Button>
      </Show>
    </SettingLine>
    <Show when={!readable()}><Note tone="quiet">A browser can only ask the server it is on. Switch to {entry()?.name} to see its network.</Note></Show>
    <Show when={hubNode()}>{(node) => <Note>{server()} runs on {hubDevice()!.name} · {node().name}</Note>}</Show>

    {/* What the server holds, read at a glance: figures as the gauge's tiles. */}
    <Show when={devices()}><Reading>
      <ReadingStats title="On the network">
        <ReadingStat label="Devices" value={network().length} />
        <ReadingStat label="Clients" value={network().reduce((sum, device) => sum + device.clients.filter((shown) => shown.part.online).length, 0)} detail="connected" />
        <ReadingStat label="Workspaces" value={projects().filter(isWorkspace).length} />
      </ReadingStats>
    </Reading></Show>
    {/* The machine it runs on, read while the page shows; only the server this client is on can be asked. */}
    <Show when={active()}><MachineReadout open /></Show>
    <Show when={hubNode()}>{(node) => <DeviceHarnesses node={node()} />}</Show>
    <Show when={entry()}>{(known) => <ServerFacts entry={known()} health={health} />}</Show>
    <Show when={net.error()}><Note tone="error">{net.error()}</Note></Show>
    {/* Who is signed in to it, and its password: the server in use's (another is switched to first). */}
    <Show when={active()}><SignInsGroup /><PasswordGroup /></Show>
  </>;
}
