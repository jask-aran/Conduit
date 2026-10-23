import { For, Show, type JSX } from "solid-js";
import * as Icons from "./icons";
import { StatusDot } from "./nav";

/**
 * One environment of a device: an OS, a WSL distro, a phone, a browser. Each is a client of the network: headed when
 * an app or browser there drives Conduit, headless when only its node serves. One environment runs the head.
 */
export type NetworkPart = {
  id: string;
  name: string;
  /** It runs the Conduit runtime the rest connect to. */
  head?: boolean;
  /** An app or a browser here drives Conduit; its form picks the mark. */
  headed?: "desktop" | "phone" | "browser";
  /** Said muted after the name: "Conduit Dev · this app · not serving", "relayed by Windows". */
  meta?: string;
  online: boolean;
};
/** A machine: what runs on it, grouped. A web browser or a phone with no node is a device of one client. */
export type NetworkDevice = { id: string; name: string; parts: NetworkPart[] };

const mark = (part: NetworkPart): JSX.Element => part.head ? <Icons.Server />
  : part.headed === "phone" ? <Icons.Phone /> : part.headed === "browser" ? <Icons.Browser /> : part.headed ? <Icons.Monitor /> : <Icons.Shell />;

function Device(props: { device: NetworkDevice }) {
  return <section class="ui-network-device" aria-label={props.device.name}>
    <h4 class="ui-title">{props.device.name}</h4>
    <ul>
      <For each={props.device.parts}>{(part) => <li class="ui-network-part" data-offline={part.online ? undefined : ""}>
        <span class="ui-network-mark" aria-hidden="true">{mark(part)}</span>
        <span class="ui-network-name">{part.name}</span>
        <Show when={part.head}><span class="ui-network-head">head</span></Show>
        <span class="ui-network-meta">{part.meta}</span>
        <StatusDot label={part.online ? "Connected" : "Offline"} tone={part.online ? "success" : "muted"} />
      </li>}</For>
    </ul>
  </section>;
}

/**
 * The network as it stands: the device holding the head, its environments and clients, and every other device hung
 * from it by a line (dashed while nothing on it is connected). Every device talks to the head, never to another
 * device, so the head's device is the root and the rest are its spokes.
 */
export function NetworkMap(props: { devices: NetworkDevice[]; label?: string }) {
  const head = () => props.devices.find((device) => device.parts.some((part) => part.head)) ?? props.devices[0];
  const others = () => props.devices.filter((device) => device.id !== head()?.id);
  return <figure class="ui-network" aria-label={props.label ?? "Network"}>
    <Show when={head()}>{(device) => <Device device={device()} />}</Show>
    <Show when={others().length}>
      <div class="ui-network-spokes">
        <For each={others()}>{(device) => <div class="ui-network-spoke" data-offline={device.parts.some((part) => part.online) ? undefined : ""}><Device device={device} /></div>}</For>
      </div>
    </Show>
  </figure>;
}
