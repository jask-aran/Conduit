import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { FolderPlusIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { api } from "../api/client.ts";
import { httpUrl } from "../api/transport.js";
import { Button, Input, Switch } from "@/components/ui/controls";
import { Select } from "@/components/menus";
import { StatusDot } from "@/components/ui/nav";
import { NetworkMap, type NetworkDevice, type NetworkPart } from "@/components/ui/network";
import { connectionId } from "../state/runtime.ts";
import { LiveNote, SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";
import { desktopShell, type CompanionStatus, type DesktopShellSettings } from "../platform/installed-client.ts";

type SharedRoot = { id: string; label: string; read: boolean; write: boolean; shell: boolean; allow?: string[] };
type Node = { id: string; deviceId: string; name: string; platform: string | null; online: boolean; local?: boolean; roots: SharedRoot[]; harnesses?: string[]; terminal?: boolean; lastSeenAt: string | null; via?: string | null };
/** A client connected to this server now (runtime-hub.js): its kind, build, and what its user agent says it runs on. */
type Client = { id: string; kind: string; build: string; registration?: string; platform?: string; agent?: string; nodes?: string[] };
const HARNESS_LABELS: Record<string, string> = { "claude-code": "Claude Code" };
type Device = { id: string; name: string; local?: boolean; nodes: Node[] };

const NEW_DEVICE = "";

/**
 * Devices paired with this server, the environments on each, and the folders
 * each environment shares.
 *
 * A device (a PC, a phone) holds nodes -- its Windows host, a WSL distro --
 * and each node runs the node role (`conduit-node`), dials this server over
 * the tailnet and is paired on its own. What a node shares, and whether
 * Conduit may write or run commands there, is set on the node and only shown
 * here. Pairing gives a key once, inside the command to run there. A shared
 * folder becomes a workspace from here; chats in it run on that node.
 */
export function DevicesSettingsTile(props: { onAddWorkspace: (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;
  /** A terminal on the device itself, in its home: this server's "computer" one, or a device's where a folder is shared with commands. */
  onOpenTerminal: (node: { id: string; local?: boolean }) => void }) {
  const [devices, setDevices] = createSignal<Device[] | null>(null);
  const [error, setError] = createSignal("");
  const [deviceId, setDeviceId] = createSignal(NEW_DEVICE);
  const [deviceName, setDeviceName] = createSignal("");
  const [name, setName] = createSignal("");
  const [pairing, setPairing] = createSignal<{ name: string; command: string } | null>(null);
  const [copied, setCopied] = createSignal(false);

  const [clients, setClients] = createSignal<Client[]>([]);
  // This app's own environment, when its companion is paired with this server: the device this client sits on.
  const [companion, setCompanion] = createSignal<CompanionStatus | null>(null);
  const refresh = () => {
    void api<{ devices: Device[] }>("/v0/nodes")
      .then((answer) => { setDevices(answer.devices); setError(""); })
      .catch((cause: Error) => setError(cause.message || "The server did not list its devices."));
    void api<{ clients?: Client[] }>("/v0/runtime/clients").then((answer) => setClients(answer.clients || [])).catch(() => {});
    void desktopShell?.companion.status().then(setCompanion).catch(() => {});
  };
  refresh();
  // Whether each node is connected changes under the page.
  const timer = setInterval(refresh, 5_000);
  onCleanup(() => clearInterval(timer));

  const pair = async () => {
    setError("");
    try {
      const paired = await api<{ node: Node; device: Device; command: string }>("/v0/nodes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name().trim() || undefined,
          ...(deviceId() ? { deviceId: deviceId() } : { deviceName: deviceName().trim() || undefined }) }),
      });
      setPairing({ name: `${paired.device.name} · ${paired.node.name}`, command: paired.command });
      setCopied(false);
      setName("");
      setDeviceName("");
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The device was not paired."); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  const forget = async (node: Node) => {
    try { await api(`/v0/nodes/${node.id}`, { method: "DELETE" }); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The environment was not unpaired."); }
  };
  // Secrets are kept back by default (src/nodes/secrets.js); only a root's exceptions are worth saying.
  const grants = (root: SharedRoot) => ["Read", root.write && "write", root.shell && "commands (full user access)"].filter(Boolean).join(", ")
    + (root.allow?.length ? ` · shares ${root.allow.join(", ")}` : "");
  const seen = (node: Node) => node.online ? "Connected" : node.lastSeenAt
    ? `Offline since ${new Date(node.lastSeenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not connected yet";
  const network = createMemo(() => networkOf(devices() || [], clients(), connectionId(), companion()));
  // This app's environment, when its companion is paired with this server (found by the node id the server gave).
  const ownNode = () => (companion()?.node?.pairings || []).map((pairing) => pairing.nodeId).find((id) => id && (devices() || []).some((device) => device.nodes.some((node) => node.id === id))) || null;
  // What the page shows under the map: a part picked there, else this app's environment, else the head.
  const [picked, setPicked] = createSignal<string | null>(null);
  const parts = () => network().flatMap((device) => device.parts.map((part) => ({ device, part })));
  const current = () => parts().find(({ part }) => part.id === picked()) ?? parts().find(({ part }) => part.id === ownNode())
    ?? parts().find(({ part }) => part.head) ?? null;
  const nodeOf = (id: string) => (devices() || []).flatMap((device) => device.nodes.map((node) => ({ device, node }))).find(({ node }) => node.id === id) ?? null;

  return <>
    <Show when={devices()}><NetworkMap devices={network()} current={current()?.part.id} onPick={setPicked} /></Show>
    <Show when={current()}>{(shown) => <Show when={nodeOf(shown().part.id)} fallback={
      // A client with no environment here: a browser, a phone, or this app before it serves this computer.
      <SettingGroup title={shown().device.name}>
        <SettingLine label={shown().part.name} state={shown().part.meta ? `Connected · ${shown().part.meta}` : "Connected"} plain>
          <StatusDot label="Connected" tone="success" />
        </SettingLine>
        <Show when={shown().part.id === connectionId()}><ThisComputer devices={devices} node={null} refresh={refresh} onAddWorkspace={props.onAddWorkspace} /></Show>
      </SettingGroup>}>{(found) => {
        const node = () => found().node;
        const own = () => node().id === ownNode();
        return <SettingGroup title={`${found().device.name} · ${node().name}`}>
          {/* An app is connected there but its node is off: the environment is not serving, not offline. */}
          <SettingLine label="Status" state={!node().online && shown().part.headed ? "Not serving" : seen(node())} plain>
            <StatusDot label={seen(node())} tone={node().online ? "success" : "muted"} />
          </SettingLine>
          <Show when={node().harnesses?.length}>
            <SettingLine label="Runs" state={node().harnesses!.map((id) => HARNESS_LABELS[id] || id).join(", ")} plain />
          </Show>
          {/* The head's folders are already its workspaces (plan decision 24); it is not unpaired. */}
          <Show when={node().local}><SettingLine label="Workspaces" state={`${node().roots.length} here`} plain /></Show>
          <Show when={own()} fallback={<Show when={!node().local}>
            <For each={node().roots} fallback={<SettingNote tone="quiet">{node().name} shares no folders yet.</SettingNote>}>{(root) =>
              <SettingLine label={root.label} state={grants(root)} plain>
                <Button variant="ghost" size="sm" aria-label={`Add ${root.label} on ${node().name} as a workspace`}
                  onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: node().id, rootId: root.id })}><FolderPlusIcon /> Add workspace</Button>
              </SettingLine>}</For>
          </Show>}>
            <ThisComputer devices={devices} node={node()} refresh={refresh} onAddWorkspace={props.onAddWorkspace} />
          </Show>
          <Show when={(node().online && (node().local || node().terminal)) || (!node().local && !own())}>
            <SettingLine label="" plain>
              <Show when={node().online && (node().local || node().terminal)}>
                <Button variant="ghost" size="sm" aria-label={`Open a terminal on ${node().name}`} onClick={() => props.onOpenTerminal(node())}><TerminalIcon /> Terminal</Button>
              </Show>
              <Show when={!node().local && !own()}>
                <Button variant="ghost" size="sm" aria-label={`Unpair ${node().name} on ${found().device.name}`} onClick={() => void forget(node())}><Trash2Icon /> Unpair</Button>
              </Show>
            </SettingLine>
          </Show>
        </SettingGroup>;
      }}</Show>}</Show>
    <SettingGroup title="Pair a device">
      <SettingLine label="Device" title="A device already paired, for another environment on it, or a new device.">
        <Select aria-label="Device" value={deviceId()} onChange={(event) => setDeviceId(event.currentTarget.value)}>
          <option value={NEW_DEVICE} selected={!deviceId()}>New device</option>
          <For each={devices() || []}>{(device) => <option value={device.id} selected={device.id === deviceId()}>{device.name}</option>}</For>
        </Select>
      </SettingLine>
      <Show when={!deviceId()}>
        <SettingLine label="Device name">
          <Input aria-label="Device name" placeholder="Desktop PC" value={deviceName()} onInput={(event) => setDeviceName(event.currentTarget.value)} />
        </SettingLine>
      </Show>
      <SettingLine label="Environment" title="Which environment on the device: its OS, a WSL distro, a container.">
        <Input aria-label="Environment name" placeholder="Windows" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      </SettingLine>
      <SettingLine label="Pairing" plain>
        <Button variant="ghost" size="sm" onClick={() => void pair()}>Pair</Button>
      </SettingLine>
      <Show when={pairing()}>{(paired) => <>
        <SettingNote>Run this in {paired().name}, then share a folder there with “conduit-node share” and start it with “conduit-node run”. The key is shown once.</SettingNote>
        <SettingLine label="Command" plain>
          <SettingValue mono>{paired().command}</SettingValue>
          <Button variant="ghost" size="sm" onClick={() => void copy(paired().command)}>Copy</Button>
        </SettingLine>
        <Show when={copied()}><LiveNote>Copied</LiveNote></Show>
      </>}</Show>
    </SettingGroup>

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
function ThisComputer(props: { devices: () => Device[] | null; node: Node | null; refresh: () => void;
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
    <SettingLine label="Serve this computer" state={status()?.running ? "Running" : settings()?.serveAsDevice ? "Starting…" : "Off"}
      title="Lets this server work in folders you share from this computer. It keeps running in the tray with the window closed, and starts at sign-in when Launch at sign-in is on.">
      <Switch id="device-serve" label="Serve this computer" disabled={busy() || !settings()} checked={Boolean(settings()?.serveAsDevice)} onChange={(on) => void serve(on)} />
    </SettingLine>
    <Show when={pairing()} fallback={
      <SettingLine label="Pairing" state="Not paired with this server" plain>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void pair()}>Add this computer</Button>
      </SettingLine>}>
      {(paired) => <>
        <For each={paired().roots} fallback={<SettingNote tone="quiet">No folders shared with this server yet.</SettingNote>}>{(root) =>
          <SettingLine label={root.path} state={["Read", root.write && "edit", root.shell && "commands (full user access)"].filter(Boolean).join(", ")} plain>
            <Show when={served(root.path)}>{(record) =>
              <Button variant="ghost" size="sm" aria-label={`Add ${root.path} as a workspace`}
                onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: props.node!.id, rootId: record().id })}><FolderPlusIcon /> Add workspace</Button>}</Show>
            <Button variant="ghost" size="sm" disabled={busy()} aria-label={`Stop sharing ${root.path}`} onClick={() => void unshare(paired().mainUrl, root.path)}><Trash2Icon /> Stop sharing</Button>
          </SettingLine>}</For>
        <SettingLine label="Let Conduit edit files">
          <Switch id="device-share-write" label="Let Conduit edit files" checked={write()} onChange={setWrite} />
        </SettingLine>
        <SettingLine label="Let Conduit run commands" title="Commands start in the folder but run as you, with everything you can reach.">
          <Switch id="device-share-shell" label="Let Conduit run commands" checked={commands()} onChange={setCommands} />
        </SettingLine>
        <SettingLine label="" plain>
          <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void share(paired().mainUrl)}><FolderPlusIcon /> Share a folder…</Button>
          <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void unpair(paired().mainUrl, paired().nodeId)}><Trash2Icon /> Unpair</Button>
        </SettingLine>
      </>}
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </Show>;
}

/**
 * The map's devices: every paired device with its environments, and every client connected now. An app whose
 * companion is one of those environments (it says so on connecting) is that environment, headed; any other client is
 * a device of its own -- a phone, a browser -- since nothing says which machine it is on. A browser's tabs are one.
 */
function networkOf(devices: Device[], clients: Client[], self: string | null, companion: CompanionStatus | null): NetworkDevice[] {
  const names = new Map(devices.flatMap((device) => device.nodes.map((node) => [node.id, node.name] as const)));
  const parts = new Map<string, NetworkPart>();
  const map = devices.map((device): NetworkDevice => ({ id: device.id, name: device.name, parts: device.nodes.map((node) => {
    const part: NetworkPart = { id: node.id, name: node.name, head: node.local, online: node.online,
      meta: node.via ? `relayed by ${names.get(node.via) || "another environment"}` : undefined };
    parts.set(node.id, part);
    return part;
  }) }));
  const ownNodes = (companion?.node?.pairings || []).map((pairing) => pairing.nodeId);
  const seen = new Set<string>();
  for (const client of clients) {
    const key = client.kind === "browser" && client.registration ? `registration:${client.registration}` : client.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = client.id === self;
    const form = client.kind === "android" || /^(Android|iOS)$/.test(client.platform || "") ? "phone" : client.kind === "desktop" ? "desktop" : "browser";
    const name = client.kind === "browser" ? client.agent || "Browser" : /-dev/.test(client.build) ? "Conduit Dev" : "Conduit";
    const here = (mine ? ownNodes : []).concat(client.nodes || []).map((node) => node && parts.get(node)).find(Boolean);
    const said = mine ? (form === "browser" ? "this browser" : "this app") : "";
    if (here) {
      // Not serving is the environment's state, said beside the app driving it.
      Object.assign(here, { headed: form, meta: [name, said, here.online ? "" : "not serving", here.meta].filter(Boolean).join(" · "), online: true });
    } else {
      map.push({ id: `client:${key}`, name: form === "phone" ? "Phone" : client.platform ? `${client.platform}${form === "browser" ? " browser" : ""}` : "Browser",
        parts: [{ id: client.id, name, headed: form, online: true, meta: said || undefined }] });
    }
  }
  return map;
}
