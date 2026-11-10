import { createSignal, For, onMount, Show } from "solid-js";
import { api } from "../api/client.ts";
import { activeOrigin } from "../platform/servers.ts";
import type { Project } from "../api/contracts";
import { Button, Input, Switch } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavFolder, NavFolderRow, StatusDot } from "@/components/ui/nav";
import { ClientCard, ClientCards, ClientPlaces, NetworkMap } from "@/components/ui/network";
import { LiveNote, SettingLine, SettingTitle, SettingValue } from "@/components/ui/overlay";
import { WorkspaceGlyph } from "../project/workspace-appearance.tsx";
import { desktopShell, type CompanionStatus, type DesktopShellSettings } from "../platform/installed-client.ts";
import { pairingWith, pairThisComputer, keepThisComputerConnected } from "../platform/this-computer.ts";
import { NetworkSettings } from "./network-settings.tsx";
import { PersonBrowsersSettings } from "./person-browsers-settings.tsx";
import { MachineReadout } from "./machine-readout.tsx";
import { createNetwork, DeviceHarnesses, mountedOn, together, type Device, type Node, type Shown, type ShownDevice } from "./network-state.tsx";
import { createPushControl } from "../platform/push.ts";
import { Row } from "@/components/ui/row";
import { Columns, Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { Actions } from "@/components/ui/actions";

type AddWorkspace = (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;

/** A shared folder's name: the last part of its path (the whole path is its title). */
const folderName = (label: string) => label.split(/[\\/]/).filter(Boolean).at(-1) || label;

/**
 * The network of the server in use: its map, this device (named here, and where its sharing is set), the network's
 * settings and every other device, each opening to its clients' cards. The server itself, and any other server this
 * client knows, is Settings › Server.
 *
 * A device (a PC, a phone) holds clients: environments (its Windows, a WSL distro) whose node (`conduit-node`) mounts
 * folders on the network as workspaces, and apps or browsers driving Conduit; Windows with the app open on it is one
 * client. The hub's environment mounts the server's own workspaces. A browser is a device of its own.
 */
export function DevicesSettingsTile(props: {
  /** Which section it draws: "device", this device alone (Settings › This device); "network", the network and the others on it. */
  part: "device" | "network";
  projects: Project[]; onAddWorkspace: AddWorkspace;
  /** A terminal on the device itself, in its home: this server's "computer" one, or a device's where a folder is shared with commands. */
  onOpenTerminal: (node: { id: string; local?: boolean }) => void;
  /** Its browser, in a pane beside (roadmap #9): a device that offers one. */
  onOpenBrowser?: (nodeId: string) => void;
  onOpenWorkspace: (project: Project) => void }) {
  // Notifications on this device from the hub it is using (Web Push; UnifiedPush on Android).
  const notifications = createPushControl();
  onMount(() => void notifications.refresh());
  // The server in use's network; another server is inspected on the Server page.
  let companion: ReturnType<typeof createCompanion> | null = null;
  const net = createNetwork({ origin: () => activeOrigin() || "", projects: () => props.projects,
    own: () => companion?.pairing()?.nodeId ?? null, onRefresh: () => companion?.read() });
  const { devices, setError, refresh, network, hubDevice, hubNode, server, active, projects } = net;
  // This app's own client: its companion, paired with this server or not.
  companion = desktopShell ? createCompanion(devices, () => refresh()) : null;
  companion?.read();
  const [open, setOpen] = createSignal<Set<string>>(new Set());

  const fail = (fallback: string) => (cause: unknown) => setError(cause instanceof Error ? cause.message : fallback);
  const forget = (node: Node) => api(`/v0/nodes/${node.id}`, { method: "DELETE" }).then(refresh, fail("The client was not unpaired."));
  const rename = (device: ShownDevice, name: string) => {
    if (!name.trim() || name.trim() === device.name) return;
    void api(`/v0/devices/${device.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
      .then(refresh, fail("The device was not renamed."));
  };
  const toggle = (id: string) => setOpen((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next; });

  const thisDevice = () => network().find((device) => device.clients.some((shown) => shown.mine)) ?? null;
  const others = () => network().filter((device) => device !== thisDevice());

  const status = (shown: Shown) => !shown.node || shown.node.online || shown.part.headed ? "Connected" : shown.node.lastSeenAt
    ? `Offline since ${new Date(shown.node.lastSeenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not connected yet";
  // What a client mounts: the hub's environment the server's own workspaces, any other the ones made from its folders.
  const mounted = (node: Node) => mountedOn(projects(), node);
  const unmounted = (node: Node) => node.local ? [] : node.roots.filter((root) => !projects().some((project) => project.nodeId === node.id && project.place?.root === root.id));

  /** A client of another device, as a card: what it mounts, a terminal there, unpairing it. */
  const card = (shown: Shown) => {
    // Another server's network is inspected, not changed.
    if (!active()) return <ClientCard client={shown.part} status={status(shown)} places={<Show when={shown.node}>{(node) =>
      <ClientPlaces none={!mounted(node()).length}><For each={mounted(node())}>{(project) =>
        <Row density="nav" element="button" lead={<WorkspaceGlyph appearance={project.workspaceAppearance} />} disabled>{project.name}</Row>}</For></ClientPlaces>}</Show>} />;
    return <ClientCard client={shown.part} status={status(shown)}
      places={<Show when={shown.node}>{(node) => <ClientPlaces none={!mounted(node()).length && !unmounted(node()).length}>{places(node(), false)}</ClientPlaces>}</Show>}
      actions={<>
        <Show when={shown.node?.online && (shown.node.local || shown.node.terminal)}>
          <Button variant="ghost" size="sm" onClick={() => props.onOpenTerminal(shown.node!)}><Icons.Terminal /> Terminal</Button>
        </Show>
        <Show when={shown.node?.online && shown.node.browser && !shown.node.local && props.onOpenBrowser}>
          <Button variant="ghost" size="sm" aria-label={`Open ${shown.part.name}'s browser`} onClick={() => props.onOpenBrowser!(shown.node!.id)}><Icons.Browser /> Browser</Button>
        </Show>
        <Show when={shown.node && !shown.node.local}>
          <Button variant="ghost" size="sm" aria-label={`Unpair ${shown.part.name}`} onClick={() => void forget(shown.node!)}>Unpair</Button>
        </Show>
      </>} />;
  };
  /** A client's workspaces as rows (opening them), then folders it shares that are no workspace yet (mounting them). */
  const places = (node: Node, named: boolean) => <>
    <For each={mounted(node)}>{(project) =>
      <Row density="nav" element="button" lead={<WorkspaceGlyph appearance={project.workspaceAppearance} />} meta={named ? node.name : undefined} onClick={() => props.onOpenWorkspace(project)}>{project.name}</Row>}</For>
    <For each={unmounted(node)}>{(root) =>
      <Row density="nav" element="button" lead={<Icons.Folder />} meta="Add as workspace" title={`${root.label}: shared, not a workspace yet. Add it as one.`}
        onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: node.id, rootId: root.id })}>{folderName(root.label)}</Row>}</For>
  </>;

  /**
   * This device, as one view: its clients and what this app lets the hub do (its own switches, set only here) beside
   * the workspaces its clients mount and what can be done here, then bringing another environment of it in.
   */
  const here = (device: ShownDevice) => {
    const nodes = () => device.clients.flatMap((shown) => shown.node ? [shown.node] : []);
    const paired = () => companion?.pairing() ?? null;
    const grants = () => paired()?.newFolders ?? { write: true, shell: false };
    return <>
      <Columns>
        <Group kind="column" title="Clients">
          <For each={together(device.clients)}>{(shown) => <SettingLine label={shown.part.name} state={shown.part.meta}>
            <StatusDot label={status(shown)} tone={shown.part.online ? "success" : "muted"} />
          </SettingLine>}</For>
          <Show when={companion && paired()}>
            {/* Paired is connected: the workspaces mounted from here work whenever this app runs (in the tray too).
                Sharing is the other thing: letting the hub go through this computer's folders and mount any of them. */}
            <SettingLine label={`Share folders with ${server()}`} title={`${server()} can go through this computer's folders and mount any of them as a workspace (New workspace), with the grants below. Workspaces already mounted from here work either way, while this app runs. Set here only.`}>
              <Switch id="device-browse" label={`Share this computer's folders with ${server()}`} disabled={companion!.busy()} checked={Boolean(paired()?.browse)} onChange={(on) => void companion!.browse(on)} />
            </SettingLine>
            <SettingLine label="New folders can be edited" title="Folders mounted from here, or by browsing this computer.">
              <Switch id="device-share-write" label="New folders can be edited" disabled={companion!.busy()} checked={grants().write} onChange={(on) => void companion!.grant({ ...grants(), write: on })} />
            </SettingLine>
            <SettingLine label="New folders run commands" title="Commands start in the folder but run as you, with everything you can reach.">
              <Switch id="device-share-shell" label="New folders run commands" disabled={companion!.busy()} checked={grants().shell} onChange={(on) => void companion!.grant({ ...grants(), shell: on })} />
            </SettingLine>
          </Show>
          <Show when={notifications.way}>
            <SettingLine label="Notifications" title={notifications.way === "android"
              ? "The agent's reports and approvals reach this phone, even with the app closed."
              : "The agent's reports and approvals reach this browser, even with the page closed."}>
              <Switch id="device-notifications" label="Notifications" disabled={notifications.busy()} checked={notifications.on()}
                onChange={(on) => void (on ? notifications.enable(device.name) : notifications.disable())} />
            </SettingLine>
          </Show>
        </Group>
        <Group kind="column" title="Workspaces">
          <Show when={nodes().some((node) => mounted(node).length || unmounted(node).length)} fallback={<Note>None mounted</Note>}>
            <For each={nodes()}>{(node) => places(node, nodes().length > 1)}</For>
          </Show>
        </Group>
      </Columns>
      {/* What can be done here, under both: a terminal on each client that has one, mounting a folder of this app's. */}
      <Actions kind="setting">
        <Show when={notifications.on()}>
          <Button variant="ghost" size="sm" disabled={notifications.busy()} onClick={() => void notifications.test()}><Icons.Notification /> Send a test</Button>
        </Show>
        <For each={notifications.problem()?.distributors ?? []}>{(distributor) =>
          <Button variant="ghost" size="sm" disabled={notifications.busy()} onClick={() => void notifications.choose(distributor.id, device.name)}>Use {distributor.label}</Button>}</For>
        <For each={nodes().filter((node) => node.online && (node.local || node.terminal))}>{(node) =>
          <Button variant="ghost" size="sm" onClick={() => props.onOpenTerminal(node)}><Icons.Terminal /> {nodes().length > 1 ? `Terminal on ${node.name}` : "Terminal"}</Button>}</For>
        <Show when={companion}>
          <Show when={paired()} fallback={<Button variant="ghost" size="sm" disabled={companion!.busy()} onClick={() => void companion!.pair()}><Icons.Add /> Add this computer</Button>}>{(pairing) => <>
            <Button variant="ghost" size="sm" disabled={companion!.busy()} onClick={() => void companion!.share(pairing().mainUrl)}><Icons.NewFolder /> Mount a folder…</Button>
            <Button variant="ghost" size="sm" disabled={companion!.busy()} onClick={() => void companion!.unpair(pairing().mainUrl, pairing().nodeId)}>Unpair</Button>
          </>}</Show>
        </Show>
      </Actions>
      {/* The app can bring another environment of this machine in (a WSL distro); not where the hub already runs. */}
      <Show when={companion && device.paired && !device.clients.some((shown) => shown.node?.local)}><PairEnvironment device={device} onPaired={refresh} /></Show>
    </>;
  };

  return <>
    <Show when={props.part === "network" && devices()}><NetworkMap hub={{ name: server(), device: hubDevice()?.name, meta: hubNode() ? `on ${hubNode()!.name}` : undefined }}
      devices={network().map((device) => ({ id: device.id, name: device.name, clients: together(device.clients).map((shown) => shown.part) }))} /></Show>

    <Show when={props.part === "device" && active() && thisDevice()}>{(device) => <Group>
      {/* Its name, large: what the network calls this device, renamed here only. */}
      <SettingTitle label="This device's name" value={device().name} editable={device().paired} onChange={(name) => rename(device(), name)} />
      {here(device())}
      <Show when={companion?.error()}><Note tone="error">{companion!.error()}</Note></Show>
      <Show when={notifications.problem()}>{(problem) => <Note tone={problem().distributors ? "quiet" : "error"}>{problem().text}</Note>}</Show>
    </Group>}</Show>

    {/* The network's own settings, the server in use's: another is switched to first. */}
    <Show when={props.part === "network" && active()}><NetworkSettings /></Show>

    {/* Each environment's own browser, paired for agents to work in. */}
    <Show when={active()}><PersonBrowsersSettings device={props.part === "device" ? thisDevice()?.name ?? "" : undefined} /></Show>

    <Show when={props.part === "network" && others().length}>
      <Group title="Devices">
        <For each={others()}>{(device) => <NavFolder open={open().has(device.id)} row={
          <NavFolderRow open={open().has(device.id)} icon={device.clients.every((shown) => shown.part.headed === "browser") ? <Icons.Browser /> : <Icons.Monitor />}
            meta={device.clients.map((shown) => shown.part.name).join(", ")}
            link={{ onClick: () => toggle(device.id) }}
            toggle={{ "aria-label": `${open().has(device.id) ? "Close" : "Open"} ${device.name}`, onClick: (event: MouseEvent) => { event.stopPropagation(); toggle(device.id); } }}>
            {device.name}
          </NavFolderRow>}>
          <ClientCards label={device.name}><For each={device.clients}>{(shown) => card(shown)}</For></ClientCards>
          <DeviceDetails nodes={device.clients.flatMap((shown) => shown.node ? [shown.node] : [])} open={open().has(device.id)} />
        </NavFolder>}</For>
      </Group>
    </Show>
    <Show when={net.error()}><Note tone="error">{net.error()}</Note></Show>
  </>;
}

/**
 * Another environment of this device, one with no app of its own (a WSL distro, a container): the server gives a key
 * once, inside the command to run there.
 */
function PairEnvironment(props: { device: ShownDevice; onPaired: () => void }) {
  const [name, setName] = createSignal("");
  const [command, setCommand] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal("");
  const pair = async () => {
    setError("");
    try {
      const paired = await api<{ command: string }>("/v0/nodes", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name().trim() || undefined, deviceId: props.device.id }) });
      setCommand(paired.command);
      setCopied(false);
      setName("");
      props.onPaired();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The environment was not paired."); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(command()); setCopied(true); } catch { setCopied(false); } };
  return <>
    <SettingLine label="Pair an environment" title="A WSL distro or a container here, with no app of its own: it pairs with the command shown, run there.">
      <Input aria-label="Environment name" placeholder="Ubuntu" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      <Button variant="ghost" size="sm" onClick={() => void pair()}><Icons.Add /> Pair</Button>
    </SettingLine>
    <Show when={command()}>
      <SettingLine label={<SettingValue mono>{command()}</SettingValue>}><Button variant="ghost" size="sm" onClick={() => void copy()}><Icons.Copy /> Copy command</Button></SettingLine>
      <Note>Run it there, then mount a folder with “conduit-node share” and start it with “conduit-node run”. The key is shown once.</Note>
      <Show when={copied()}><LiveNote>Copied</LiveNote></Show>
    </Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </>;
}


/**
 * This app's own client, in the desktop app only: the background node the shell runs (node_companion.rs), paired with
 * this server in one step -- the server hands out a key, the shell's node takes it -- and the folders it mounts,
 * picked with the system's folder picker. What a folder allows is chosen when it is mounted.
 */
function createCompanion(devices: () => Device[] | null, refresh: () => void) {
  const shell = desktopShell!;
  const [settings, setSettings] = createSignal<DesktopShellSettings | null>(null);
  const [status, setStatus] = createSignal<CompanionStatus | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const read = () => void shell.companion.status().then(setStatus).catch(() => setError("The desktop shell did not answer."));
  onMount(() => { void shell.settings().then(setSettings); });

  // This server's pairing, found by the node id it gave: the URL a pairing dials may not be the one this app uses.
  const pairing = () => pairingWith(status(), (devices() || []).flatMap((device) => device.nodes.map((node) => node.id)));
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); refresh(); }
  };
  const pair = () => act(async () => { await pairThisComputer(status()); setSettings(await shell.settings()); });
  const grants = () => pairing()?.newFolders ?? { write: true, shell: false };
  const share = (mainUrl: string) => act(() => shell.companion.share(mainUrl, grants().write, grants().shell));
  const grant = (next: { write: boolean; shell: boolean }) => act(async () => { const at = pairing()?.mainUrl; if (at) await shell.companion.newFolders(at, next.write, next.shell); });
  const browse = (on: boolean) => act(async () => { const at = pairing()?.mainUrl; if (at) await shell.companion.browse(at, on); });
  const unpair = (mainUrl: string, nodeId: string | null) => act(async () => {
    await shell.companion.unpair(mainUrl);
    if (nodeId) await api(`/v0/nodes/${nodeId}`, { method: "DELETE" });
    // Paired with nothing now, the companion stops; still paired elsewhere, it keeps running.
    await keepThisComputerConnected();
    setSettings(await shell.settings());
  });
  return { read, settings, pairing, busy, error, pair, share, grant, browse, unpair };
}

/**
 * What a device's environments declare (roadmap #14): the harnesses each runs for this network (found there when it
 * shares a folder with the shell grant) -- ready while it is connected, offline while it is away -- and, while the
 * device's folder is open, each connected environment's machine readout, asked of its node.
 */
function DeviceDetails(props: { nodes: Node[]; open: boolean }) {
  return <For each={props.nodes}>{(node) => <>
    <DeviceHarnesses node={node} named={props.nodes.length > 1} />
    <Show when={node.online}><MachineReadout open={props.open} url={`/v0/nodes/${encodeURIComponent(node.id)}/machine`} title={`Machine · ${node.name}`} /></Show>
  </>}</For>;
}

