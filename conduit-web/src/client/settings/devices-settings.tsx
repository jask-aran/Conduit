import { createSignal, For, onCleanup, Show } from "solid-js";
import { FolderPlusIcon, Trash2Icon } from "lucide-solid";
import { api } from "../api/client.ts";
import { Button, Input } from "@/components/ui/controls";
import { Select } from "@/components/menus";
import { StatusDot } from "@/components/ui/nav";
import { LiveNote, SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";

type SharedRoot = { id: string; label: string; read: boolean; write: boolean; shell: boolean; allow?: string[] };
type Node = { id: string; deviceId: string; name: string; platform: string | null; online: boolean; roots: SharedRoot[]; harnesses?: string[]; lastSeenAt: string | null };
const HARNESS_LABELS: Record<string, string> = { "claude-code": "Claude Code" };
type Device = { id: string; name: string; nodes: Node[] };

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

    <For each={devices() || []}>{(device) => <SettingGroup title={device.name}>
      <For each={device.nodes}>{(node) => <>
        <SettingLine label={node.name} state={[seen(node), node.platform,
          node.harnesses?.length ? `runs ${node.harnesses.map((id) => HARNESS_LABELS[id] || id).join(", ")}` : null].filter(Boolean).join(" · ")} plain>
          <StatusDot label={seen(node)} tone={node.online ? "success" : "muted"} />
          <Button variant="ghost" size="sm" aria-label={`Unpair ${node.name} on ${device.name}`} onClick={() => void forget(node)}><Trash2Icon /> Unpair</Button>
        </SettingLine>
        <For each={node.roots} fallback={<SettingNote tone="quiet">{node.name} shares no folders yet.</SettingNote>}>{(root) =>
          <SettingLine label={root.label} state={grants(root)} plain>
            <Button variant="ghost" size="sm" aria-label={`Add ${root.label} on ${node.name} as a workspace`}
              onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: node.id, rootId: root.id })}><FolderPlusIcon /> Add workspace</Button>
          </SettingLine>}</For>
      </>}</For>
    </SettingGroup>}</For>
    <Show when={devices() && !devices()!.length}><SettingNote tone="quiet">No devices paired yet.</SettingNote></Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </>;
}
