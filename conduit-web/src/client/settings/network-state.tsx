import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { api } from "../api/client.ts";
import { buildHttpUrl } from "../api/transport.js";
import { nativeBearerToken } from "../api/native-auth-client.ts";
import { activeOrigin, dialOrigin, servers } from "../platform/servers.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { connectionId } from "../state/runtime.ts";
import { createSingleFlight } from "../state/single-flight.ts";
import type { Project } from "../api/contracts";
import type { NetworkClient } from "@/components/ui/network";
import { StatusDot } from "@/components/ui/nav";
import { SettingLine, SettingValue } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { harnessLabelFor } from "../harness-brand";
import type { Device, Environment } from "../platform/devices.ts";

export type { SharedRoot } from "../platform/devices.ts";
export type Node = Environment;
/** `machine`: where the server saw it connect from -- "hub" (its own machine) or a tailnet machine's name. */
type Client = { id: string; kind: string; build: string; registration?: string; platform?: string; agent?: string; nodes?: string[]; machine?: string };
export type { Device };
/** app: the app or browser this page is seen from, when it is this client ("Conduit Dev · this app"). */
export type Shown = { part: NetworkClient; node?: Node; mine: boolean; app?: string };
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
 * Another server is asked only from an installed app, with the sign-in it keeps for that server: a browser can only
 * ask the server it is on (`readable` is false).
 */
export function createNetwork(options: {
  origin: () => string;
  projects: () => Project[];
  own?: () => string | null;
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
    if (!readable()) return Promise.resolve();
    const mine = (apply: () => void) => { if (options.origin() === asked) apply(); };
    const reads = [get<{ devices: Device[] }>("/v0/nodes")
      .then((answer) => mine(() => { setDevices(answer.devices); setError(""); }))
      .catch((cause: Error) => mine(() => setError(cause.message || "The server did not list its devices."))),
    get<{ clients?: Client[] }>("/v0/runtime/clients").then((answer) => mine(() => setClients(answer.clients || []))).catch(() => {})];
    if (!active()) reads.push(get<{ projects?: Project[] } | Project[]>("/v0/projects")
      .then((answer) => mine(() => setTheirProjects(Array.isArray(answer) ? answer : answer.projects || []))).catch(() => {}));
    options.onRefresh?.();
    return Promise.all(reads).then(() => {});
  };
  // A server picked: its network, from nothing, so one server's devices never show under another's name.
  createEffect(on(options.origin, () => { setDevices(null); setClients([]); setTheirProjects([]); setError(""); refresh(); }, { defer: true }));
  refresh();
  // A tick while the last reads are still out (a slow hub waits up to api's timeout) follows them, not stacks on them.
  const poll = createSingleFlight(refresh);
  const timer = setInterval(() => void poll(), 5_000);
  onCleanup(() => clearInterval(timer));

  const network = createMemo(() => networkOf(devices() || [], clients(), active() ? connectionId() : null, active() ? options.own?.() ?? null : null, projects()));
  const hubDevice = () => (devices() || []).find((item) => item.hub);
  const hubNode = () => hubDevice()?.nodes.find((item) => item.local);
  const server = () => hubDevice()?.hub || "This server";
  return { entry, active, readable, devices, clients, projects, error, setError, refresh, network, hubDevice, hubNode, server };
}

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
      if (mine) here.app = [name, said].join(" · ");
      Object.assign(here.part, { headed: form, online: true, meta: [name, mine ? said : "", here.node?.online ? here.part.meta : "not connected"].filter(Boolean).join(" · ") });
      continue;
    }
    const shown: Shown = { mine, app: mine ? [name, said].join(" · ") : undefined, part: { id: client.id, name, headed: form, online: true, meta: said || undefined } };
    if (machine) machine.clients.push(shown);
    else if (client.machine && client.machine !== "hub") list.push({ id: `machine:${client.machine}`, name: client.machine, paired: false, clients: [shown] });
    else if (form === "browser" && !mine) browsers.clients.push(shown);
    else list.push({ id: `client:${key}`, name: form === "phone" ? "Phone" : form === "browser" ? "This browser" : client.platform || "Computer", paired: false, clients: [shown] });
  }
  return browsers.clients.length ? [...list, browsers] : list;
}

export function DeviceHarnesses(props: { node: Node; named?: boolean }) {
  const harnesses = () => props.node.harnesses || [];
  return <Group title={props.named ? `Harnesses · ${props.node.name}` : "Harnesses"}>
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
