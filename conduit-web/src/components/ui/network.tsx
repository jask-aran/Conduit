import { For, Show, type JSX } from "solid-js";
import * as Icons from "./icons";
import { StatusDot } from "./nav";

/**
 * A client of the network: an environment (an OS, a WSL distro) whose node makes its folders available, an app or a
 * browser driving Conduit, or both at once -- Windows with the app open on it is one client, headed.
 */
export type NetworkClient = {
  id: string;
  name: string;
  /** An app or a browser here drives Conduit; its form picks the mark. Headless otherwise. */
  headed?: "desktop" | "phone" | "browser";
  /** Said muted after the name: "Conduit Dev · this app", "11 workspaces". */
  meta?: string;
  online: boolean;
};
/** A machine and its clients. Browsers with no machine of their own share one. */
export type NetworkDevice = { id: string; name: string; clients: NetworkClient[] };
/** The head: the server the network is named for, the device it runs on (its box's title), and the client ("on Ubuntu"). */
export type NetworkHead = { name: string; device?: string; meta?: string };

/** A client's mark: its form when headed, a shell when not. */
export const clientMark = (client: NetworkClient): JSX.Element => client.headed === "phone" ? <Icons.Phone />
  : client.headed === "browser" ? <Icons.Browser /> : client.headed ? <Icons.Monitor /> : <Icons.Shell />;

function Line(props: { icon: JSX.Element; name: string; meta?: string; online: boolean }) {
  return <li class="ui-network-line" data-offline={props.online ? undefined : ""}>
    <span class="ui-network-mark" aria-hidden="true">{props.icon}</span>
    <span class="ui-network-name">{props.name}</span>
    <Show when={props.meta}><span class="ui-network-meta">{props.meta}</span></Show>
    <StatusDot label={props.online ? "Connected" : "Offline"} tone={props.online ? "success" : "muted"} />
  </li>;
}

/**
 * The network as it stands: the head at the top, every device hung from it by a line (dashed while none of its
 * clients is connected), each device's clients inside it. Clients talk to the head, never to each other, so the head
 * is the root and the devices its spokes -- the device the head runs on among them.
 */
export function NetworkMap(props: { head: NetworkHead; devices: NetworkDevice[]; label?: string }) {
  return <figure class="ui-network" aria-label={props.label ?? "Network"}>
    <section class="ui-network-box" data-head="" aria-label={props.head.name}>
      <Show when={props.head.device}><h4 class="ui-title">{props.head.device}</h4></Show>
      <ul><Line icon={<Icons.Server />} name={props.head.name} meta={props.head.meta} online /></ul>
    </section>
    <Show when={props.devices.length}>
      <div class="ui-network-spokes">
        <For each={props.devices}>{(device) => <div class="ui-network-spoke" data-offline={device.clients.some((client) => client.online) ? undefined : ""}>
          <section class="ui-network-box" aria-label={device.name}>
            <h4 class="ui-title">{device.name}</h4>
            <ul><For each={device.clients}>{(client) => <Line icon={clientMark(client)} name={client.name} meta={client.meta} online={client.online} />}</For></ul>
          </section>
        </div>}</For>
      </div>
    </Show>
  </figure>;
}

/** Cards of clients side by side, as many to a line as the room holds: a device's clients, opened. */
export const ClientCards = (props: { label?: string; children: JSX.Element }) => <div class="ui-client-cards" role="list" aria-label={props.label}>{props.children}</div>;

/**
 * One client, outlined: its mark and its name in the label's voice with its dot, what it says (Conduit Dev · this
 * app, Offline since …), its properties as facts, the workspaces it mounts on the network, then its actions along its foot.
 */
export function ClientCard(props: { client: NetworkClient; status: string; mark?: JSX.Element; facts?: JSX.Element; places?: JSX.Element; actions?: JSX.Element }) {
  return <section class="ui-client-card" role="listitem" aria-label={props.client.name} data-offline={props.client.online ? undefined : ""}>
    <header class="ui-client-head">
      <span class="ui-client-mark" aria-hidden="true">{props.mark ?? clientMark(props.client)}</span>
      <h4>{props.client.name}</h4>
      <StatusDot label={props.client.online ? "Connected" : "Offline"} tone={props.client.online ? "success" : "muted"} />
    </header>
    <p class="ui-client-status">{[props.status, props.client.meta].filter(Boolean).join(" · ")}</p>
    <Show when={props.facts}><dl class="ui-client-facts">{props.facts}</dl></Show>
    <Show when={props.places}><div class="ui-client-places">{props.places}</div></Show>
    <Show when={props.actions}><footer class="ui-client-actions">{props.actions}</footer></Show>
  </section>;
}

/** A property of a client: its name, then its value or its control (a switch, on the device it belongs to). */
export const ClientFact = (props: { label: string; title?: string; children: JSX.Element }) =>
  <div class="ui-client-fact" title={props.title}><dt>{props.label}</dt><dd>{props.children}</dd></div>;

/** The workspaces a client mounts, under their label; `none`: a line in their voice instead. */
export function ClientPlaces(props: { label?: string; none?: boolean; empty?: string; children?: JSX.Element }) {
  return <>
    <h5>{props.label ?? "Workspaces"}</h5>
    <Show when={!props.none} fallback={<p class="ui-client-empty">{props.empty ?? "None mounted"}</p>}>{props.children}</Show>
  </>;
}

/** A card's room for what is not there yet (pairing an environment): a dashed outline, its content inside. */
export const ClientAdd = (props: { children: JSX.Element }) => <section class="ui-client-card" role="listitem" data-add="">{props.children}</section>;
