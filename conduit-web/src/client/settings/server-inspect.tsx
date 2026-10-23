import { createSignal, For, onCleanup, Show } from "solid-js";
import { Icons } from "@/components/ui";
import { buildHttpUrl } from "../api/transport";
import { api } from "../api/client.ts";
import { Button, Input, Switch } from "@/components/ui/controls";
import { SettingLine, SettingNote, SettingValue } from "@/components/ui/overlay";
import { clearNativeBearerToken } from "../api/native-auth-client.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { saveServerDirectory } from "../platform/server-directory.ts";
import {
  activeOrigin, activePath, dialOrigin, forgetServer, learnIdentity, pathIsPinned, pathsOf, serverPathLabel, servers, setServerShared,
  type ServerEntry, type ServerPath,
} from "../platform/servers.ts";

/**
 * What this client can learn of every server it knows, without signing in: each route asked how long it takes and
 * what it runs. `/healthz` needs no session; a browser can only ask its own origin (cross-origin access is granted to
 * the installed shells), so it says nothing about the rest rather than calling them unreachable.
 */
export function createServerHealth() {
  type Health = { ms: number; release: string; startedAt: string } | null;
  const [health, setHealth] = createSignal<Record<string, Health>>({});
  const [now, setNow] = createSignal(Date.now());
  const canProbe = (origin: string) => isInstalledClient() || origin === location.origin;
  const ask = async (origin: string, entry: ServerEntry): Promise<Health> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const started = performance.now();
    try {
      const response = await fetch(buildHttpUrl("/healthz", dialOrigin(origin, entry)), { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({})) as { release?: string; startedAt?: string };
      return { ms: Math.round(performance.now() - started), release: body.release || "", startedAt: body.startedAt || "" };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const probe = async () => {
    const pairs = await Promise.all(servers().flatMap((entry) => pathsOf(entry)
      .filter((path) => canProbe(path.origin))
      .map(async (path) => [path.origin, await ask(path.origin, entry)] as const)));
    setHealth(Object.fromEntries(pairs));
    setNow(Date.now());
  };
  void probe();
  const timer = setInterval(() => void probe(), 10_000);
  onCleanup(() => clearInterval(timer));

  const isActive = (entry: ServerEntry) => entry.origin === activeOrigin();
  const inUse = (entry: ServerEntry, path: ServerPath) => isActive(entry) && path.origin === (activePath() || activeOrigin());
  // What the server says about itself: through the route in use, else the quickest one that answered.
  const of = (entry: ServerEntry) => {
    const answers = pathsOf(entry).map((path) => ({ path, health: health()[path.origin] })).filter((item) => item.health);
    return (answers.find((item) => inUse(entry, item.path)) ?? answers.sort((a, b) => a.health!.ms - b.health!.ms)[0])?.health ?? null;
  };
  const measured = (entry: ServerEntry) => pathsOf(entry).some((path) => path.origin in health());
  const status = (entry: ServerEntry) => {
    const answer = of(entry);
    const where = isActive(entry) ? "In use" : "Not in use";
    if (answer) return `${where} · ${answer.ms}ms`;
    return measured(entry) ? `${where} · Not answering` : where;
  };
  // The switcher's voice: online, offline, or nothing known.
  const connectivity = (entry: ServerEntry) => of(entry) ? "online" : measured(entry) ? "offline" : "unknown";
  const route = (entry: ServerEntry, path: ServerPath) => {
    const answer = health()[path.origin];
    const parts = [inUse(entry, path) ? (pathIsPinned() ? "Pinned · in use" : "In use") : ""];
    if (answer) parts.push(`${answer.ms}ms`);
    else if (path.origin in health()) parts.push("Not answering");
    return parts.filter(Boolean).join(" · ");
  };
  const uptime = (startedAt: string) => {
    const minutes = Math.max(0, Math.round((now() - Date.parse(startedAt)) / 60_000));
    if (minutes < 60) return `up ${minutes}m`;
    if (minutes < 1440) return `up ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `up ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  };
  return { of, status, connectivity, route, uptime, isActive };
}
export type ServerHealth = ReturnType<typeof createServerHealth>;

// A dev build's stamp carries its build time; the version and commit say which.
const shortBuild = (build: string) => build ? build.replace(/\.\d{14}\./, " · ") : "Older build";

/**
 * A server as this client knows it: what it runs, its name (renamed only from a client connected to it), whether it is
 * shared with this account's other clients, its identity, the routes this client reaches it by, and forgetting it.
 *
 * A server is one thing with several ways in: the addresses under it are its routes, not other servers. Forgetting
 * reaches the directory as well as this device (the list is shared through whichever server is in use), and the one
 * in use cannot be forgotten: the client would be signed in to a server it no longer lists.
 */
export function ServerFacts(props: { entry: ServerEntry; health: ServerHealth }) {
  const [renameError, setRenameError] = createSignal("");
  const active = () => props.health.isActive(props.entry);
  const rename = async (name: string) => {
    setRenameError("");
    try {
      const identity = await api<{ id?: string; name?: string; publicKey?: string; paths?: unknown }>("/v0/server/name", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
      });
      learnIdentity(props.entry.origin, identity);
      await saveServerDirectory();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "The server did not take that name.");
    }
  };
  const share = async (shared: boolean) => { setServerShared(props.entry.origin, shared); await saveServerDirectory(); };
  const forget = async () => {
    forgetServer(props.entry.origin);
    await saveServerDirectory();
    // The token outlives the address unless it is dropped with it.
    if (isInstalledClient()) await clearNativeBearerToken(props.entry.origin);
  };
  return <>
    <Show when={props.health.of(props.entry)}>{(answer) =>
      <SettingLine label="Runs" plain><SettingValue mono>{shortBuild(answer().release)}{answer().startedAt ? ` · ${props.health.uptime(answer().startedAt)}` : ""}</SettingValue></SettingLine>}</Show>
    <Show when={active()} fallback={
      <SettingLine label="Name" title="A server is renamed from a client connected to it." plain><SettingValue>{props.entry.name}</SettingValue></SettingLine>}>
      <SettingLine label="Name" title="The server's name, for every client and on the network.">
        <Input aria-label={`Name of ${props.entry.name}`} value={props.entry.name} onChange={(event) => void rename(event.currentTarget.value)} />
      </SettingLine>
      <Show when={renameError()}><SettingNote tone="error">{renameError()}</SettingNote></Show>
    </Show>
    <SettingLine label="Share with other clients">
      <Switch label={`Share ${props.entry.name} with other clients`} checked={props.entry.shared} onChange={(shared) => void share(shared)} />
    </SettingLine>
    <Show when={props.entry.id}>
      <SettingLine label="Identity" title={`The server's identity key, which vouches for its TLS certificate.${props.entry.publicKey ? `\n${props.entry.publicKey}` : ""}`} plain>
        <SettingValue mono>{props.entry.id?.slice(0, 8)}{props.entry.tls ? " · TLS verified" : ""}</SettingValue>
      </SettingLine>
    </Show>
    {/* How this client reaches it; chosen in the server switcher, which proves the identity first. */}
    <For each={pathsOf(props.entry)}>{(path) => <SettingLine label={serverPathLabel(path)} state={path.origin.replace(/^https?:\/\//, "")} plain>
      <SettingValue>{props.health.route(props.entry, path)}</SettingValue>
    </SettingLine>}</For>
    <Show when={!active()}>
      <SettingLine label="" plain>
        <Button variant="ghost" size="sm" aria-label={`Forget ${props.entry.name}`} onClick={() => void forget()}><Icons.Delete /> Forget</Button>
      </SettingLine>
    </Show>
  </>;
}
