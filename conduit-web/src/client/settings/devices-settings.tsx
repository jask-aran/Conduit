import { createMemo, createSignal, For, Index, onMount, Show } from "solid-js";
import { api } from "../api/client.ts";
import { activeOrigin } from "../platform/servers.ts";
import type { Project } from "../api/contracts";
import { Button, Input, Switch } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavFolder, NavFolderRow, StatusDot } from "@/components/ui/nav";
import { ClientCard, ClientCards, ClientPlaces, NetworkMap } from "@/components/ui/network";
import { LiveNote, SettingLine, SettingTitle, SettingValue } from "@/components/ui/overlay";
import { createFlash } from "@/components/ui/motion";
import { WorkspaceGlyph } from "../project/workspace-appearance.tsx";
import { desktopShell, type CompanionStatus, type DesktopShellSettings } from "../platform/installed-client.ts";
import { pairingWith, pairThisComputer, keepThisComputerConnected } from "../platform/this-computer.ts";
import { NetworkSettings } from "./network-settings.tsx";
import { PersonBrowsersSettings } from "./person-browsers-settings.tsx";
import { createShellSettings } from "./desktop-settings";
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
  // How the desktop app runs (tray, sign-in), read from its shell; nothing anywhere else.
  const shell = desktopShell ? createShellSettings() : null;
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
      <Row density="nav" element="button" lead={<Icons.Folder />} meta="Add as workspace"
        onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: node.id, rootId: root.id })}>{folderName(root.label)}</Row>}</For>
  </>;

  /**
   * This device: what the app or tab it is seen from does here (its own switches, set only here) beside what the app
   * lets the hub do with this computer's folders; then its environments, each with a terminal and the workspaces it
   * mounts. Mounting a folder is done in the app, not here.
   * Each takes the device as it is now, not once: the network is read again every few seconds, and a page drawn from
   * one reading would be drawn again with each (its switches blinked).
   */
  const here = (device: () => ShownDevice) => {
    const paired = () => companion?.pairing() ?? null;
    const grants = () => paired()?.newFolders ?? { write: true, shell: false };
    return <>
      <Columns>
        <Show when={notifications.way || desktopShell}>
          <Group kind="column" title={desktopShell || notifications.way === "android" ? "This app" : "This browser"}>
            <Show when={notifications.way}>
              <SettingLine label="Notifications" title={notifications.way === "android"
                ? "The agent's reports and approvals reach this phone, even with the app closed."
                : "The agent's reports and approvals reach this browser, even with the page closed."}>
                <Show when={notifications.on()}>
                  <Button variant="ghost" size="sm" disabled={notifications.busy()} onClick={() => void notifications.test()}>Send a test</Button>
                </Show>
                <Switch id="device-notifications" label="Notifications" disabled={notifications.busy()} checked={notifications.on()}
                  onChange={(on) => void (on ? notifications.enable(device().name) : notifications.disable())} />
              </SettingLine>
            </Show>
            <Show when={shell?.settings()}>{(current) => <>
              <SettingLine label="Keep running in tray">
                <Switch id="desktop-tray" label="Keep running in tray" checked={current().keepRunningInTray} onChange={(on) => shell!.update({ keepRunningInTray: on })} />
              </SettingLine>
              <SettingLine label="Launch at sign-in">
                <Switch id="desktop-autostart" label="Launch at sign-in" checked={current().launchAtLogin}
                  onChange={(on) => shell!.update({ launchAtLogin: on, startHidden: on ? current().startHidden : false })} />
              </SettingLine>
              {/* Starting hidden is only a question for a launch nobody asked for. */}
              <SettingLine label="Start hidden">
                <Switch id="desktop-start-hidden" label="Start hidden" disabled={!current().launchAtLogin} checked={current().startHidden} onChange={(on) => shell!.update({ startHidden: on })} />
              </SettingLine>
            </>}</Show>
            <Show when={shell?.error()}><Note tone="error">{shell!.error()}</Note></Show>
          </Group>
        </Show>
        <Show when={companion && paired()}>
          {/* Paired is connected: the workspaces mounted from here work whenever this app runs (in the tray too).
              Sharing is the other thing: letting the hub go through this computer's folders and mount any of them. */}
          <Group kind="column" title="Folders the hub may use">
            <SettingLine label="Share this computer's folders" title={`${server()} can mount any of this computer's folders as a workspace, with the grants below. Workspaces already mounted from here keep working either way.`}>
              <Switch id="device-browse" label={`Share this computer's folders with ${server()}`} disabled={companion!.busy()} checked={Boolean(paired()?.browse)} onChange={(on) => void companion!.browse(on)} />
            </SettingLine>
            <SettingLine label="New folders can be edited" title="Folders mounted from here, or by browsing this computer.">
              <Switch id="device-share-write" label="New folders can be edited" disabled={companion!.busy()} checked={grants().write} onChange={(on) => void companion!.grant({ ...grants(), write: on })} />
            </SettingLine>
            <SettingLine label="New folders run commands" title="Commands start in the folder but run as you, with everything you can reach.">
              <Switch id="device-share-shell" label="New folders run commands" disabled={companion!.busy()} checked={grants().shell} onChange={(on) => void companion!.grant({ ...grants(), shell: on })} />
            </SettingLine>
          </Group>
        </Show>
      </Columns>
      {/* A phone with several ways to be notified, and none chosen. */}
      <Show when={notifications.problem()?.distributors?.length}>
        <Actions kind="setting">
          <For each={notifications.problem()!.distributors}>{(distributor) =>
            <Button variant="ghost" size="sm" disabled={notifications.busy()} onClick={() => void notifications.choose(distributor.id, device().name)}>Use {distributor.label}</Button>}</For>
        </Actions>
      </Show>
    </>;
  };
  /** What an environment's line says: that this app is on it, and what it mounts while it is connected, else since when it is away. */
  const says = (shown: Shown) => {
    if (!shown.node?.online) return [shown.mine ? "this app" : "", status(shown)].filter(Boolean).join(" · ");
    const meta = shown.part.meta ?? "";
    const app = shown.app?.split(" · ")[0];
    return (app && meta.startsWith(`${app} · `) ? meta.slice(app.length + 3) : meta) || "No workspaces";
  };
  /** This device's environments side by side, the one this app is on first: each one's line (a terminal there), then the workspaces it mounts; under them what else is open on the device, and bringing another environment in. */
  const environments = (device: () => ShownDevice) => {
    const own = () => device().clients.filter((shown) => shown.node).sort((a, b) => Number(b.mine) - Number(a.mine));
    // By id: a reading makes each client anew, and a column drawn from the client itself would be drawn again with it.
    const ids = createMemo(() => own().map((shown) => shown.node!.id), [], { equals: (a, b) => a.join() === b.join() });
    const rest = () => together(device().clients.filter((shown) => !shown.node && !shown.mine));
    return <Group title="Environments">
      <Show when={own().length} fallback={<Note>None on this device</Note>}>
        <Columns>
          <For each={ids()}>{(id) => {
            const shown = () => own().find((item) => item.node!.id === id)!;
            const node = () => shown().node!;
            return <Group kind="column">
              <SettingLine label={node().name} state={says(shown())}>
                <StatusDot label={status(shown())} tone={shown().part.online ? "success" : "muted"} />
                <Show when={node().online && (node().local || node().terminal)}>
                  <Button variant="ghost" outline size="sm" aria-label={`Terminal on ${node().name}`} onClick={() => props.onOpenTerminal(node())}><Icons.Terminal /> Terminal</Button>
                </Show>
              </SettingLine>
              <For each={mounted(node())}>{(project) =>
                <Row density="nav" element="button" lead={<WorkspaceGlyph appearance={project.workspaceAppearance} />} onClick={() => props.onOpenWorkspace(project)}>{project.name}</Row>}</For>
            </Group>;
          }}</For>
        </Columns>
      </Show>
      <Index each={rest()}>{(shown) => <SettingLine label={shown().part.name} state={shown().part.meta}>
        <StatusDot label={status(shown())} tone={shown().part.online ? "success" : "muted"} />
      </SettingLine>}</Index>
      {/* The app can bring another environment of this machine in (a WSL distro); not where the hub already runs. */}
      <Show when={companion && device().paired && !device().clients.some((shown) => shown.node?.local)}><PairEnvironment device={device()} onPaired={refresh} /></Show>
    </Group>;
  };
  /** What the device is seen from, beside its name: the app and the environment it runs on ("Conduit Dev on Windows"), or the browser. */
  const seenFrom = (device: ShownDevice) => {
    const mine = device.clients.find((shown) => shown.mine);
    return mine?.node && mine.app ? `${mine.app.split(" · ")[0]} on ${mine.node.name}` : mine?.app;
  };
  /** This app's own pairing with the server, last: taking it off the network, or bringing it on. */
  const pairing = () => <Show when={companion}>
    <Group title="Pairing">
      <Show when={companion!.pairing()} fallback={
        <SettingLine label={`Not paired with ${server()}`}>
          <Button variant="ghost" outline size="sm" disabled={companion!.busy()} onClick={() => void companion!.pair()}><Icons.Add /> Add this computer</Button>
        </SettingLine>}>{(paired) =>
        <SettingLine label={`Paired with ${server()}`} state="unpairing takes its workspaces off the network">
          <Button variant="destructive" outline size="sm" disabled={companion!.busy()} onClick={() => void companion!.unpair(paired().mainUrl, paired().nodeId)}>Unpair this computer</Button>
        </SettingLine>}</Show>
      <Show when={companion!.error()}><Note tone="error">{companion!.error()}</Note></Show>
    </Group>
  </Show>;

  return <>
    <Show when={props.part === "network" && devices()}><NetworkMap hub={{ name: server(), device: hubDevice()?.name, meta: hubNode() ? `on ${hubNode()!.name}` : undefined }}
      devices={network().map((device) => ({ id: device.id, name: device.name, clients: together(device.clients).map((shown) => shown.part) }))} /></Show>

    <Show when={props.part === "device" && active() && thisDevice()}>{(device) => <>
      <Group>
        {/* Its name, large: what the network calls this device, renamed here only; beside it, what it is seen from. */}
        <SettingTitle label="This device's name" value={device().name} detail={seenFrom(device())}
          editable={device().paired} onChange={(name) => rename(device(), name)} />
        {here(device)}
        <Show when={notifications.problem()}>{(problem) => <Note tone={problem().distributors ? "quiet" : "error"}>{problem().text}</Note>}</Show>
      </Group>
      {environments(device)}
    </>}</Show>

    {/* The network's own settings, the server in use's: another is switched to first. */}
    <Show when={props.part === "network" && active()}><NetworkSettings /></Show>

    {/* Each environment's own browser, paired for agents to work in. On This device only in the desktop app: a tab
        has no device of its own to pair for (the hub places it by its address), and a phone has no environment. */}
    <Show when={active() && (props.part === "network" || desktopShell)}><PersonBrowsersSettings device={props.part === "device" ? thisDevice()?.name ?? "" : undefined} /></Show>
    <Show when={props.part === "device" && active()}>{pairing()}</Show>

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
  const { on: copied, flash: flashCopied } = createFlash();
  const [error, setError] = createSignal("");
  const pair = async () => {
    setError("");
    try {
      const paired = await api<{ command: string }>("/v0/nodes", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name().trim() || undefined, deviceId: props.device.id }) });
      setCommand(paired.command);
      setName("");
      props.onPaired();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The environment was not paired."); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(command()); flashCopied(); } catch { /* the command stays shown, to copy by hand */ } };
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
  const grant = (next: { write: boolean; shell: boolean }) => act(async () => { const at = pairing()?.mainUrl; if (at) await shell.companion.newFolders(at, next.write, next.shell); });
  const browse = (on: boolean) => act(async () => { const at = pairing()?.mainUrl; if (at) await shell.companion.browse(at, on); });
  const unpair = (mainUrl: string, nodeId: string | null) => act(async () => {
    await shell.companion.unpair(mainUrl);
    if (nodeId) await api(`/v0/nodes/${nodeId}`, { method: "DELETE" });
    // Paired with nothing now, the companion stops; still paired elsewhere, it keeps running.
    await keepThisComputerConnected();
    setSettings(await shell.settings());
  });
  return { read, settings, pairing, busy, error, pair, grant, browse, unpair };
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

