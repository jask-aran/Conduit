import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { api } from "../api/client.ts";
import type { PersonBrowserEnvironment, PersonBrowsersPayload } from "../api/contracts";
import { Button } from "@/components/ui/controls";
import { COPY_FEEDBACK_MS } from "@/components/ui/motion";
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
export function PersonBrowsersSettings(props: {
  /** Only this device's environments (Settings › This device); not said: every environment on the network. */
  device?: string }) {
  const [environments, setEnvironments] = createSignal<PersonBrowserEnvironment[] | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal("");
  const [said, setSaid] = createSignal("");
  let timer: number | undefined;
  // A read out when the page closes must not arm the follow again.
  let disposed = false;
  const count = (list: PersonBrowserEnvironment[] | null) => (list || []).reduce((sum, item) => sum + item.browsers.length, 0);
  const read = async () => {
    try {
      const before = environments();
      const all = (await api<PersonBrowsersPayload>("/v0/person-browsers")).environments;
      // An environment is named after its device ("Desktop · Ubuntu").
      const next = props.device === undefined ? all : all.filter((item) => item.name === props.device || item.name.startsWith(`${props.device} · `));
      if (before?.some((item) => item.pairing) && count(next) > count(before)) setSaid("Browser connected");
      setEnvironments(next);
      // A code is out: watch for the browser that redeems it.
      window.clearTimeout(timer);
      if (!disposed && next.some((item) => item.pairing)) timer = window.setTimeout(() => void read(), 2000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The browsers could not be read."); }
  };
  onMount(() => void read());
  onCleanup(() => { disposed = true; window.clearTimeout(timer); window.clearTimeout(copiedTimer); });
  const act = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true); setError(""); setSaid("");
    try { await work(); await read(); } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); } finally { setBusy(false); }
  };
  const pair = (environment: PersonBrowserEnvironment) => act(() => api(`/v0/person-browsers/${encodeURIComponent(environment.id)}/pair`, { method: "POST" }), "No pairing code was given.");
  const unpair = (environment: PersonBrowserEnvironment, browser: string) => act(() =>
    api(`/v0/person-browsers/${encodeURIComponent(environment.id)}/browsers/${encodeURIComponent(browser)}`, { method: "DELETE" }), "The browser was not unpaired.");
  // Which code was just copied, for as long as any copy says so: it used to say so until the next one.
  let copiedTimer = 0;
  // Where a browser is paired: on This device its environment alone ("through Ubuntu": the one that carries the
  // agent's commands to it, which need not be the one the browser runs on); on the network, the whole name.
  const through = (environment: PersonBrowserEnvironment) => props.device !== undefined && environment.name.startsWith(`${props.device} · `)
    ? `through ${environment.name.slice(props.device.length + 3)}` : environment.name;
  const launch = (environment: PersonBrowserEnvironment) => act(async () => {
    const { launched } = await api<{ launched: string }>(`/v0/person-browsers/${encodeURIComponent(environment.id)}/launch`, { method: "POST" });
    setSaid(`Started ${launched}`);
  }, "The browser was not started.");
  const copy = async (code: string) => {
    window.clearTimeout(copiedTimer);
    try { await navigator.clipboard.writeText(code); setCopied(code); copiedTimer = window.setTimeout(() => setCopied(""), COPY_FEEDBACK_MS); } catch { setCopied(""); }
  };

  return <Group title={props.device === undefined ? "Your browsers" : "Your browser"}>
    <Note>Agents can work in your signed-in browser on a device, through the OpenCode Browse extension installed in it. Each thread asks first.</Note>
    <Show when={environments()} fallback={<Show when={!error()}><Note>Loading…</Note></Show>}>{(list) =>
      <Show when={list().length} fallback={<Note>{props.device === undefined ? "No device on this network can offer a browser yet" : "This device cannot offer a browser yet"}: it needs a folder shared with commands.</Note>}>
        <For each={list()}>{(environment) => <>
          {/* Its relay did not start: nothing can pair or connect until it does. Port 19988 is the one it listens on. */}
          <Show when={environment.available && environment.relay === false}>
            <Note tone="error">OpenCode Browse could not start on {environment.name}: port 19988 is taken there. On a computer running WSL, restarting WSL frees it.</Note>
          </Show>
          <For each={environment.browsers}>{(browser) =>
            <SettingLine label={browser.name} state={`OpenCode Browse · ${through(environment)}`}>
              <StatusDot label={browser.connected ? "Connected" : "Not running"} tone={browser.connected ? "success" : "muted"} />
              <Show when={!browser.connected && environment.launchable}>
                <Button variant="ghost" outline size="sm" disabled={busy() || !environment.online} aria-label={`Launch ${browser.name}`} onClick={() => void launch(environment)}>Launch</Button>
              </Show>
              <Button variant="ghost" size="sm" disabled={busy()} aria-label={`Unpair ${browser.name}`} onClick={() => void unpair(environment, browser.id)}>Unpair</Button>
            </SettingLine>}</For>
          <Show when={environment.pairing} fallback={
            <SettingLine label={environment.browsers.length ? "Pair another browser" : "Pair a browser"} state={through(environment)}
              title={`Pairs a Chrome, Edge, Brave or other Chromium browser on ${environment.name} with Conduit: install OpenCode Browse in it, then enter the code there.`}>
              <Show when={environment.available} fallback={<StatusDot label={environment.error || "Not available"} tone="muted" />}>
                <SettingLink href={environment.extensionUrl}>Get the extension</SettingLink>
                <Button variant="ghost" outline size="sm" disabled={busy() || !environment.online} onClick={() => void pair(environment)}>Pairing code</Button>
              </Show>
            </SettingLine>}>{(pairing) => <>
            <SettingLine label={<SettingValue mono>{pairing().code}</SettingValue>} state={environment.name}>
              <SettingLink href={environment.extensionUrl}>Get the extension</SettingLink>
              <Button variant="ghost" size="sm" onClick={() => void copy(pairing().code)}><Icons.Copy /> Copy code</Button>
            </SettingLine>
            <Note>In the browser on {environment.name}: add the OpenCode Browse extension, open its Options, choose “Pair with a code” and enter this code. It works once, until {new Date(pairing().expiresAt).toLocaleTimeString(undefined, { timeStyle: "short" })}.</Note>
            <Show when={copied() === pairing().code}><LiveNote>Copied</LiveNote></Show>
          </>}</Show>
        </>}</For>
      </Show>}</Show>
    <Show when={said()}><LiveNote>{said()}</LiveNote></Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Group>;
}
