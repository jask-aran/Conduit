import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { FolderPlusIcon, Trash2Icon } from "lucide-solid";
import { api } from "../api/client.ts";
import { httpUrl } from "../api/transport.js";
import { Button, Input, Switch } from "@/components/ui/controls";
import { Select } from "@/components/menus";
import { StatusDot } from "@/components/ui/nav";
import { LiveNote, SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";
import { desktopShell, type CompanionStatus, type DesktopShellSettings } from "../platform/installed-client.ts";

type SharedRoot = { id: string; label: string; read: boolean; write: boolean; shell: boolean; allow?: string[] };
type Node = { id: string; deviceId: string; name: string; platform: string | null; online: boolean; local?: boolean; roots: SharedRoot[]; harnesses?: string[]; lastSeenAt: string | null };
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
export function DevicesSettingsTile(props: { onAddWorkspace: (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean> }) {
  const [devices, setDevices] = createSignal<Device[] | null>(null);
  const [error, setError] = createSignal("");
  const [deviceId, setDeviceId] = createSignal(NEW_DEVICE);
  const [deviceName, setDeviceName] = createSignal("");
  const [name, setName] = createSignal("");
  const [pairing, setPairing] = createSignal<{ name: string; command: string } | null>(null);
  const [copied, setCopied] = createSignal(false);

  const refresh = () => void api<{ devices: Device[] }>("/v0/nodes")
    .then((answer) => { setDevices(answer.devices); setError(""); })
    .catch((cause: Error) => setError(cause.message || "The server did not list its devices."));
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
  const seen = (node: Node) => node.online ? "Connected" : node.lastSeenAt ? `Offline · last seen ${new Date(node.lastSeenAt).toLocaleString()}` : "Not connected yet";

  return <>
    <ThisComputerTile devices={devices} refresh={refresh} />
    <SettingGroup title="Pair">
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

    {/* The head is listed like any device (plan decision 24); its folders are already its workspaces, and it is not unpaired. */}
    <For each={devices() || []}>{(device) => <SettingGroup title={device.local ? `${device.name} · this server` : device.name}>
      <For each={device.nodes}>{(node) => <>
        <SettingLine label={node.name} state={[seen(node), node.platform,
          node.harnesses?.length ? `runs ${node.harnesses.map((id) => HARNESS_LABELS[id] || id).join(", ")}` : null].filter(Boolean).join(" · ")} plain>
          <StatusDot label={seen(node)} tone={node.online ? "success" : "muted"} />
          <Show when={!node.local}>
            <Button variant="ghost" size="sm" aria-label={`Unpair ${node.name} on ${device.name}`} onClick={() => void forget(node)}><Trash2Icon /> Unpair</Button>
          </Show>
        </SettingLine>
        <For each={node.roots} fallback={<SettingNote tone="quiet">{node.name} shares no folders yet.</SettingNote>}>{(root) =>
          <SettingLine label={root.label} state={node.local ? "Workspace" : grants(root)} plain>
            <Show when={!node.local}>
              <Button variant="ghost" size="sm" aria-label={`Add ${root.label} on ${node.name} as a workspace`}
                onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: node.id, rootId: root.id })}><FolderPlusIcon /> Add workspace</Button>
            </Show>
          </SettingLine>}</For>
      </>}</For>
    </SettingGroup>}</For>
    <Show when={devices() && !devices()!.some((device) => !device.local)}><SettingNote tone="quiet">No other devices paired yet.</SettingNote></Show>
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
  return tailnet || ["127.0.0.1", "localhost", "[::1]"].includes(host) ? url.origin : undefined;
}

const thisPlatform = () => /Windows/i.test(navigator.userAgent) ? "Windows" : /Mac/i.test(navigator.userAgent) ? "macOS" : "Linux";

/**
 * This computer as a device of the server this app is pointed at, in the
 * desktop app only: the background node the shell runs (node_companion.rs),
 * paired with this server in one step -- the server hands out a key, the
 * shell's node takes it -- and the folders shared with it, picked with the
 * system's folder picker. What a folder allows is chosen when it is shared.
 */
function ThisComputerTile(props: { devices: () => Device[] | null; refresh: () => void }) {
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

  return <SettingGroup title="This computer">
    <Show when={status()?.available !== false} fallback={<SettingNote tone="quiet">This build of Conduit does not include the device companion.</SettingNote>}>
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
              <Button variant="ghost" size="sm" disabled={busy()} aria-label={`Stop sharing ${root.path}`} onClick={() => void unshare(paired().mainUrl, root.path)}><Trash2Icon /> Stop sharing</Button>
            </SettingLine>}</For>
          <SettingLine label="Let Conduit edit files">
            <Switch id="device-share-write" label="Let Conduit edit files" checked={write()} onChange={setWrite} />
          </SettingLine>
          <SettingLine label="Let Conduit run commands" title="Commands start in the folder but run as you, with everything you can reach.">
            <Switch id="device-share-shell" label="Let Conduit run commands" checked={commands()} onChange={setCommands} />
          </SettingLine>
          <SettingLine label="Folders" plain>
            <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void share(paired().mainUrl)}><FolderPlusIcon /> Share a folder…</Button>
            <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void unpair(paired().mainUrl, paired().nodeId)}>Unpair</Button>
          </SettingLine>
        </>}
      </Show>
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </SettingGroup>;
}
