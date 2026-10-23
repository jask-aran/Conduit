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

const mark = (client: NetworkClient): JSX.Element => client.headed === "phone" ? <Icons.Phone />
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
            <ul><For each={device.clients}>{(client) => <Line icon={mark(client)} name={client.name} meta={client.meta} online={client.online} />}</For></ul>
          </section>
        </div>}</For>
      </div>
    </Show>
  </figure>;
}
