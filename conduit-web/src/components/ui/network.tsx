import { For, Show, type JSX } from "solid-js";
import * as Icons from "./icons";
import { Dot, StatusDot } from "./nav";
import { Row } from "./row";
import { Empty } from "./state";

export type NetworkClient = {
  id: string;
  name: string;
  headed?: "desktop" | "phone" | "browser";
  meta?: string;
  online: boolean;
};
export type NetworkDevice = { id: string; name: string; clients: NetworkClient[] };
export type NetworkHub = { name: string; device?: string; meta?: string };

export const clientMark = (client: NetworkClient): JSX.Element => client.headed === "phone" ? <Icons.Phone />
  : client.headed === "browser" ? <Icons.Browser /> : client.headed ? <Icons.Monitor /> : <Icons.Shell />;

function Line(props: { icon: JSX.Element; name: string; meta?: string; online: boolean }) {
  return <li><Row density="line" class="ui-network-line" data-offline={props.online ? undefined : ""} lead={<span class="ui-network-mark" aria-hidden="true">{props.icon}</span>}
    label={props.name} context={props.meta} end={<StatusDot label={props.online ? "Connected" : "Offline"} tone={props.online ? "success" : "muted"} />} /></li>;
}

/** Clients talk only to the hub, so the hub is the root and devices its spokes. */
export function NetworkMap(props: { hub: NetworkHub; devices: NetworkDevice[]; label?: string }) {
  return <figure class="ui-network" aria-label={props.label ?? "Network"}>
    <section class="ui-outline ui-network-box" data-hub="" data-titled={props.hub.device ? "" : undefined} aria-label={props.hub.name}>
      <Show when={props.hub.device}><h4 class="ui-title">{props.hub.device}</h4></Show>
      <ul><Line icon={<Icons.Server />} name={props.hub.name} meta={props.hub.meta} online /></ul>
    </section>
    <Show when={props.devices.length}>
      <div class="ui-network-spokes">
        <For each={props.devices}>{(device) => <div class="ui-network-spoke" data-offline={device.clients.some((client) => client.online) ? undefined : ""}>
          <section class="ui-outline ui-network-box" data-titled="" aria-label={device.name}>
            <h4 class="ui-title">{device.name}</h4>
            <ul><For each={device.clients}>{(client) => <Line icon={clientMark(client)} name={client.name} meta={client.meta} online={client.online} />}</For></ul>
          </section>
        </div>}</For>
      </div>
    </Show>
  </figure>;
}

export const ClientCards = (props: { label?: string; children: JSX.Element }) => <div class="ui-client-cards" role="list" aria-label={props.label}>{props.children}</div>;

export function ClientCard(props: { client: NetworkClient; status: string; mark?: JSX.Element; places?: JSX.Element; actions?: JSX.Element }) {
  return <section class="ui-outline ui-client-card" role="listitem" aria-label={props.client.name} data-offline={props.client.online ? undefined : ""}>
    <header class="ui-client-head">
      <span class="ui-client-mark" aria-hidden="true">{props.mark ?? clientMark(props.client)}</span>
      <h4>{props.client.name}</h4>
      <StatusDot label={props.client.online ? "Connected" : "Offline"} tone={props.client.online ? "success" : "muted"} />
    </header>
    <p class="ui-client-status ui-truncate">{[props.status, props.client.meta].filter(Boolean).join(" · ")}</p>
    <Show when={props.places}><div class="ui-client-places">{props.places}</div></Show>
    <Show when={props.actions}><footer class="ui-client-actions">{props.actions}</footer></Show>
  </section>;
}


export function ClientPlaces(props: { label?: string; none?: boolean; empty?: string; children?: JSX.Element }) {
  return <>
    <h5>{props.label ?? "Workspaces"}</h5>
    <Show when={!props.none} fallback={<Empty kind="client">{props.empty ?? "None mounted"}</Empty>}>{props.children}</Show>
  </>;
}


export const ChainMap = (props: { label: string; children: JSX.Element }) => <figure class="ui-chain" aria-label={props.label}>{props.children}</figure>;
export function ChainLink(props: { name: string; index?: number; meta?: string; size?: string; live?: boolean; notice?: boolean; modified?: boolean; current?: boolean; onSelect?: () => void }) {
  const parts = () => ({
    lead: props.index != null || props.notice ? <>
      <Show when={props.index != null}><span class="ui-chain-index" aria-hidden="true">{props.index}</span></Show>
      <Show when={props.notice}><span class="ui-chain-mark" aria-hidden="true"><Icons.ArrowDownLeft /></span></Show>
    </> : undefined,
    label: <>{props.name}<Show when={props.modified}><Dot tone="unread" class="ui-chain-modified" title="Changed from the default" aria-label="changed" /></Show></>,
    context: props.meta, meta: props.size,
  });
  return <section class="ui-outline ui-network-box ui-chain-box ui-chain-link" data-live={props.live ? "" : undefined} data-notice={props.notice ? "" : undefined} data-current={props.current ? "" : undefined} aria-label={props.name}>
    <Show when={props.onSelect} fallback={<Row density="line" class="ui-chain-line" {...parts()} />}>
      <Row element="button" density="line" class="ui-chain-line ui-chain-open" aria-pressed={Boolean(props.current)} onClick={() => props.onSelect?.()} {...parts()} />
    </Show>
  </section>;
}
export const ChainGap = () => <div class="ui-chain-gap" aria-hidden="true" />;
export const ChainBreak = (props: { label: string }) => <div class="ui-chain-break"><span class="ui-title">{props.label}</span></div>;
