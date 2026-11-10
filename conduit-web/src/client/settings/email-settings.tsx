import { createSignal, For, Show } from "solid-js";
import { Button, Input, Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { Icons } from "@/components/ui";
import { api } from "../api/client";
import { httpUrl } from "../api/transport.js";

/**
 * Settings › jbot › Email: jbot's own address (agent/email.js, agent/email-setup.js). Conduit sets the mailbox up in the
 * person's Cloudflare account from one token they make for it (GET/POST/PATCH/DELETE /v0/agent/email): a Worker that
 * keeps mail in R2 until the hub collects it, and an Email Routing rule sending the address to it. Running setup again
 * for an address another hub has moves it here. The token is used for that request and never kept.
 */

type Step = { id: string; label: string; ok: boolean; detail?: string };
type EmailView = {
  configured: boolean; address?: string; worker?: string; person: string[]; allow: string[]; send: boolean;
  lastCollectedAt?: string | null; lastError?: string | null; tokenUrl?: string; permissions?: string[];
  setup?: { domain: string; script: string } | null;
};

const list = (text: string) => text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
const when = (at?: string | null) => at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

export function EmailSettings(props: { name: string }) {
  const [view, setView] = createSignal<EmailView | null>(null);
  const [error, setError] = createSignal("");
  // The setup form: shown when there is no mailbox, or to move or repair one.
  const [form, setForm] = createSignal(false);
  const [token, setToken] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [person, setPerson] = createSignal("");
  const [allow, setAllow] = createSignal("");
  const [busy, setBusy] = createSignal<"" | "setup" | "check" | "remove" | "save">("");
  const [steps, setSteps] = createSignal<Step[]>([]);
  const [removing, setRemoving] = createSignal(false);

  const show = (next: EmailView) => {
    setView(next);
    setPerson(next.person.join(", "));
    setAllow(next.allow.join(", "));
    if (next.address) setAddress(next.address);
  };
  void api<EmailView>("/v0/agent/email").then(show).catch((failure) => setError((failure as Error).message));

  // A failed step comes back as 400 with the steps so far, which api() puts on the error it throws.
  const run = async (method: "POST" | "DELETE", path: string, body: object) => {
    setError(""); setSteps([]);
    let answer: { steps?: Step[]; email?: EmailView; message?: string };
    let ok = true;
    try { answer = await api(path, { method, body: JSON.stringify(body) }); }
    catch (failure) { answer = failure as typeof answer; ok = false; }
    setSteps(answer.steps ?? []);
    if (answer.email) show(answer.email);
    if (!ok && !answer.steps?.length) setError(answer.message || "Setup failed.");
    return ok;
  };
  const setup = async () => {
    setBusy("setup");
    try {
      const ok = await run("POST", "/v0/agent/email/setup", { token: token().trim(), address: address().trim(), person: list(person()), hubUrl: new URL(httpUrl("/"), location.href).origin });
      if (ok) { setToken(""); setForm(false); }
    } finally { setBusy(""); }
  };
  const remove = async () => {
    setBusy("remove");
    try { if (await run("DELETE", "/v0/agent/email", { token: token().trim() })) { setToken(""); setRemoving(false); } }
    finally { setBusy(""); }
  };
  const check = async () => {
    setBusy("check"); setError("");
    try { show(await api<EmailView>("/v0/agent/email/check", { method: "POST", body: "{}", timeout: false })); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(""); }
  };
  const save = async (patch: Partial<Pick<EmailView, "person" | "allow" | "send">>) => {
    setBusy("save"); setError("");
    try { show(await api<EmailView>("/v0/agent/email", { method: "PATCH", body: JSON.stringify(patch) })); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(""); }
  };

  const ready = () => token().trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address().trim()) && list(person()).length > 0;

  // Step one and two of the form: the token, made in Cloudflare with only what the mailbox needs.
  const TokenLines = () => <>
    <SettingLine plain label="A Cloudflare token">
      <Button size="sm" variant="secondary" onClick={() => window.open(view()?.tokenUrl, "_blank", "noopener,noreferrer")}><Icons.ExternalLink />Create in Cloudflare</Button>
    </SettingLine>
    <Note>
      It needs only {(view()?.permissions ?? []).join(", ") || "Workers, R2 and Email Routing"}. In Cloudflare, limit it to this account and the
      address's domain, give it an expiry, and filter it to this hub's IP address if you can. Conduit uses the token once and doesn't keep it.
    </Note>
    <SettingLine label="Token">
      <Input id="agent-email-token" type="password" autocomplete="off" placeholder="Paste the token" value={token()} onInput={(event) => setToken(event.currentTarget.value)} />
    </SettingLine>
  </>;

  return <Group title="Email">
    <Show when={view()} fallback={<Show when={error()}><Note tone="error">{error()}</Note></Show>}>{(current) => <>
      <Show when={current().configured && !form()} fallback={<>
        <Note>
          Give {props.name} its own address. Mail from you, and from senders you allow, wakes it; anyone else's goes to its inbox for the
          heartbeat to weigh. Conduit sets the mailbox up in your Cloudflare account; the address's domain needs Email Routing turned on.
          {current().configured ? " Running setup again repairs the mailbox; for an address another hub has, it moves it here." : ""}
        </Note>
        <TokenLines />
        <SettingLine label="Address">
          <Input id="agent-email-address" type="email" placeholder={`${props.name.toLowerCase()}@yourdomain.com`} value={address()} onInput={(event) => setAddress(event.currentTarget.value)} />
        </SettingLine>
        <SettingLine label="Your addresses" title="Mail from these wakes it, and its replies go to them. Cloudflare emails each one a link to confirm before replies can reach it.">
          <Input id="agent-email-person" type="text" placeholder="you@example.com, …" value={person()} onInput={(event) => setPerson(event.currentTarget.value)} />
        </SettingLine>
        <SettingLine label={current().configured ? "Set up again" : "Set up"}>
          <Show when={current().configured}><Button size="sm" variant="secondary" disabled={!!busy()} onClick={() => { setForm(false); setToken(""); setSteps([]); }}>Cancel</Button></Show>
          <Button size="sm" disabled={!ready() || !!busy()} onClick={() => void setup()}>{busy() === "setup" ? "Setting up…" : "Set up"}</Button>
        </SettingLine>
      </>}>
        <SettingLine label="Address" state={current().lastError || (current().lastCollectedAt ? `Collected ${when(current().lastCollectedAt)}` : "Waiting for its first collection")}>
          <span data-mono="">{current().address}</span>
          <Button size="sm" variant="secondary" disabled={!!busy()} onClick={() => void check()}>{busy() === "check" ? "Checking…" : "Check now"}</Button>
        </SettingLine>
        <SettingLine label="Your addresses" title="Mail from these wakes it, and its replies go to them. A new one gets Cloudflare's confirmation link when you run setup again.">
          <Input id="agent-email-person" type="text" value={person()} onInput={(event) => setPerson(event.currentTarget.value)}
            onChange={() => { if (list(person()).length && list(person()).join() !== current().person.join()) void save({ person: list(person()) }); }} />
        </SettingLine>
        <SettingLine label="Others who may wake it" title="Addresses, or @domain for a whole domain. Anyone else's mail is filed in its inbox without a turn.">
          <Input id="agent-email-allow" type="text" placeholder="name@example.com, @example.com" value={allow()} onInput={(event) => setAllow(event.currentTarget.value)}
            onChange={() => { if (list(allow()).join() !== current().allow.join()) void save({ allow: list(allow()) }); }} />
        </SettingLine>
        <SettingLine label="Replies by email" title="Its answers to your email go out as email, threaded. Off: it answers in the app.">
          <Switch label="Replies by email" checked={current().send} onChange={(send) => void save({ send })} />
        </SettingLine>
        <SettingLine label="Mailbox" title="Set up again to repair it. Remove takes the address away; mail already collected stays.">
          <Button size="sm" variant="secondary" disabled={!!busy()} onClick={() => { setRemoving(false); setSteps([]); setForm(true); }}>Set up again</Button>
          <Button size="sm" variant="destructive" outline disabled={!!busy()} onClick={() => { setForm(false); setSteps([]); setRemoving(true); }}>Remove</Button>
        </SettingLine>
        <Show when={removing()}>
          <TokenLines />
          <SettingLine label={`Remove ${current().address}`}>
            <Button size="sm" variant="secondary" disabled={!!busy()} onClick={() => { setRemoving(false); setToken(""); }}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={!token().trim() || !!busy()} onClick={() => void remove()}>{busy() === "remove" ? "Removing…" : "Remove"}</Button>
          </SettingLine>
        </Show>
      </Show>
      <For each={steps()}>{(step) =>
        <SettingLine plain label={step.label} state={step.detail}>{step.ok ? <Icons.Check /> : <Icons.Warning />}</SettingLine>}</For>
      <Show when={error()}><Note tone="error">{error()}</Note></Show>
    </>}</Show>
  </Group>;
}
