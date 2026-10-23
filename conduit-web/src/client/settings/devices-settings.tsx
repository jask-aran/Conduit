import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api } from "../api/client.ts";
import { httpUrl } from "../api/transport.js";
import type { Project } from "../api/contracts";
import { Button, Input, Switch } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavFolder, NavFolderRow, NavLine, NavRow, StatusDot } from "@/components/ui/nav";
import { clientMark, NetworkMap, type NetworkClient } from "@/components/ui/network";
import { connectionId } from "../state/runtime.ts";
import { LiveNote, SettingGroup, SettingNote, SettingValue } from "@/components/ui/overlay";
import { WorkspaceGlyph } from "../project/workspace-appearance.tsx";
import { desktopShell, type CompanionStatus, type DesktopShellSettings } from "../platform/installed-client.ts";

type SharedRoot = { id: string; label: string; read: boolean; write: boolean; shell: boolean; allow?: string[] };
type Node = { id: string; deviceId: string; name: string; platform: string | null; online: boolean; local?: boolean; roots: SharedRoot[]; harnesses?: string[]; terminal?: boolean; lastSeenAt: string | null; via?: string | null };
/** A client connected to this server now (runtime-hub.js): its kind, build, and what its user agent says it runs on. */
type Client = { id: string; kind: string; build: string; registration?: string; platform?: string; agent?: string; nodes?: string[] };
/** `head`: on the device the head runs on, the server's name. */
type Device = { id: string; name: string; local?: boolean; head?: string; nodes: Node[] };
/** One client as this page shows it: on the map, and in its device's rows. */
type Shown = { part: NetworkClient; node?: Node; mine: boolean };
type ShownDevice = { id: string; name: string; paired: boolean; clients: Shown[] };
type AddWorkspace = (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;

/**
 * The network this server heads: a map of it, then its devices, one row each, opening to a tree of their clients and,
 * under each, the workspaces on it and the folders it makes available -- then the device's own settings.
 *
 * A device (a PC, a phone) holds clients: environments (its Windows, a WSL distro) whose node (`conduit-node`) makes
 * folders available, and apps or browsers driving Conduit; Windows with the app open on it is one client. A folder
 * made available becomes a workspace from here; chats in it run there. The head's own workspaces are the server's,
 * listed with the server's places, not here. A browser is a client with no machine of its own.
 */
export function DevicesSettingsTile(props: { projects: Project[]; onAddWorkspace: AddWorkspace;
  /** A terminal on the device itself, in its home: this server's "computer" one, or a device's where a folder is shared with commands. */
  onOpenTerminal: (node: { id: string; local?: boolean }) => void;
  onOpenWorkspace: (project: Project) => void }) {
  const [devices, setDevices] = createSignal<Device[] | null>(null);
  const [error, setError] = createSignal("");
  const [clients, setClients] = createSignal<Client[]>([]);
  // This app's own environment, when its companion is paired with this server.
  const [companion, setCompanion] = createSignal<CompanionStatus | null>(null);
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const refresh = () => {
    void api<{ devices: Device[] }>("/v0/nodes")
      .then((answer) => { setDevices(answer.devices); setError(""); })
      .catch((cause: Error) => setError(cause.message || "The server did not list its devices."));
    void api<{ clients?: Client[] }>("/v0/runtime/clients").then((answer) => setClients(answer.clients || [])).catch(() => {});
    void desktopShell?.companion.status().then(setCompanion).catch(() => {});
  };
  refresh();
  // Whether each client is connected changes under the page.
  const timer = setInterval(refresh, 5_000);
  onCleanup(() => clearInterval(timer));

  const fail = (fallback: string) => (cause: unknown) => setError(cause instanceof Error ? cause.message : fallback);
  const forget = (node: Node) => api(`/v0/nodes/${node.id}`, { method: "DELETE" }).then(refresh, fail("The client was not unpaired."));
  const rename = (device: ShownDevice, name: string) => {
    if (!name.trim() || name.trim() === device.name) return;
    void api(`/v0/devices/${device.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
      .then(refresh, fail("The device was not renamed."));
  };
  const toggle = (id: string) => setOpen((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next; });

  const ownNode = () => (companion()?.node?.pairings || []).map((pairing) => pairing.nodeId).find((id) => id && (devices() || []).some((device) => device.nodes.some((node) => node.id === id))) || null;
  const network = createMemo(() => networkOf(devices() || [], clients(), connectionId(), ownNode(), props.projects));
  const head = () => {
    const device = (devices() || []).find((item) => item.head);
    const node = device?.nodes.find((item) => item.local);
    return { name: device?.head || "This server", device: device?.name, meta: node ? `on ${node.name}` : undefined };
  };
  const placed = (node: Node) => ({ workspaces: props.projects.filter((project) => project.nodeId === node.id),
    // A folder already a workspace is listed as the workspace.
    folders: node.roots.filter((root) => !props.projects.some((project) => project.nodeId === node.id && project.place?.root === root.id)) });

  return <>
    <Show when={devices()}><NetworkMap head={head()} devices={network().map((device) => ({ id: device.id, name: device.name, clients: device.clients.map((shown) => shown.part) }))} /></Show>
    <SettingGroup title="Devices">
      <For each={network()}>{(device) => <NavFolder open={open().has(device.id)} row={
        <NavFolderRow open={open().has(device.id)} icon={device.clients.every((shown) => shown.part.headed === "browser") ? <Icons.Browser /> : <Icons.Monitor />}
          meta={device.clients.map((shown) => shown.part.name).join(", ")}
          link={{ onClick: () => toggle(device.id) }}
          toggle={{ "aria-label": `${open().has(device.id) ? "Close" : "Open"} ${device.name}`, onClick: (event: MouseEvent) => { event.stopPropagation(); toggle(device.id); } }}>
          {device.name}
        </NavFolderRow>}>
        <For each={device.clients}>{(shown) => <Show when={shown.mine && desktopShell && (!shown.node || shown.node.id === ownNode())} fallback={<>
          <ClientLine shown={shown} end={<>
            <Show when={shown.node?.online && (shown.node.local || shown.node.terminal)}>
              <Button variant="ghost" size="sm" aria-label={`Open a terminal on ${shown.part.name}`} onClick={() => props.onOpenTerminal(shown.node!)}><Icons.Terminal /> Open terminal here</Button>
            </Show>
            <Show when={shown.node && !shown.node.local}>
              <Button variant="ghost" size="sm" aria-label={`Unpair ${shown.part.name} on ${device.name}`} onClick={() => void forget(shown.node!)}><Icons.Delete /> Unpair</Button>
            </Show>
          </>} />
          <Show when={shown.node && !shown.node.local}>
            <Placed placed={placed(shown.node!)} name={shown.part.name} onOpen={props.onOpenWorkspace}
              folderEnd={(root) => <Button variant="ghost" size="sm" aria-label={`Add ${root.label} on ${shown.part.name} as a workspace`}
                onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: shown.node!.id, rootId: root.id })}><Icons.NewFolder /> Add workspace</Button>} />
          </Show>
        </>}>
          <ThisComputer shown={shown} server={head().name} devices={devices} placed={shown.node ? placed(shown.node) : null}
            refresh={refresh} onAddWorkspace={props.onAddWorkspace} onOpen={props.onOpenWorkspace} />
        </Show>}</For>
        <Show when={device.paired}>
          <NavLine indent icon={<Icons.Edit />} end={<Input aria-label={`${device.name}'s name`} value={device.name} onChange={(event) => rename(device, event.currentTarget.value)} />}>Name</NavLine>
          <PairEnvironment device={device} onPaired={refresh} />
        </Show>
      </NavFolder>}</For>
    </SettingGroup>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </>;
}

/** A client's own line in its device's tree: its mark, name, status and what it says, a dot, then its actions. */
function ClientLine(props: { shown: Shown; end?: JSX.Element }) {
  const node = () => props.shown.node;
  // An app connected where its node is off is connected; its meta says it is not sharing.
  const status = () => !node() || node()!.online || props.shown.part.headed ? "Connected" : node()!.lastSeenAt
    ? `Offline since ${new Date(node()!.lastSeenAt!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not connected yet";
  return <NavLine indent icon={clientMark(props.shown.part)} meta={[status(), props.shown.part.meta].filter(Boolean).join(" · ")}
    end={<><StatusDot label={status()} tone={props.shown.part.online ? "success" : "muted"} />{props.end}</>}>{props.shown.part.name}</NavLine>;
}

/** Under a client: its workspaces, each opening, then the folders it makes available that are not workspaces yet. */
function Placed(props: { placed: { workspaces: Project[]; folders: SharedRoot[] }; name: string; onOpen: (project: Project) => void;
  folderEnd: (root: SharedRoot) => JSX.Element; folderMeta?: (root: SharedRoot) => string }) {
  // Secrets are kept back by default (src/nodes/secrets.js); only a root's exceptions are worth saying.
  const grants = (root: SharedRoot) => ["Read", root.write && "write", root.shell && "commands"].filter(Boolean).join(", ")
    + (root.allow?.length ? ` · shares ${root.allow.join(", ")}` : "");
  return <>
    <For each={props.placed.workspaces}>{(project) =>
      <NavRow indent={2} icon={<WorkspaceGlyph appearance={project.workspaceAppearance} />} meta={project.place?.path || undefined} onClick={() => props.onOpen(project)}>{project.name}</NavRow>}</For>
    <For each={props.placed.folders}>{(root) =>
      <NavLine indent={2} icon={<Icons.Folder />} meta={props.folderMeta?.(root) ?? grants(root)} end={props.folderEnd(root)}>{root.label}</NavLine>}</For>
    <Show when={!props.placed.workspaces.length && !props.placed.folders.length}>
      <NavLine indent={2} quiet>{props.name} makes no folders available yet.</NavLine>
    </Show>
  </>;
}

/**
 * Another environment on a device, one with no app to pair it (a WSL distro, a container): the server gives a key
 * once, inside the command to run there. A device with the app is paired from the app's own connection screen.
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
    <NavLine indent icon={<Icons.Add />} title="One with no app to pair it: a WSL distro, a container. Name it, then run the command there." end={<>
      <Input aria-label="Environment name" placeholder="Ubuntu" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      <Button variant="ghost" size="sm" onClick={() => void pair()}>Pair</Button>
    </>}>Pair an environment</NavLine>
    <Show when={command()}>
      <SettingNote>Run this there, then make a folder available with “conduit-node share” and start it with “conduit-node run”. The key is shown once.</SettingNote>
      <NavLine indent={2} end={<Button variant="ghost" size="sm" onClick={() => void copy()}>Copy</Button>}><SettingValue mono>{command()}</SettingValue></NavLine>
      <Show when={copied()}><LiveNote>Copied</LiveNote></Show>
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </>;
}

function dialableServer(): string | undefined {
  const url = new URL(httpUrl("/"), location.href);
  const host = url.hostname;
  const tailnet = /\.ts\.net$/i.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  // This machine's server answers plain HTTP on the same port, and a node cannot check the self-signed certificate
  // its HTTPS presents (the app trusts it through the server's identity; the node has none).
  if (["127.0.0.1", "localhost", "[::1]"].includes(host)) return `http://${url.host}`;
  return tailnet ? url.origin : undefined;
}

const thisPlatform = () => /Windows/i.test(navigator.userAgent) ? "Windows" : /Mac/i.test(navigator.userAgent) ? "macOS" : "Linux";

/**
 * This app's own client, in the desktop app only: the background node the shell runs (node_companion.rs), paired with
 * this server in one step -- the server hands out a key, the shell's node takes it -- and the folders it makes
 * available, picked with the system's folder picker. What a folder allows is chosen when it is made available.
 */
function ThisComputer(props: { shown: Shown; server: string; devices: () => Device[] | null; placed: { workspaces: Project[]; folders: SharedRoot[] } | null;
  refresh: () => void; onAddWorkspace: AddWorkspace; onOpen: (project: Project) => void }) {
  const shell = desktopShell!;
  const [settings, setSettings] = createSignal<DesktopShellSettings | null>(null);
  const [status, setStatus] = createSignal<CompanionStatus | null>(null);
  const [error, setError] = createSignal("");
  const [write, setWrite] = createSignal(true);
  const [commands, setCommands] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const read = () => void shell.companion.status().then(setStatus).catch(() => setError("The desktop shell did not answer."));
  onMount(() => { void shell.settings().then(setSettings); read(); });
  const timer = setInterval(read, 5_000);
  onCleanup(() => clearInterval(timer));

  // This server's pairing, found by the node id it gave: the URL a pairing dials may not be the one this app uses.
  const serverNodes = () => (props.devices() || []).flatMap((device) => device.nodes);
  const pairing = () => status()?.node?.pairings.find((item) => item.nodeId && serverNodes().some((node) => node.id === item.nodeId)) || null;
  // What the companion makes available, as the server lists it (by path), so a folder becomes a workspace.
  const rootAt = (path: string) => props.shown.node?.roots.find((root) => root.label === path) ?? null;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); read(); props.refresh(); }
  };
  const serve = (on: boolean) => act(async () => {
    const current = settings();
    if (current) setSettings(await shell.saveSettings({ ...current, serveAsDevice: on }));
  });
  const pair = () => act(async () => {
    const deviceName = status()?.node?.name || status()?.node?.host || "This computer";
    const paired = await api<{ node: Node; key: string; mainUrl: string; routes?: string[] }>("/v0/nodes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceName, name: thisPlatform(), mainUrl: dialableServer() }),
    });
    await shell.companion.pair(paired.mainUrl, paired.key, paired.node.id, deviceName, (paired.routes || []).slice(1));
    const current = settings();
    // Pairing is asking to share: the node starts with it.
    if (current && !current.serveAsDevice) setSettings(await shell.saveSettings({ ...current, serveAsDevice: true }));
  });
  const share = (mainUrl: string) => act(() => shell.companion.share(mainUrl, write(), commands()));
  const unshare = (mainUrl: string, path: string) => act(() => shell.companion.unshare(mainUrl, path));
  const unpair = (mainUrl: string, nodeId: string | null) => act(async () => {
    await shell.companion.unpair(mainUrl);
    if (nodeId) await api(`/v0/nodes/${nodeId}`, { method: "DELETE" });
  });
  // The companion's folders that are not workspaces yet, each with its own grants.
  const folders = () => (pairing()?.roots || []).filter((root) => { const listed = rootAt(root.path); return !listed || props.placed?.folders.includes(listed); });

  return <Show when={status()?.available !== false} fallback={<ClientLine shown={props.shown} />}>
    <ClientLine shown={props.shown} end={<Show when={pairing()} fallback={
      <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void pair()}>Add this computer</Button>}>{(paired) => <>
        <Switch id="device-serve" label={`Share with ${props.server}`} disabled={busy() || !settings()} checked={Boolean(settings()?.serveAsDevice)} onChange={(on) => void serve(on)} />
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void unpair(paired().mainUrl, paired().nodeId)}><Icons.Delete /> Unpair</Button>
      </>}</Show>} />
    <Show when={pairing()}>{(paired) => <>
      <For each={props.placed?.workspaces || []}>{(project) =>
        <NavRow indent={2} icon={<WorkspaceGlyph appearance={project.workspaceAppearance} />} onClick={() => props.onOpen(project)}>{project.name}</NavRow>}</For>
      <For each={folders()}>{(root) =>
        <NavLine indent={2} icon={<Icons.Folder />} meta={["Read", root.write && "edit", root.shell && "commands"].filter(Boolean).join(", ")} end={<>
          <Show when={rootAt(root.path)}>{(listed) => <Button variant="ghost" size="sm" aria-label={`Add ${root.path} as a workspace`}
            onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: props.shown.node!.id, rootId: listed().id })}><Icons.NewFolder /> Add workspace</Button>}</Show>
          <Button variant="ghost" size="sm" disabled={busy()} aria-label={`Stop making ${root.path} available`} onClick={() => void unshare(paired().mainUrl, root.path)}><Icons.Delete /> Remove</Button>
        </>}>{root.path}</NavLine>}</For>
      <NavRow indent={2} icon={<Icons.NewFolder />} disabled={busy()} onClick={() => void share(paired().mainUrl)}>Make a folder available…</NavRow>
      <NavLine indent={2} end={<Switch id="device-share-write" label="Let Conduit edit files" checked={write()} onChange={setWrite} />}>Let Conduit edit files</NavLine>
      <NavLine indent={2} title="Commands start in the folder but run as you, with everything you can reach." end={<Switch id="device-share-shell" label="Let Conduit run commands" checked={commands()} onChange={setCommands} />}>Let Conduit run commands</NavLine>
    </>}</Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </Show>;
}

/**
 * The devices as the page shows them: every paired device with its environments, and every client connected now. An
 * app whose companion is one of those environments (it says so on connecting) is that environment, headed; a browser
 * goes in Browsers; any other app is a device of its own, since nothing says which machine it is on.
 */
function networkOf(devices: Device[], clients: Client[], self: string | null, own: string | null, projects: Project[]): ShownDevice[] {
  const names = new Map(devices.flatMap((device) => device.nodes.map((node) => [node.id, node.name] as const)));
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const byNode = new Map<string, Shown>();
  const list = devices.map((device): ShownDevice => ({ id: device.id, name: device.name, paired: true, clients: device.nodes.map((node) => {
    // The head's workspaces are the server's, so its own client counts none.
    const workspaces = node.local ? 0 : projects.filter((project) => project.nodeId === node.id).length;
    const shown: Shown = { node, mine: false, part: { id: node.id, name: node.name, online: node.online,
      meta: [workspaces ? count(workspaces, "workspace") : "", node.via ? `relayed by ${names.get(node.via) || "another client"}` : ""].filter(Boolean).join(" · ") || undefined } };
    byNode.set(node.id, shown);
    return shown;
  }) }));
  const browsers: ShownDevice = { id: "browsers", name: "Browsers", paired: false, clients: [] };
  const seen = new Set<string>();
  for (const client of clients) {
    const key = client.kind === "browser" && client.registration ? `registration:${client.registration}` : client.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = client.id === self;
    const form = client.kind === "android" || /^(Android|iOS)$/.test(client.platform || "") ? "phone" : client.kind === "desktop" ? "desktop" : "browser";
    const name = client.kind === "browser" ? client.agent || "Browser" : /-dev/.test(client.build) ? "Conduit Dev" : "Conduit";
    const said = mine ? (form === "browser" ? "this browser" : "this app") : client.platform || "";
    const here = (mine && own ? [own] : []).concat(client.nodes || []).map((node) => byNode.get(node)).find(Boolean);
    if (here) {
      here.mine ||= mine;
      Object.assign(here.part, { headed: form, online: true, meta: [name, mine ? said : "", here.node?.online ? here.part.meta : "not sharing"].filter(Boolean).join(" · ") });
      continue;
    }
    const shown: Shown = { mine, part: { id: client.id, name, headed: form, online: true, meta: said || undefined } };
    if (form === "browser") browsers.clients.push(shown);
    else list.push({ id: `client:${key}`, name: form === "phone" ? "Phone" : client.platform || "Computer", paired: false, clients: [shown] });
  }
  return browsers.clients.length ? [...list, browsers] : list;
}
