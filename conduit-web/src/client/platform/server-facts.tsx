import { createSignal, onMount, Show, type JSX } from "solid-js";
import { Fact } from "@/components/ui/overlay";
import { httpUrl } from "../api/transport.js";
import { authorizedFetch } from "../api/native-auth-client.ts";
import { serverBuild, type ServerBuild } from "./build-info.ts";
import { activePath, activeServer, pathsOf, serverPathLabel, type ServerPath } from "./servers.ts";

export const shortBuild = (label: string) => label.replace(/\.\d{14}\.g?/, " · ").replace(/(\b[0-9a-f]{7,})-dev\b/, "$1");

/** `via` is the route to name when it is not the one in use. */
export function ServerFacts(props: { via?: ServerPath; viaLabel?: string; interfaceBuild?: string; children?: JSX.Element }) {
  const [build, setBuild] = createSignal<ServerBuild | null | "pending">("pending");
  onMount(() => void serverBuild(() => authorizedFetch(httpUrl("/healthz"))).then(setBuild));
  const path = () => {
    const entry = activeServer();
    return props.via ?? (entry ? pathsOf(entry).find((item) => item.origin === activePath()) ?? pathsOf(entry)[0] : undefined);
  };
  const release = () => build() === "pending" ? "Asking…" : (build() as ServerBuild | null)?.release || "Unreachable";
  return <>
    <Show when={activeServer()?.name}>{(name) => <Fact label="Server" value={name()} />}</Show>
    <Show when={path()}>{(route) => <Fact label={props.viaLabel ?? "Route"} value={serverPathLabel(route())} title={route().origin} />}</Show>
    <Fact label="Version" value={shortBuild(release()).split(" · ")[0]!} title={release()} />
    <Show when={shortBuild(release()).split(" · ").slice(1).join(" · ")}>{(commit) => <Fact label="Build" value={commit()} title={release()} />}</Show>
    <Show when={props.interfaceBuild && build() !== "pending" && shortBuild(props.interfaceBuild) !== shortBuild(release())}>
      <Fact label="Interface" value={shortBuild(props.interfaceBuild!)} title={props.interfaceBuild} />
    </Show>
    {props.children}
  </>;
}
