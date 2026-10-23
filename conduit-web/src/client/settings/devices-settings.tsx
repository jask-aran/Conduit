import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { FolderPlusIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { api } from "../api/client.ts";
import { httpUrl } from "../api/transport.js";
import { Button, Input, Switch } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavFolder, NavFolderRow, StatusDot } from "@/components/ui/nav";
import { NetworkMap, type NetworkClient } from "@/components/ui/network";
import { connectionId } from "../state/runtime.ts";
import { LiveNote, SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";
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

/**
 * The network this server heads: a map of it, then its devices, one row each, opening to their clients -- what each
 * makes available, its terminal, this app's sharing -- and the device's own settings.
 *
 * A device (a PC, a phone) holds clients: environments (its Windows, a WSL distro) whose node (`conduit-node`) makes
 * folders available, and apps or browsers driving Conduit; Windows with the app open on it is one client. A shared
 * folder becomes a workspace from here; chats in it run there. A browser is a client with no machine of its own.
 */
export function DevicesSettingsTile(props: { onAddWorkspace: (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;
  /** A terminal on the device itself, in its home: this server's "computer" one, or a device's where a folder is shared with commands. */
  onOpenTerminal: (node: { id: string; local?: boolean }) => void }) {
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
  const network = createMemo(() => networkOf(devices() || [], clients(), connectionId(), ownNode()));
  const head = () => {
    const device = (devices() || []).find((item) => item.head);
    const node = device?.nodes.find((item) => item.local);
    return { name: device?.head || "This server", meta: node ? `on ${node.name}` : undefined };
  };
  // Secrets are kept back by default (src/nodes/secrets.js); only a root's exceptions are worth saying.
  const grants = (root: SharedRoot) => ["Read", root.write && "write", root.shell && "commands (full user access)"].filter(Boolean).join(", ")
    + (root.allow?.length ? ` · shares ${root.allow.join(", ")}` : "");
  // An app connected where its node is off is connected, not offline; its meta says it is not sharing.
  const status = (shown: Shown) => !shown.node || shown.node.online || shown.part.headed ? "Connected"
    : shown.node.lastSeenAt ? `Offline since ${new Date(shown.node.lastSeenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not connected yet";

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
        <For each={device.clients}>{(shown) => <>
          <SettingLine label={shown.part.name} state={[status(shown), shown.part.meta].filter(Boolean).join(" · ")} plain>
            <StatusDot label={status(shown)} tone={shown.part.online ? "success" : "muted"} />
            <Show when={shown.node?.online && (shown.node.local || shown.node.terminal)}>
              <Button variant="ghost" size="sm" aria-label={`Open a terminal on ${shown.part.name}`} onClick={() => props.onOpenTerminal(shown.node!)}><TerminalIcon /> Open terminal here</Button>
            </Show>
            <Show when={shown.node && !shown.node.local && shown.node.id !== ownNode()}>
              <Button variant="ghost" size="sm" aria-label={`Unpair ${shown.part.name} on ${device.name}`} onClick={() => void forget(shown.node!)}><Trash2Icon /> Unpair</Button>
            </Show>
          </SettingLine>
          {/* The head's folders are already its workspaces (plan decision 24). */}
          <Show when={shown.node?.local}>
            <For each={shown.node!.roots}>{(root) => <SettingLine label={root.label} plain />}</For>
          </Show>
          <Show when={shown.node && !shown.node.local && shown.node.id !== ownNode()}>
            <For each={shown.node!.roots} fallback={<SettingNote tone="quiet">{shown.part.name} makes no folders available yet.</SettingNote>}>{(root) =>
              <SettingLine label={root.label} state={grants(root)} plain>
                <Button variant="ghost" size="sm" aria-label={`Add ${root.label} on ${shown.part.name} as a workspace`}
                  onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: shown.node!.id, rootId: root.id })}><FolderPlusIcon /> Add workspace</Button>
              </SettingLine>}</For>
          </Show>
          <Show when={shown.mine && (!shown.node || shown.node.id === ownNode())}>
            <ThisComputer server={head().name} devices={devices} node={shown.node ?? null} refresh={refresh} onAddWorkspace={props.onAddWorkspace} />
          </Show>
        </>}</For>
        <Show when={device.paired}>
          <SettingLine label="Name">
            <Input aria-label={`${device.name}'s name`} value={device.name} onChange={(event) => rename(device, event.currentTarget.value)} />
          </SettingLine>
          <PairEnvironment device={device} onPaired={refresh} />
        </Show>
      </NavFolder>}</For>
    </SettingGroup>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
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
    <SettingLine label="Pair an environment" title="One with no app to pair it: a WSL distro, a container. Name it, then run the command there.">
      <Input aria-label="Environment name" placeholder="Ubuntu" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      <Button variant="ghost" size="sm" onClick={() => void pair()}>Pair</Button>
    </SettingLine>
    <Show when={command()}>
      <SettingNote>Run this there, then make a folder available with “conduit-node share” and start it with “conduit-node run”. The key is shown once.</SettingNote>
      <SettingLine label="Command" plain>
        <SettingValue mono>{command()}</SettingValue>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>Copy</Button>
      </SettingLine>
      <Show when={copied()}><LiveNote>Copied</LiveNote></Show>
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </>;
}

/**
 * The URL this app reaches the server by, when a node could dial it too: on
 * the tailnet or this machine. A public URL is left to the server, which
 * names its tailnet address (a node is refused through a public tunnel).
 */
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
 * This app's own environment, in the desktop app only: the background node the shell runs (node_companion.rs),
 * paired with this server in one step -- the server hands out a key, the shell's node takes it -- and the folders
 * shared with it, picked with the system's folder picker. What a folder allows is chosen when it is shared. Its
 * lines sit in the environment's group (or, before it is paired, this client's).
 */
function ThisComputer(props: { server: string; devices: () => Device[] | null; node: Node | null; refresh: () => void;
  onAddWorkspace: (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean> }) {
  if (!desktopShell) return null;
  const shell = desktopShell;
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
  // The server's record of a shared folder, for making it a workspace: the same path the companion shares.
  const served = (path: string) => props.node?.roots.find((root) => root.label === path) ?? null;
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
    // Pairing is asking to be served: the node starts with it.
    if (current && !current.serveAsDevice) setSettings(await shell.saveSettings({ ...current, serveAsDevice: true }));
  });
  const share = (mainUrl: string) => act(() => shell.companion.share(mainUrl, write(), commands()));
  const unshare = (mainUrl: string, path: string) => act(() => shell.companion.unshare(mainUrl, path));
  const unpair = (mainUrl: string, nodeId: string | null) => act(async () => {
    await shell.companion.unpair(mainUrl);
    if (nodeId) await api(`/v0/nodes/${nodeId}`, { method: "DELETE" });
  });

  return <Show when={status()?.available !== false} fallback={<SettingNote tone="quiet">This build of Conduit does not include the device companion.</SettingNote>}>
    <SettingLine label={`Share with ${props.server}`} state={status()?.running ? "On" : settings()?.serveAsDevice ? "Starting…" : "Off"}
      title="Makes the folders you choose here available to the server. It keeps running in the tray with the window closed, and starts at sign-in when Launch at sign-in is on.">
      <Switch id="device-serve" label={`Share with ${props.server}`} disabled={busy() || !settings()} checked={Boolean(settings()?.serveAsDevice)} onChange={(on) => void serve(on)} />
    </SettingLine>
    <Show when={pairing()} fallback={
      <SettingLine label="Pairing" state="Not paired with this server" plain>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void pair()}>Add this computer</Button>
      </SettingLine>}>
      {(paired) => <>
        <For each={paired().roots} fallback={<SettingNote tone="quiet">No folders made available yet.</SettingNote>}>{(root) =>
          <SettingLine label={root.path} state={["Read", root.write && "edit", root.shell && "commands (full user access)"].filter(Boolean).join(", ")} plain>
            <Show when={served(root.path)}>{(record) =>
              <Button variant="ghost" size="sm" aria-label={`Add ${root.path} as a workspace`}
                onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: props.node!.id, rootId: record().id })}><FolderPlusIcon /> Add workspace</Button>}</Show>
            <Button variant="ghost" size="sm" disabled={busy()} aria-label={`Stop sharing ${root.path}`} onClick={() => void unshare(paired().mainUrl, root.path)}><Trash2Icon /> Remove</Button>
          </SettingLine>}</For>
        <SettingLine label="Let Conduit edit files">
          <Switch id="device-share-write" label="Let Conduit edit files" checked={write()} onChange={setWrite} />
        </SettingLine>
        <SettingLine label="Let Conduit run commands" title="Commands start in the folder but run as you, with everything you can reach.">
          <Switch id="device-share-shell" label="Let Conduit run commands" checked={commands()} onChange={setCommands} />
        </SettingLine>
        <SettingLine label="" plain>
          <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void share(paired().mainUrl)}><FolderPlusIcon /> Make a folder available…</Button>
          <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void unpair(paired().mainUrl, paired().nodeId)}><Trash2Icon /> Unpair</Button>
        </SettingLine>
      </>}
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </Show>;
}

/**
 * The devices as the page shows them: every paired device with its environments, and every client connected now. An
 * app whose companion is one of those environments (it says so on connecting) is that environment, headed; a browser
 * goes in Browsers; any other app is a device of its own, since nothing says which machine it is on.
 */
function networkOf(devices: Device[], clients: Client[], self: string | null, own: string | null): ShownDevice[] {
  const names = new Map(devices.flatMap((device) => device.nodes.map((node) => [node.id, node.name] as const)));
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const byNode = new Map<string, Shown>();
  const list = devices.map((device): ShownDevice => ({ id: device.id, name: device.name, paired: true, clients: device.nodes.map((node) => {
    const shown: Shown = { node, mine: false, part: { id: node.id, name: node.name, online: node.online,
      meta: [node.local ? count(node.roots.length, "workspace") : node.roots.length ? count(node.roots.length, "folder") : "",
        node.via ? `relayed by ${names.get(node.via) || "another client"}` : ""].filter(Boolean).join(" · ") || undefined } };
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
