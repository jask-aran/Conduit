import { createSignal, For, onCleanup, Show } from "solid-js";
import { FolderPlusIcon, Trash2Icon } from "lucide-solid";
import { api } from "../api/client.ts";
import { Button, Input } from "@/components/ui/controls";
import { StatusDot } from "@/components/ui/nav";
import { LiveNote, SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";

type SharedRoot = { path: string; read: boolean; write: boolean; shell: boolean };
type Device = { id: string; name: string; platform: string | null; online: boolean; roots: SharedRoot[]; lastSeenAt: string | null };

/**
 * Devices paired with this server, and the folders each shares with it.
 *
 * A device runs the node role (`conduit-node`) and dials this server over the
 * tailnet; what it shares, and whether Conduit may write or run commands
 * there, is set on the device and only shown here. Pairing gives a key once,
 * inside the command to run on the device. A shared folder becomes a
 * workspace from here; chats in it run on the Conduit runtime, on the device.
 */
export function DevicesSettingsTile(props: { onAddWorkspace: (input: { mode: "node"; nodeId: string; path: string }) => Promise<boolean> }) {
  const [devices, setDevices] = createSignal<Device[] | null>(null);
  const [error, setError] = createSignal("");
  const [name, setName] = createSignal("");
  const [pairing, setPairing] = createSignal<{ name: string; command: string } | null>(null);
  const [copied, setCopied] = createSignal(false);

  const refresh = () => void api<{ nodes: Device[] }>("/v0/nodes")
    .then(({ nodes }) => { setDevices(nodes); setError(""); })
    .catch((cause: Error) => setError(cause.message || "The server did not list its devices."));
  refresh();
  // Whether each device is connected changes under the page.
  const timer = setInterval(refresh, 5_000);
  onCleanup(() => clearInterval(timer));

  const pair = async () => {
    setError("");
    try {
      const paired = await api<{ node: Device; command: string }>("/v0/nodes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name().trim() || undefined }),
      });
      setPairing({ name: paired.node.name, command: paired.command });
      setCopied(false);
      setName("");
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The device was not paired."); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  const forget = async (device: Device) => {
    try { await api(`/v0/nodes/${device.id}`, { method: "DELETE" }); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The device was not unpaired."); }
  };
  const grants = (root: SharedRoot) => ["Read", root.write && "write", root.shell && "commands, with the device user's full access"].filter(Boolean).join(", ");
  const seen = (device: Device) => device.online ? "Connected" : device.lastSeenAt ? `Offline · last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "Not connected yet";

  return <>
    <SettingGroup title="Pair a device">
      <SettingLine label="Name" title="What this server calls the device; it can say its own name when it first connects.">
        <Input aria-label="Device name" placeholder="Laptop" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      </SettingLine>
      <SettingLine label="Pairing" plain>
        <Button variant="ghost" size="sm" onClick={() => void pair()}>Pair</Button>
      </SettingLine>
      <Show when={pairing()}>{(paired) => <>
        <SettingNote>Run this on {paired().name}, then share a folder there with “conduit-node share” and start it with “conduit-node run”. The key is shown once.</SettingNote>
        <SettingLine label="Command" plain>
          <SettingValue mono>{paired().command}</SettingValue>
          <Button variant="ghost" size="sm" onClick={() => void copy(paired().command)}>Copy</Button>
        </SettingLine>
        <Show when={copied()}><LiveNote>Copied</LiveNote></Show>
      </>}</Show>
    </SettingGroup>

    <For each={devices() || []}>{(device) => <SettingGroup title={device.name}>
      <SettingLine label={seen(device)} state={device.platform || ""} plain>
        <StatusDot label={seen(device)} tone={device.online ? "success" : "muted"} />
        <Button variant="ghost" size="sm" aria-label={`Unpair ${device.name}`} onClick={() => void forget(device)}><Trash2Icon /> Unpair</Button>
      </SettingLine>
      <For each={device.roots} fallback={<SettingNote tone="quiet">Shares no folders yet.</SettingNote>}>{(root) =>
        <SettingLine label={root.path} state={grants(root)} plain>
          <Button variant="ghost" size="sm" aria-label={`Add ${root.path} on ${device.name} as a workspace`}
            onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: device.id, path: root.path })}><FolderPlusIcon /> Add workspace</Button>
        </SettingLine>}</For>
    </SettingGroup>}</For>
    <Show when={devices() && !devices()!.length}><SettingNote tone="quiet">No devices paired yet.</SettingNote></Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
  </>;
}
