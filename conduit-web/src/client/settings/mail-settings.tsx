import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { MailAccount } from "@/mail/mail";
import { Button, Input } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { Icons } from "@/components/ui";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { failure, mailApi } from "../mail/mail-api";

const stateOf = (account: MailAccount) => {
  const { state, error, backfill } = account.status;
  if (state === "error") return error || "Not working";
  if (backfill) return `Reading in older mail · ${backfill.done.toLocaleString()} of ${backfill.total.toLocaleString()}`;
  return { off: "Off", connecting: "Connecting…", syncing: "Syncing", idle: "Up to date" }[state];
};

/** Mail accounts the hub reads for you: each with how it stands, Remove behind a confirm, and a form to add one. */
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

  const connect = async () => {
    setBusy("add"); setRefused("");
    try {
      await mailApi.addAccount({ kind: "gmail", address: address().trim(), secret: secret().replace(/\s+/g, ""), name: name().trim() || undefined });
      setAddress(""); setSecret(""); setName("");
      await load();
    } catch (reason) { setRefused(failure(reason)); }
    finally { setBusy(""); }
  };
  const remove = async (account: MailAccount) => {
    if (!await confirm(`Remove ${account.address}? The hub's copy of its mail goes with it.`, { confirmLabel: "Remove", destructive: true })) return;
    setBusy(account.id);
    try { await mailApi.removeAccount(account.id); await load(); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(""); }
  };
  const ready = () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address().trim()) && secret().trim().length > 0;

  return <>
    <Show when={accounts()?.length}><Group title="Accounts">
      <For each={accounts()}>{(account) => <SettingLine label={account.address} title={account.name || undefined} state={stateOf(account)}>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${account.address}`} title="Remove" disabled={busy() === account.id} onClick={() => void remove(account)}><Icons.Delete /></Button>
      </SettingLine>}</For>
    </Group></Show>
    <Group title="Add a Gmail account">
      <Note>The password is a Google app password, made at myaccount.google.com/apppasswords once 2-Step Verification is on for the account.</Note>
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
