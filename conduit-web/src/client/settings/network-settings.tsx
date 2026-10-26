import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { api } from "../api/client.ts";
import { Button, Input, Segmented, Switch } from "@/components/ui/controls";
import { StatusDot } from "@/components/ui/nav";
import { SettingActions, SettingGroup, SettingLine, SettingLink, SettingNote, SettingValue } from "@/components/ui/overlay";

type Certificate = { names: string[]; validTo: string };
/** What the hub says of its LAN names (src/network/lan-names-service.js). */
type LanNames = {
  configured: boolean; domain?: string; via?: "token" | "cf"; tokenSet?: boolean; hubName?: boolean;
  state: "off" | "issuing" | "ready" | "failed"; step?: string; error?: { code: string; message: string };
  certificates: { hub?: Certificate; nodes?: Certificate }; hubAddress: string | null; cf: { installed: boolean; signedIn: boolean };
};

const until = (certificate?: Certificate) => certificate
  ? `until ${new Date(certificate.validTo).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "";
const PATH = "/v0/network/lan-names";

/**
 * The network's own settings, kept by the server it is on (plan: Distributed Conduit). LAN names: an https name on
 * this network for every device (`n-….lan.example.com`, under a name of the user's own on Cloudflare), so a browser
 * tab on an https server reaches a device near it directly, as the apps already do over the sealed LAN routes. The
 * server publishes the names and keeps their certificate itself, with a token scoped to that zone's DNS or, where
 * its machine has one signed in, the `cf` CLI.
 */
export function NetworkSettings() {
  const [shown, setShown] = createSignal<LanNames | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [domain, setDomain] = createSignal("");
  const [via, setVia] = createSignal<"token" | "cf">("token");
  const [token, setToken] = createSignal("");
  const [hubName, setHubName] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = async () => {
    clearTimeout(timer);
    const status = await api<LanNames>(PATH).catch(() => null);
    setShown(status);
    // Followed while it is issuing: a minute or two, most of it waiting for public DNS.
    if (status?.state === "issuing") timer = setTimeout(() => void load(), 2000);
  };
  onMount(() => void load());
  onCleanup(() => clearTimeout(timer));

  const edit = () => {
    const status = shown();
    setDomain(status?.domain || status?.certificates.nodes?.names.find((name) => name.startsWith("*."))?.slice(2) || "");
    setVia(status?.via || (status?.cf.signedIn ? "cf" : "token"));
    setToken("");
    setHubName(status?.hubName ?? Boolean(status?.certificates.hub));
    setError("");
    setEditing(true);
  };
  // A token is kept once given: asked again only when there is none, or it is changing.
  const needsToken = () => via() === "token" && !(shown()?.tokenSet && shown()?.via === "token" && shown()?.domain === domain().trim().toLowerCase());
  const ready = () => Boolean(domain().trim()) && (!needsToken() || Boolean(token().trim()));
  const send = async (body: object) => {
    setBusy(true);
    setError("");
    try {
      setShown(await api<LanNames>(PATH, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      setEditing(false);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The names were not set up.");
    } finally { setBusy(false); }
  };
  const setUp = () => send({ domain: domain().trim(), via: via(), hubName: hubName(), ...(token().trim() ? { token: token().trim() } : {}) });
  const retry = () => { const status = shown(); if (status?.domain) void send({ domain: status.domain, via: status.via, hubName: Boolean(status.hubName) }); };
  const turnOff = async () => {
    setBusy(true);
    try { setShown(await api<LanNames>(PATH, { method: "DELETE" })); } catch (cause) { setError(cause instanceof Error ? cause.message : "The names were not turned off."); } finally { setBusy(false); }
  };

  const wildcard = () => shown()?.certificates.nodes?.names.find((name) => name.startsWith("*.")) || (shown()?.domain ? `*.${shown()!.domain}` : "");
  const state = () => {
    const status = shown();
    if (!status) return "";
    if (status.state === "issuing") return status.step || "Setting up";
    if (status.state === "failed") return "Not set up";
    if (status.configured || status.certificates.nodes) return `${wildcard()}${status.configured ? "" : ", set up by hand"}`;
    return "Off";
  };

  return <Show when={shown()}>{(status) => <SettingGroup title="Network">
    <SettingLine plain label="LAN names" state={state()}
      title="Gives every device an https name on this network, so a browser tab here reaches it directly rather than through this server. Needs a domain on Cloudflare.">
      <Show when={status().state === "issuing"}><StatusDot label="Setting up" spinning /></Show>
      <Show when={status().state !== "issuing" && (status().configured || status().certificates.nodes)}>
        <SettingValue>{until(status().certificates.nodes)}</SettingValue>
        <StatusDot label={status().state === "failed" ? "Failed" : "Ready"} tone={status().state === "failed" ? "danger" : "success"} />
      </Show>
      <Show when={!editing() && status().state !== "issuing"}>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={edit}>{status().configured ? "Change" : status().certificates.nodes ? "Manage here" : "Set up"}</Button>
        <Show when={status().configured}><Button variant="ghost" size="sm" disabled={busy()} onClick={() => void turnOff()}>Turn off</Button></Show>
      </Show>
    </SettingLine>
    <Show when={status().state === "failed" && !editing()}>
      <SettingNote tone="error">{status().error?.message || "The names could not be set up."} <Button variant="ghost" size="sm" disabled={busy()} onClick={retry}>Try again</Button></SettingNote>
    </Show>
    <Show when={!editing() && status().hubName && status().certificates.hub}>
      <SettingLine plain label="This server" state={status().domain}>
        <SettingValue mono>{status().hubAddress || ""}</SettingValue><SettingValue>{until(status().certificates.hub)}</SettingValue>
      </SettingLine>
    </Show>

    <Show when={editing()}>
      <SettingLine label="Name" title="A name below your domain, used only for this: devices get names under it.">
        <Input aria-label="LAN name" placeholder="lan.example.com" spellcheck={false} value={domain()} onInput={(event) => setDomain(event.currentTarget.value)} />
      </SettingLine>
      <Show when={status().cf.signedIn}>
        <SettingLine plain label="Cloudflare access">
          <Segmented label="Cloudflare access" size="sm" value={via()} onChange={setVia}
            options={[{ value: "cf", label: "This server's cf", title: "The cf CLI signed in on this server's machine" }, { value: "token", label: "API token" }]} />
        </SettingLine>
      </Show>
      <Show when={via() === "token"}>
        <SettingLine label="API token" state={needsToken() ? undefined : "kept"}>
          <Input type="password" aria-label="Cloudflare API token" autocomplete="off" placeholder={needsToken() ? "Zone · DNS · Edit" : "Unchanged"} value={token()} onInput={(event) => setToken(event.currentTarget.value)} />
        </SettingLine>
        <SettingNote>In Cloudflare, create a token from the “Edit zone DNS” template for your domain’s zone. It stays on this server. <SettingLink href="https://dash.cloudflare.com/profile/api-tokens">API tokens</SettingLink></SettingNote>
      </Show>
      <Show when={status().hubAddress}>
        <SettingLine label="Name this server too" state={domain().trim() ? `${domain().trim().toLowerCase()} → ${status().hubAddress}` : undefined}
          title="Points the name at this server's address here, so a browser on this network opens it over https.">
          <Switch label="Name this server too" checked={hubName()} onChange={setHubName} />
        </SettingLine>
      </Show>
      <Show when={error()}><SettingNote tone="error">{error()}</SettingNote></Show>
      <SettingActions>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" disabled={busy() || !ready()} onClick={() => void setUp()}>{busy() ? "Checking…" : "Set up"}</Button>
      </SettingActions>
    </Show>
  </SettingGroup>}</Show>;
}
