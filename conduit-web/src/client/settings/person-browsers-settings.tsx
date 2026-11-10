import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { api } from "../api/client.ts";
import type { PersonBrowserEnvironment, PersonBrowsersPayload } from "../api/contracts";
import { Button } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/nav";
import { LiveNote, SettingLine, SettingLink, SettingValue } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";

/**
 * The person's own browsers on the network (Settings › Devices): each environment that can offer one, the browsers
 * paired there, and pairing another -- the hub gives a one-time code, entered in the browse extension of the browser
 * on that environment. Agents then drive that browser with conduit_browser (server/person-browser-tool.js).
 */
export function PersonBrowsersSettings() {
  const [environments, setEnvironments] = createSignal<PersonBrowserEnvironment[] | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal("");
  const [said, setSaid] = createSignal("");
  let timer: number | undefined;
  const count = (list: PersonBrowserEnvironment[] | null) => (list || []).reduce((sum, item) => sum + item.browsers.length, 0);
  const read = async () => {
    try {
      const before = environments();
      const next = (await api<PersonBrowsersPayload>("/v0/person-browsers")).environments;
      if (before?.some((item) => item.pairing) && count(next) > count(before)) setSaid("Browser connected");
      setEnvironments(next);
      // A code is out: watch for the browser that redeems it.
      window.clearTimeout(timer);
      if (next.some((item) => item.pairing)) timer = window.setTimeout(() => void read(), 2000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The browsers could not be read."); }
  };
  onMount(() => void read());
  onCleanup(() => window.clearTimeout(timer));
  const act = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true); setError(""); setSaid("");
    try { await work(); await read(); } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); } finally { setBusy(false); }
  };
  const pair = (environment: PersonBrowserEnvironment) => act(() => api(`/v0/person-browsers/${encodeURIComponent(environment.id)}/pair`, { method: "POST" }), "No pairing code was given.");
  const unpair = (environment: PersonBrowserEnvironment, browser: string) => act(() =>
    api(`/v0/person-browsers/${encodeURIComponent(environment.id)}/browsers/${encodeURIComponent(browser)}`, { method: "DELETE" }), "The browser was not unpaired.");
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(code); setCopied(code); } catch { setCopied(""); } };

  return <Group title="Your browsers">
    <Note>Agents can work in your own signed-in browser on a device, through the browse extension (OpenCode Browse). A sign-in, a code or a CAPTCHA is handed back to you there.</Note>
    <Show when={environments()} fallback={<Show when={!error()}><Note>Loading…</Note></Show>}>{(list) =>
      <Show when={list().length} fallback={<Note>No device on this network can offer a browser yet: it needs a folder shared with commands.</Note>}>
        <For each={list()}>{(environment) => <>
          <For each={environment.browsers}>{(browser) =>
            <SettingLine label={browser.name} state={environment.name}>
              <StatusDot label={browser.connected ? "Connected" : "Not running"} tone={browser.connected ? "success" : "muted"} />
              <Button variant="ghost" size="sm" disabled={busy()} aria-label={`Unpair ${browser.name}`} onClick={() => void unpair(environment, browser.id)}>Unpair</Button>
            </SettingLine>}</For>
          <Show when={environment.pairing} fallback={
            <SettingLine label={environment.browsers.length ? "Connect another browser" : "Connect a browser"} state={environment.name}
              title={`Pairs a Chrome, Edge, Brave or other Chromium browser on ${environment.name} with Conduit.`}>
              <Show when={environment.available} fallback={<StatusDot label={environment.error || "Not available"} tone="muted" />}>
                <Button variant="ghost" size="sm" disabled={busy() || !environment.online} onClick={() => void pair(environment)}><Icons.Add /> Connect</Button>
              </Show>
            </SettingLine>}>{(pairing) => <>
            <SettingLine label={<SettingValue mono>{pairing().code}</SettingValue>} state={environment.name}>
              <SettingLink href={environment.extensionUrl}>Get the extension</SettingLink>
              <Button variant="ghost" size="sm" onClick={() => void copy(pairing().code)}><Icons.Copy /> Copy code</Button>
            </SettingLine>
            <Note>In the browser on {environment.name}: add the browse extension, open its Options, choose “Pair with a code” and enter this code. It works once, until {new Date(pairing().expiresAt).toLocaleTimeString(undefined, { timeStyle: "short" })}.</Note>
            <Show when={copied() === pairing().code}><LiveNote>Copied</LiveNote></Show>
          </>}</Show>
        </>}</For>
      </Show>}</Show>
    <Show when={said()}><LiveNote>{said()}</LiveNote></Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Group>;
}
