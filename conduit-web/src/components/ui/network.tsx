import { For, Show, type JSX } from "solid-js";
import * as Icons from "./icons";
import { NavRow, StatusDot } from "./nav";

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

type Picking = { current?: string; onPick?: (id: string) => void };

/** A device's outline, its parts as rows: the sidebar's grammar, picked to show what it holds. */
function Device(props: { device: NetworkDevice } & Picking) {
  return <section class="ui-network-device" aria-label={props.device.name}>
    <h4 class="ui-title">{props.device.name}</h4>
    <ul>
      <For each={props.device.parts}>{(part) => <li class="ui-network-part" data-offline={part.online ? undefined : ""}>
        <NavRow icon={mark(part)} current={part.id === props.current} meta={part.meta} onClick={() => props.onPick?.(part.id)}
          end={<StatusDot label={part.online ? "Connected" : "Offline"} tone={part.online ? "success" : "muted"} />}>
          {part.name}<Show when={part.head}><span class="ui-network-head">head</span></Show>
        </NavRow>
      </li>}</For>
    </ul>
  </section>;
}

/**
 * The network as it stands: the device holding the head, its environments and clients, and every other device hung
 * from it by a line (dashed while nothing on it is connected). Every device talks to the head, never to another
 * device, so the head's device is the root and the rest are its spokes.
 */
export function NetworkMap(props: { devices: NetworkDevice[]; label?: string } & Picking) {
  const head = () => props.devices.find((device) => device.parts.some((part) => part.head)) ?? props.devices[0];
  const others = () => props.devices.filter((device) => device.id !== head()?.id);
  return <figure class="ui-network" aria-label={props.label ?? "Network"}>
    <Show when={head()}>{(device) => <Device device={device()} current={props.current} onPick={props.onPick} />}</Show>
    <Show when={others().length}>
      <div class="ui-network-spokes">
        <For each={others()}>{(device) => <div class="ui-network-spoke" data-offline={device.parts.some((part) => part.online) ? undefined : ""}><Device device={device} current={props.current} onPick={props.onPick} /></div>}</For>
      </div>
    </Show>
  </figure>;
}
