import { PasswordGroup, SignInsGroup } from "./sign-ins-settings";
import { createSignal, For, Show, type JSX } from "solid-js";
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
 * Another server is inspected, not changed: the installed apps ask it with the sign-in they keep for it; a browser
 * can only ask its own.
 */
export function ServerSettings(props: { projects: Project[]; runtime?: JSX.Element }) {
  const health = createServerHealth();
  const [inspected, setInspected] = createSignal(activeOrigin() || "");
  const net = createNetwork({ origin: inspected, projects: () => props.projects });
  const { entry, active, readable, devices, network, hubDevice, hubNode, server, projects } = net;

  return <>
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
    <Show when={!readable()}><Note tone="quiet">Switch to {entry()?.name} to see its network.</Note></Show>
    <Show when={hubNode()}>{(node) => <Note>{server()} runs on {hubDevice()!.name} · {node().name}</Note>}</Show>

    <Show when={devices()}><Reading>
      <ReadingStats title="On the network">
        <ReadingStat label="Devices" value={network().length} />
        <ReadingStat label="Clients" value={network().reduce((sum, device) => sum + device.clients.filter((shown) => shown.part.online).length, 0)} detail="connected" />
        <ReadingStat label="Workspaces" value={projects().filter(isWorkspace).length} />
      </ReadingStats>
    </Reading></Show>
    {/* Only the server this client is on can be asked. */}
    <Show when={active()}><MachineReadout open /></Show>
    <Show when={hubNode()}>{(node) => <DeviceHarnesses node={node()} />}</Show>
    <Show when={active()}>{props.runtime}</Show>
    <Show when={entry()}>{(known) => <ServerFacts entry={known()} health={health} />}</Show>
    <Show when={net.error()}><Note tone="error">{net.error()}</Note></Show>
    <Show when={active()}><SignInsGroup /><PasswordGroup /></Show>
  </>;
}
