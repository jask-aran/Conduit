import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { api } from "../api/client.ts";
import { buildHttpUrl } from "../api/transport.js";
import { nativeBearerToken } from "../api/native-auth-client.ts";
import { activeOrigin, dialOrigin, servers } from "../platform/servers.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { connectionId } from "../state/runtime.ts";
import type { Project } from "../api/contracts";
import type { NetworkClient } from "@/components/ui/network";
import { StatusDot } from "@/components/ui/nav";
import { SettingLine, SettingValue } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { harnessLabelFor } from "../harness-brand";
import type { Device, Environment, SharedRoot } from "../platform/devices.ts";

/** The hub's list of devices (GET /v0/nodes), as device-api.js declares it: an environment is the code's node. */
export type { SharedRoot } from "../platform/devices.ts";
export type Node = Environment;
/** A client connected to this server now (runtime-hub.js): its kind, build, and what its user agent says it runs on. */
/** `machine`: where the server saw it connect from -- "hub" (its own machine) or a tailnet machine's name. */
type Client = { id: string; kind: string; build: string; registration?: string; platform?: string; agent?: string; nodes?: string[]; machine?: string };
export type { Device };
/** One client as a page shows it: on the map, and as its card. */
export type Shown = { part: NetworkClient; node?: Node; mine: boolean };
export type ShownDevice = { id: string; name: string; paired: boolean; clients: Shown[] };

/** Clients told apart by nothing but their number are one line: two tabs of Chrome on Windows, "Windows · 2 tabs". */
export const together = (clients: Shown[]): Shown[] => {
  const lines = new Map<string, { shown: Shown; count: number }>();
  for (const shown of clients) {
    const key = shown.node || shown.mine ? `own:${lines.size}` : `${shown.part.headed}|${shown.part.name}|${shown.part.meta}|${shown.part.online}`;
    const line = lines.get(key);
    if (line) line.count += 1; else lines.set(key, { shown, count: 1 });
  }
  return [...lines.values()].map(({ shown, count }) => count < 2 ? shown
    : { ...shown, part: { ...shown.part, meta: [shown.part.meta, shown.part.headed === "browser" ? `${count} tabs` : `×${count}`].filter(Boolean).join(" · ") } });
};
export const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
/** The workspaces a client mounts: each is placed on one (an older one with no node is the hub's). */
export const mountedOn = (projects: Project[], node: Node) => projects.filter((project) => isWorkspace(project) && (project.nodeId ? project.nodeId === node.id : Boolean(node.local)));

/**
 * One server's network, read every few seconds: its devices, the clients connected to it and (for another server) its
 * projects, shown as devices of clients. The server in use is asked as usual; another only from an installed app, with
 * the sign-in it keeps for that server (a browser can only ask the server it is on: `readable` is false).
 */
export function createNetwork(options: {
  /** The origin of the server whose network this is. */
  origin: () => string;
  /** The server in use's projects (another server's are asked of it). */
  projects: () => Project[];
  /** This app's own environment, when its companion is paired with this server. */
  own?: () => string | null;
  /** Read again with the network. */
  onRefresh?: () => void;
}) {
  const entry = () => servers().find((item) => item.origin === options.origin()) ?? null;
  const active = () => options.origin() === activeOrigin();
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
  const projects = () => active() ? options.projects() : theirProjects();
  const refresh = () => {
    const asked = options.origin();
    if (!readable()) return;
    const mine = (apply: () => void) => { if (options.origin() === asked) apply(); };
    void get<{ devices: Device[] }>("/v0/nodes")
      .then((answer) => mine(() => { setDevices(answer.devices); setError(""); }))
      .catch((cause: Error) => mine(() => setError(cause.message || "The server did not list its devices.")));
    void get<{ clients?: Client[] }>("/v0/runtime/clients").then((answer) => mine(() => setClients(answer.clients || []))).catch(() => {});
    if (!active()) void get<{ projects?: Project[] } | Project[]>("/v0/projects")
      .then((answer) => mine(() => setTheirProjects(Array.isArray(answer) ? answer : answer.projects || []))).catch(() => {});
    options.onRefresh?.();
  };
  // A server picked: its network, from nothing, so one server's devices never show under another's name.
  createEffect(on(options.origin, () => { setDevices(null); setClients([]); setTheirProjects([]); setError(""); refresh(); }, { defer: true }));
  refresh();
  // Whether each client is connected changes under the page.
  const timer = setInterval(refresh, 5_000);
  onCleanup(() => clearInterval(timer));

  const network = createMemo(() => networkOf(devices() || [], clients(), active() ? connectionId() : null, active() ? options.own?.() ?? null : null, projects()));
  const hubDevice = () => (devices() || []).find((item) => item.hub);
  const hubNode = () => hubDevice()?.nodes.find((item) => item.local);
  const server = () => hubDevice()?.hub || "This server";
  return { entry, active, readable, devices, clients, projects, error, setError, refresh, network, hubDevice, hubNode, server };
}

/**
 * The devices as a page shows them: every paired device with its environments, and every client connected now. An
 * app whose companion is one of those environments (it says so on connecting) is that environment, headed. Any other
 * client goes to the machine the server saw it connect from: the hub's own device, a paired device of that name, or
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
    const machine = client.machine === "hub" ? list.find((device) => devices.find((paired) => paired.id === device.id)?.hub)
      : client.machine ? list.find((device) => device.name.toLowerCase() === client.machine!.toLowerCase()) : undefined;
    // An app whose companion has no pairing now (taken off the network, or not set up again) still is the environment
    // of its OS on its machine: the one environment of that name there, away and not claimed by another app. It is
    // not connected (its workspaces are away) until it is paired again.
    const unpaired = () => {
      if (form !== "desktop" || !machine || !client.platform) return undefined;
      const candidates = machine.clients.filter((item) => item.node && !item.node.online && !item.part.headed
        && item.node.name.toLowerCase() === client.platform!.toLowerCase());
      return candidates.length === 1 ? candidates[0] : undefined;
    };
    const here = (mine && own ? [own] : []).concat(client.nodes || []).map((node) => byNode.get(node)).find(Boolean) ?? unpaired();
    if (here) {
      here.mine ||= mine;
      Object.assign(here.part, { headed: form, online: true, meta: [name, mine ? said : "", here.node?.online ? here.part.meta : "not connected"].filter(Boolean).join(" · ") });
      continue;
    }
    const shown: Shown = { mine, part: { id: client.id, name, headed: form, online: true, meta: said || undefined } };
    if (machine) machine.clients.push(shown);
    else if (client.machine && client.machine !== "hub") list.push({ id: `machine:${client.machine}`, name: client.machine, paired: false, clients: [shown] });
    else if (form === "browser" && !mine) browsers.clients.push(shown);
    else list.push({ id: `client:${key}`, name: form === "phone" ? "Phone" : form === "browser" ? "This browser" : client.platform || "Computer", paired: false, clients: [shown] });
  }
  return browsers.clients.length ? [...list, browsers] : list;
}

/** One environment's declared harnesses, a line each with its status; none declared is said so. */
export function DeviceHarnesses(props: { node: Node; named?: boolean }) {
  const harnesses = () => props.node.harnesses || [];
  return <Group kind="column" title={props.named ? `Harnesses · ${props.node.name}` : "Harnesses"}>
    <Show when={harnesses().length} fallback={<Note>{props.node.name} declares none. A device offers its harnesses (Claude Code, Codex, OpenCode) once it shares a folder that may run commands.</Note>}>
      <For each={harnesses()}>{(id) =>
        <SettingLine plain label={harnessLabelFor(id) || id} state={props.node.name} title={`${harnessLabelFor(id) || id}, installed on ${props.node.name}; chats on its folders can run it there.`}>
          <StatusDot label={props.node.online ? "Ready" : "Offline"} tone={props.node.online ? "success" : "muted"} />
          <SettingValue>{props.node.online ? "Ready" : "Offline"}</SettingValue>
        </SettingLine>}
      </For>
    </Show>
  </Group>;
}
