import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { MailAccount, MailReach, MailSync } from "@/mail/mail";
import { Button, Input, Segmented, Switch } from "@/components/ui/controls";
import { SettingLine, SettingStep } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { Icons } from "@/components/ui";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { sizeLabel } from "../chat/attachments";
import { failure, mailApi } from "../mail/mail-api";

const TABS = [{ value: "promotions", label: "Promotions" }, { value: "social", label: "Social" }, { value: "updates", label: "Updates" }, { value: "forums", label: "Forums" }];
const SINCE = [{ value: "365", label: "1 year" }, { value: "1095", label: "3 years" }, { value: "1825", label: "5 years" }, { value: "all", label: "All" }];
const BODIES = [{ value: "30", label: "1 month" }, { value: "90", label: "3 months" }, { value: "365", label: "1 year" }, { value: "all", label: "All" }];
const reachOf = (value: string): MailReach => value === "all" ? "all" : Number(value);
const further = (a: MailReach, b: MailReach) => a === "all" ? b !== "all" : b !== "all" && a > b;
const count = (n: number) => n.toLocaleString();
const ago = (at?: string) => {
  if (!at) return "";
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
  return minutes < 2 ? "heard just now" : minutes < 60 ? `heard ${minutes} min ago` : minutes < 48 * 60 ? `heard ${Math.round(minutes / 60)} h ago` : `heard ${Math.round(minutes / 1440)} days ago`;
};

const stateOf = (account: MailAccount) => {
  const { state, error, backfill, at } = account.status;
  if (account.sync.paused) return "Paused";
  if (state === "error") return error || "Not working";
  const said = backfill ? `Reading in older mail · ${count(backfill.done)} of ${count(backfill.total)}`
    : { off: "Off", connecting: "Connecting…", syncing: "Syncing", idle: "Up to date" }[state];
  return [said, ago(at)].filter(Boolean).join(" · ");
};
const heldOf = ({ held, kind }: MailAccount) => [
  `${count(held.messages)} messages`, `${count(held.bodies)} with text`, sizeLabel(held.bytes),
  held.oldest && `back to ${new Date(held.oldest).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`,
  held.total !== undefined && `of ${count(held.total)} in ${kind === "gmail" ? "Gmail" : "the source"}`,
].filter(Boolean).join(" · ");

/** Mail accounts the hub reads for you: how each stands and what it holds, how far back it reads, and a form to add one. */
export function MailSettings() {
  const [accounts, setAccounts] = createSignal<MailAccount[] | null>(null);
  const [error, setError] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [name, setName] = createSignal("");
  const [refused, setRefused] = createSignal("");
  const [busy, setBusy] = createSignal("");
  const { confirm } = createDecisionScope(() => "mail-settings");
  const load = () => mailApi.accounts().then((found) => { setAccounts(found); setError(""); }).catch((reason) => setError(failure(reason)));
  onMount(() => void load());
  // Sync and errors move on their own: the hub says when.
  const heard = (event: Event) => { if ((event as CustomEvent<{ accounts?: true }>).detail?.accounts) void load(); };
  window.addEventListener("conduit:mail-changed", heard);
  onCleanup(() => window.removeEventListener("conduit:mail-changed", heard));

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id);
    try { await run(); await load(); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(""); }
  };
  const connect = async () => {
    setBusy("add"); setRefused("");
    try {
      await mailApi.addAccount({ kind: "gmail", address: address().trim(), secret: secret().replace(/\s+/g, ""), name: name().trim() || undefined });
      setAddress(""); setSecret(""); setName("");
      await load();
    } catch (reason) { setRefused(failure(reason)); }
    finally { setBusy(""); }
  };
  const update = (account: MailAccount, sync: Partial<MailSync>) => act(account.id, () => mailApi.updateAccount(account.id, { sync }));
  const resync = async (account: MailAccount) => {
    if (!await confirm(`Read ${account.address} in again? The hub's copy is dropped and read again from Gmail; nothing there changes.`, { confirmLabel: "Read in again" })) return;
    await act(account.id, () => mailApi.resync(account.id));
  };
  const remove = async (account: MailAccount) => {
    if (!await confirm(`Remove ${account.address}? The hub's copy of its mail goes with it.`, { confirmLabel: "Remove", destructive: true })) return;
    await act(account.id, () => mailApi.removeAccount(account.id));
  };
  const ready = () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address().trim()) && secret().trim().length > 0;

  return <>
    <For each={accounts()}>{(account) => <Group title={account.address}>
      <SettingLine plain label="Sync" title={account.name || undefined} state={stateOf(account)}>
        <Button variant="ghost" size="sm" disabled={busy() === account.id} onClick={() => void update(account, { paused: !account.sync.paused })}>{account.sync.paused ? "Resume" : "Pause"}</Button>
        <Button variant="ghost" size="icon-sm" haptic="destructive" aria-label={`Remove ${account.address}`} title="Remove" disabled={busy() === account.id} onClick={() => void remove(account)}><Icons.Delete /></Button>
      </SettingLine>
      <SettingLine plain label="Held" state={heldOf(account)}>
        <Button variant="ghost" size="icon-sm" aria-label={`Read ${account.address} in again`} title="Read in again" disabled={busy() === account.id} onClick={() => void resync(account)}><Icons.Refresh /></Button>
      </SettingLine>
      <SettingLine plain label="Keep mail from">
        <Segmented label="Keep mail from" size="sm" value={String(account.sync.since)} options={SINCE} disabled={busy() === account.id}
          onChange={(value) => void update(account, { since: reachOf(value) })} />
      </SettingLine>
      <SettingLine plain label="Keep text of">
        <Segmented label="Keep text of" size="sm" value={String(account.sync.bodies)} disabled={busy() === account.id}
          options={BODIES.map((option) => ({ ...option, disabled: further(reachOf(option.value), account.sync.since) }))}
          onChange={(value) => void update(account, { bodies: reachOf(value) })} />
      </SettingLine>
      <For each={TABS}>{(tab) => <SettingLine label={`${tab.label} tab`} title={`Off, ${tab.label.toLowerCase()} mail shows in Primary, as in Gmail with that tab off`}>
        <Switch label={`${tab.label} tab`} checked={account.sync.tabs.includes(tab.value)} disabled={busy() === account.id}
          onChange={(on) => void update(account, { tabs: on ? [...account.sync.tabs, tab.value] : account.sync.tabs.filter((one) => one !== tab.value) })} />
      </SettingLine>}</For>
    </Group>}</For>
    <Group title="Add a Gmail account">
      <Note>Gmail signs Conduit in with an app password: 16 letters Google makes for one app, in place of your own password.</Note>
      <SettingStep step={1} label="Turn on 2-Step Verification"><Button variant="secondary" size="sm" onClick={() => window.open("https://myaccount.google.com/signinoptions/twosv", "_blank", "noopener,noreferrer")}><Icons.ExternalLink />Open Google</Button></SettingStep>
      <SettingStep step={2} label="Create an app password"><Button variant="secondary" size="sm" onClick={() => window.open("https://myaccount.google.com/apppasswords", "_blank", "noopener,noreferrer")}><Icons.ExternalLink />Open Google</Button></SettingStep>
      <SettingStep step={3} label="Paste it here with your address" />
      <SettingLine label="Address">
        <Input id="mail-address" type="email" autocomplete="off" placeholder="you@gmail.com" value={address()} onInput={(event) => setAddress(event.currentTarget.value)} />
      </SettingLine>
      <SettingLine label="App password">
        <Input id="mail-secret" type="password" autocomplete="off" placeholder="xxxx xxxx xxxx xxxx" value={secret()} onInput={(event) => { setSecret(event.currentTarget.value); setRefused(""); }} />
      </SettingLine>
      <Show when={refused()}><Note tone="error">{refused()}</Note></Show>
      <SettingLine label="Name" state="Optional">
        <Input id="mail-name" type="text" autocomplete="off" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      </SettingLine>
      <SettingLine plain label="">
        <Button size="sm" variant="primary" outline disabled={!ready() || busy() === "add"} onClick={() => void connect()}>{busy() === "add" ? "Connecting…" : "Connect"}</Button>
      </SettingLine>
    </Group>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </>;
}
