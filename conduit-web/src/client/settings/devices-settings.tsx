import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { api } from "../api/client.ts";
import { buildHttpUrl, httpUrl } from "../api/transport.js";
import { nativeBearerToken } from "../api/native-auth-client.ts";
import { DropdownMenu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSection } from "@/components/menus";
import { ServerControl } from "@/components/ui/connection";
import { activeOrigin, dialOrigin, servers, switchToServer } from "../platform/servers.ts";
import { createServerHealth, ServerFacts } from "./server-inspect.tsx";
import type { Project } from "../api/contracts";
import { Button, Input, Switch } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavFolder, NavFolderRow, NavRow } from "@/components/ui/nav";
import { ClientAdd, ClientCard, ClientCards, ClientFact, ClientPlaces, NetworkMap, type NetworkClient } from "@/components/ui/network";
import { Reading, ReadingStat, ReadingStats } from "@/components/ui/reading";
import { connectionId } from "../state/runtime.ts";
import { LiveNote, SettingGroup, SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";
import { WorkspaceGlyph } from "../project/workspace-appearance.tsx";
import { desktopShell, isInstalledClient, type CompanionStatus, type DesktopShellSettings } from "../platform/installed-client.ts";

type SharedRoot = { id: string; label: string; read: boolean; write: boolean; shell: boolean; allow?: string[] };
type Node = { id: string; deviceId: string; name: string; platform: string | null; online: boolean; local?: boolean; roots: SharedRoot[]; harnesses?: string[]; terminal?: boolean; lastSeenAt: string | null; via?: string | null };
/** A client connected to this server now (runtime-hub.js): its kind, build, and what its user agent says it runs on. */
/** `machine`: where the server saw it connect from -- "head" (its own machine) or a tailnet machine's name. */
type Client = { id: string; kind: string; build: string; registration?: string; platform?: string; agent?: string; nodes?: string[]; machine?: string };
/** `head`: on the device the head runs on, the server's name. */
type Device = { id: string; name: string; local?: boolean; head?: string; nodes: Node[] };
/** One client as this page shows it: on the map, and as its card. */
type Shown = { part: NetworkClient; node?: Node; mine: boolean };
type ShownDevice = { id: string; name: string; paired: boolean; clients: Shown[] };
type AddWorkspace = (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;

const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
/** The workspaces a client mounts: each is placed on one (an older one with no node is the head's). */
const mountedOn = (projects: Project[], node: Node) => projects.filter((project) => isWorkspace(project) && (project.nodeId ? project.nodeId === node.id : Boolean(node.local)));

/**
 * The servers this client knows, one at a time: picked at the top (each with its status), then the network it heads --
 * its map, this device (named here, and where its sharing is set), the server (its figures and what this client knows
 * of it) and every other device, each opening to its clients' cards. Another server is inspected, not changed: the
 * installed apps ask it with the sign-in they keep for it; a browser can only ask its own, and offers Switch to.
 *
 * A device (a PC, a phone) holds clients: environments (its Windows, a WSL distro) whose node (`conduit-node`) mounts
 * folders on the network as workspaces, and apps or browsers driving Conduit; Windows with the app open on it is one
 * client. The head's environment mounts the server's own workspaces. A browser is a device of its own.
 */
export function DevicesSettingsTile(props: { projects: Project[]; onAddWorkspace: AddWorkspace;
  /** A terminal on the device itself, in its home: this server's "computer" one, or a device's where a folder is shared with commands. */
  onOpenTerminal: (node: { id: string; local?: boolean }) => void;
  onOpenWorkspace: (project: Project) => void }) {
  const health = createServerHealth();
  const [inspected, setInspected] = createSignal(activeOrigin() || "");
  const entry = () => servers().find((item) => item.origin === inspected()) ?? null;
  const active = () => inspected() === activeOrigin();
  // Another server can be asked only from an installed app, with the sign-in it keeps for that server.
  const readable = () => active() || isInstalledClient();
  const get = async <T,>(path: string): Promise<T> => {
    if (active()) return api<T>(path);
    const known = entry();
    const token = known ? await nativeBearerToken(known.origin) : null;
    if (!known || !token) throw new Error("Not signed in to that server here.");
    const response = await fetch(buildHttpUrl(path, dialOrigin(known.origin, known)), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error(`${known.name} answered ${response.status}.`);
    return response.json() as Promise<T>;
  };
  const [devices, setDevices] = createSignal<Device[] | null>(null);
  const [error, setError] = createSignal("");
  const [clients, setClients] = createSignal<Client[]>([]);
  const [theirProjects, setTheirProjects] = createSignal<Project[]>([]);
  const projects = () => active() ? props.projects : theirProjects();
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const refresh = () => {
    const asked = inspected();
    if (!readable()) return;
    const mine = (apply: () => void) => { if (inspected() === asked) apply(); };
    void get<{ devices: Device[] }>("/v0/nodes")
      .then((answer) => mine(() => { setDevices(answer.devices); setError(""); }))
      .catch((cause: Error) => mine(() => setError(cause.message || "The server did not list its devices.")));
    void get<{ clients?: Client[] }>("/v0/runtime/clients").then((answer) => mine(() => setClients(answer.clients || []))).catch(() => {});
    if (!active()) void get<{ projects?: Project[] } | Project[]>("/v0/projects")
      .then((answer) => mine(() => setTheirProjects(Array.isArray(answer) ? answer : answer.projects || []))).catch(() => {});
    companion?.read();
  };
  // A server picked: its network, from nothing, so one server's devices never show under another's name.
  createEffect(on(inspected, () => { setDevices(null); setClients([]); setTheirProjects([]); setError(""); refresh(); }, { defer: true }));
  // This app's own client: its companion, paired with this server or not.
  const companion = desktopShell ? createCompanion(devices, () => refresh()) : null;
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

  const ownNode = () => companion?.pairing()?.nodeId ?? null;
  const network = createMemo(() => networkOf(devices() || [], clients(), active() ? connectionId() : null, active() ? ownNode() : null, projects()));
  const thisDevice = () => network().find((device) => device.clients.some((shown) => shown.mine)) ?? null;
  const others = () => network().filter((device) => device !== thisDevice());
  const headDevice = () => (devices() || []).find((item) => item.head);
  const headNode = () => headDevice()?.nodes.find((item) => item.local);
  const server = () => headDevice()?.head || "This server";

  const status = (shown: Shown) => !shown.node || shown.node.online || shown.part.headed ? "Connected" : shown.node.lastSeenAt
    ? `Offline since ${new Date(shown.node.lastSeenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Not connected yet";
  // What a client mounts: the head's environment the server's own workspaces, any other the ones made from its folders.
  const mounted = (node: Node) => mountedOn(projects(), node);
  const unmounted = (node: Node) => node.local ? [] : node.roots.filter((root) => !projects().some((project) => project.nodeId === node.id && project.place?.root === root.id));

  /** A client's card. `here`: on this device, where its own settings are. */
  const card = (shown: Shown, here: boolean) => {
    // Another server's network is inspected, not changed.
    if (!active()) return <ClientCard client={shown.part} status={status(shown)} places={<Show when={shown.node}>{(node) =>
      <ClientPlaces none={!mounted(node()).length}><For each={mounted(node())}>{(project) =>
        <NavRow icon={<WorkspaceGlyph appearance={project.workspaceAppearance} />} disabled>{project.name}</NavRow>}</For></ClientPlaces>}</Show>} />;
    const own = () => here && shown.mine && companion && (!shown.node || shown.node.id === ownNode());
    return <ClientCard client={shown.part} status={status(shown)}
      facts={<Show when={own() && companion!.pairing()}>
        <ClientFact label={`Share with ${server()}`} title="Mounts the folders you choose on this computer in the network. It keeps running in the tray with the window closed.">
          <Switch id="device-serve" label={`Share with ${server()}`} disabled={companion!.busy() || !companion!.settings()} checked={Boolean(companion!.settings()?.serveAsDevice)} onChange={(on) => void companion!.serve(on)} />
        </ClientFact>
        <ClientFact label="New folders can be edited"><Switch id="device-share-write" label="New folders can be edited" checked={companion!.write()} onChange={companion!.setWrite} /></ClientFact>
        <ClientFact label="New folders run commands" title="Commands start in the folder but run as you, with everything you can reach.">
          <Switch id="device-share-shell" label="New folders run commands" checked={companion!.commands()} onChange={companion!.setCommands} />
        </ClientFact>
      </Show>}
      places={<Show when={shown.node}>{(node) => <ClientPlaces none={!mounted(node()).length && !unmounted(node()).length}>
          <For each={mounted(node())}>{(project) =>
            <NavRow icon={<WorkspaceGlyph appearance={project.workspaceAppearance} />} onClick={() => props.onOpenWorkspace(project)}>{project.name}</NavRow>}</For>
          <For each={unmounted(node())}>{(root) =>
            <NavRow icon={<Icons.Folder />} meta="Mount" title={`Mount ${root.label} as a workspace`}
              onClick={() => void props.onAddWorkspace({ mode: "node", nodeId: node().id, rootId: root.id })}>{root.label}</NavRow>}</For>
      </ClientPlaces>}</Show>}
      actions={<>
        <Show when={shown.node?.online && (shown.node.local || shown.node.terminal)}>
          <Button variant="ghost" size="sm" onClick={() => props.onOpenTerminal(shown.node!)}><Icons.Terminal /> Terminal</Button>
        </Show>
        <Show when={own()} fallback={<Show when={shown.node && !shown.node.local}>
          <Button variant="ghost" size="sm" aria-label={`Unpair ${shown.part.name}`} onClick={() => void forget(shown.node!)}>Unpair</Button>
        </Show>}>
          <Show when={companion!.pairing()} fallback={<Button variant="ghost" size="sm" disabled={companion!.busy()} onClick={() => void companion!.pair()}>Add this computer</Button>}>{(paired) => <>
            <Button variant="ghost" size="sm" disabled={companion!.busy()} onClick={() => void companion!.share(paired().mainUrl)}><Icons.NewFolder /> Mount a folder…</Button>
            <Button variant="ghost" size="sm" disabled={companion!.busy()} onClick={() => void companion!.unpair(paired().mainUrl, paired().nodeId)}>Unpair</Button>
          </>}</Show>
        </Show>
      </>} />;
  };

  return <>
    {/* Which server's network: each with its status, the one in use first; picking one inspects it, Switch to uses it. */}
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
    <Show when={!readable()}><SettingNote tone="quiet">A browser can only ask the server it is on. Switch to {entry()?.name} to see its network.</SettingNote></Show>

    <Show when={devices()}><NetworkMap head={{ name: server(), device: headDevice()?.name, meta: headNode() ? `on ${headNode()!.name}` : undefined }}
      devices={network().map((device) => ({ id: device.id, name: device.name, clients: device.clients.map((shown) => shown.part) }))} /></Show>

    <Show when={active() && thisDevice()}>{(device) => <SettingGroup title="This device">
      <Show when={device().paired}>
        <SettingLine label="Name"><Input aria-label="This device's name" value={device().name} onChange={(event) => rename(device(), event.currentTarget.value)} /></SettingLine>
      </Show>
      <ClientCards label={device().name}>
        <For each={device().clients}>{(shown) => card(shown, true)}</For>
        {/* The app can bring another environment of this machine in (a WSL distro); not where the head already runs. */}
        <Show when={companion && device().paired && !device().clients.some((shown) => shown.node?.local)}><PairEnvironment device={device()} onPaired={refresh} /></Show>
      </ClientCards>
      <Show when={companion?.error()}><SettingNote tone="error">{companion!.error()}</SettingNote></Show>
    </SettingGroup>}</Show>

    <SettingGroup title="Server">
      <NavFolder open={open().has("server")} row={
        <NavFolderRow open={open().has("server")} icon={<Icons.Server />} meta={headNode() ? `on ${headDevice()!.name} · ${headNode()!.name}` : undefined}
          link={{ onClick: () => toggle("server") }}
          toggle={{ "aria-label": `${open().has("server") ? "Close" : "Open"} ${entry()?.name || server()}`, onClick: (event: MouseEvent) => { event.stopPropagation(); toggle("server"); } }}>
          {entry()?.name || server()}
        </NavFolderRow>}>
      {/* What the server holds, read at a glance: figures as the gauge's tiles. */}
      <Show when={devices()}><Reading>
        <ReadingStats title="On the network">
          <ReadingStat label="Devices" value={network().length} />
          <ReadingStat label="Clients" value={network().reduce((sum, device) => sum + device.clients.filter((shown) => shown.part.online).length, 0)} detail="connected" />
          <ReadingStat label="Workspaces" value={projects().filter(isWorkspace).length} />
        </ReadingStats>
      </Reading></Show>
      <Show when={entry()}>{(known) => <ServerFacts entry={known()} health={health} />}</Show>
      </NavFolder>
    </SettingGroup>

    <Show when={others().length}>
      <SettingGroup title="Devices">
        <For each={others()}>{(device) => <NavFolder open={open().has(device.id)} row={
          <NavFolderRow open={open().has(device.id)} icon={device.clients.every((shown) => shown.part.headed === "browser") ? <Icons.Browser /> : <Icons.Monitor />}
            meta={device.clients.map((shown) => shown.part.name).join(", ")}
            link={{ onClick: () => toggle(device.id) }}
            toggle={{ "aria-label": `${open().has(device.id) ? "Close" : "Open"} ${device.name}`, onClick: (event: MouseEvent) => { event.stopPropagation(); toggle(device.id); } }}>
            {device.name}
          </NavFolderRow>}>
          <ClientCards label={device.name}><For each={device.clients}>{(shown) => card(shown, false)}</For></ClientCards>
        </NavFolder>}</For>
      </SettingGroup>
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
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
  return <ClientAdd>
    <ClientPlaces label="Pair an environment" none empty="A WSL distro or a container on this computer, with no app of its own." />
    <Input aria-label="Environment name" placeholder="Ubuntu" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
    <Show when={command()}>
      <SettingValue mono>{command()}</SettingValue>
      <SettingNote>Run it there, then mount a folder with “conduit-node share” and start it with “conduit-node run”. The key is shown once.</SettingNote>
      <Show when={copied()}><LiveNote>Copied</LiveNote></Show>
    </Show>
    <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
    <footer class="ui-client-actions">
      <Button variant="ghost" size="sm" onClick={() => void pair()}><Icons.Add /> Pair</Button>
      <Show when={command()}><Button variant="ghost" size="sm" onClick={() => void copy()}><Icons.Copy /> Copy command</Button></Show>
    </footer>
  </ClientAdd>;
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
 * this server in one step -- the server hands out a key, the shell's node takes it -- and the folders it mounts,
 * picked with the system's folder picker. What a folder allows is chosen when it is mounted.
 */
function createCompanion(devices: () => Device[] | null, refresh: () => void) {
  const shell = desktopShell!;
  const [settings, setSettings] = createSignal<DesktopShellSettings | null>(null);
  const [status, setStatus] = createSignal<CompanionStatus | null>(null);
  const [error, setError] = createSignal("");
  const [write, setWrite] = createSignal(true);
  const [commands, setCommands] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const read = () => void shell.companion.status().then(setStatus).catch(() => setError("The desktop shell did not answer."));
  onMount(() => { void shell.settings().then(setSettings); });

  // This server's pairing, found by the node id it gave: the URL a pairing dials may not be the one this app uses.
  const pairing = () => status()?.node?.pairings.find((item) => item.nodeId && (devices() || []).some((device) => device.nodes.some((node) => node.id === item.nodeId))) || null;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); refresh(); }
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
  const unpair = (mainUrl: string, nodeId: string | null) => act(async () => {
    await shell.companion.unpair(mainUrl);
    if (nodeId) await api(`/v0/nodes/${nodeId}`, { method: "DELETE" });
  });
  return { read, settings, pairing, busy, error, write, setWrite, commands, setCommands, serve, pair, share, unpair };
}

/**
 * The devices as the page shows them: every paired device with its environments, and every client connected now. An
 * app whose companion is one of those environments (it says so on connecting) is that environment, headed. Any other
 * client goes to the machine the server saw it connect from: the head's own device, a paired device of that name, or
 * a device named for that machine. One the server could not place is a device of its own when it is this one, and
 * listed with the other browsers when it is not.
 */
function networkOf(devices: Device[], clients: Client[], self: string | null, own: string | null, projects: Project[]): ShownDevice[] {
  const names = new Map(devices.flatMap((device) => device.nodes.map((node) => [node.id, node.name] as const)));
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const byNode = new Map<string, Shown>();
  const list = devices.map((device): ShownDevice => ({ id: device.id, name: device.name, paired: true, clients: device.nodes.map((node) => {
    const workspaces = mountedOn(projects, node).length;
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
    const machine = client.machine === "head" ? list.find((device) => devices.find((paired) => paired.id === device.id)?.head)
      : client.machine ? list.find((device) => device.name.toLowerCase() === client.machine!.toLowerCase()) : undefined;
    if (machine) machine.clients.push(shown);
    else if (client.machine && client.machine !== "head") list.push({ id: `machine:${client.machine}`, name: client.machine, paired: false, clients: [shown] });
    else if (form === "browser" && !mine) browsers.clients.push(shown);
    else list.push({ id: `client:${key}`, name: form === "phone" ? "Phone" : form === "browser" ? "This browser" : client.platform || "Computer", paired: false, clients: [shown] });
  }
  return browsers.clients.length ? [...list, browsers] : list;
}
