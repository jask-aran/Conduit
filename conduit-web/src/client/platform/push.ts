import { Capacitor } from "@capacitor/core";
import { createSignal } from "solid-js";
import { api } from "../api/client.ts";
import { installedClientKind } from "./installed-client.ts";
import { activeServer, servers, switchToServer } from "./servers.ts";

/**
 * Notifications from the hub on this device (docs/plans/persistent-agent.md, "Reaching you"). One protocol, Web Push,
 * two ways in: the Android app through a UnifiedPush distributor (ntfy and the like), a browser through its own push
 * service and the service worker. The hub keeps the subscriptions; this remembers which one is this device's, per hub.
 */

type Permission = "granted" | "denied" | "prompt";
type Endpoint = { instance: string; url: string; pubKey: string | null; auth: string | null; temporary: boolean };
export type Distributor = { id: string; label: string };
type Listener = { remove(): Promise<void> };
type PushPlugin = {
  status(): Promise<{ distributors: Distributor[]; distributor: string | null; permission: Permission }>;
  requestPermission(): Promise<{ permission: Permission }>;
  useDistributor(options: { id: string }): Promise<void>;
  register(options: { instance: string; vapid: string; label: string }): Promise<void>;
  unregister(options: { instance: string }): Promise<void>;
  endpoints(): Promise<{ endpoints: Endpoint[] }>;
  consumeOpened(): Promise<{ instance: string | null; path: string | null }>;
  addListener(event: "endpoint" | "unregistered" | "failed" | "opened", handler: (data: any) => void): Promise<Listener>;
};
type Saved = { id: string; endpoint: string; label: string };
type HubPush = { publicKey: string; subscriptions: { id: string }[] };

export type PushWay = "android" | "browser" | null;
export type PushProblem = { text: string; distributors?: Distributor[] };

const PATH_KEY = "conduit.push.path";
let plugin: Promise<PushPlugin> | null = null;
const native = () => plugin ??= import("@capacitor/core").then(({ registerPlugin }) => registerPlugin<PushPlugin>("ConduitPush"));

/**
 * Which way in this device has: none in the desktop app yet (WebView2 has no push service), nor in a page without the
 * worker, nor in an Android app installed before its native half existed (its interface updates live, its code does not).
 */
export const pushWay = (): PushWay => installedClientKind === "android" ? Capacitor.isPluginAvailable("ConduitPush") ? "android" : null
  : installedClientKind === "browser" && "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext ? "browser" : null;

/** The hub this device registered with: its identity where the app knows it, else the page's own origin. */
const hubKey = () => activeServer()?.id || location.origin;
const storageKey = () => `conduit.push.${hubKey()}`;
const read = (): Saved | null => { try { return JSON.parse(localStorage.getItem(storageKey()) || "null"); } catch { return null; } };
const write = (saved: Saved | null) => { try { saved ? localStorage.setItem(storageKey(), JSON.stringify(saved)) : localStorage.removeItem(storageKey()); } catch { /* private window */ } };

const bytes = (base64url: string) => Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function remember(endpoint: string, keys: { p256dh: string; auth: string }, kind: "unifiedpush" | "webpush", label: string) {
  const { id } = await api<{ id: string }>("/v0/push/subscriptions", { method: "POST", body: JSON.stringify({ endpoint, keys, kind, label }) });
  write({ id, endpoint, label });
}

async function forget() {
  const saved = read();
  write(null);
  if (saved) await api(`/v0/push/subscriptions/${encodeURIComponent(saved.id)}`, { method: "DELETE" }).catch(() => undefined);
}

/** Opens a notification's chat: here when it came from this hub, otherwise by switching to the hub that sent it. */
function open(instance: string | null, path: string | null) {
  if (!path?.startsWith("/") || path.startsWith("//")) return;
  const hub = instance && activeServer()?.id !== instance ? servers().find((entry) => entry.id === instance) : null;
  if (hub) {
    try { sessionStorage.setItem(PATH_KEY, path); } catch { /* the path is lost, the switch still happens */ }
    switchToServer(hub.origin, true);
    return;
  }
  if (location.pathname === path) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Once at start: follow notification taps, and keep the hub's copy of this device's endpoint current (a distributor
 * may hand out a new one at any time, with or without the page open; the hub upserts by endpoint).
 */
export async function startPush() {
  const way = pushWay();
  let pending: string | null = null;
  try { pending = sessionStorage.getItem(PATH_KEY); sessionStorage.removeItem(PATH_KEY); } catch { /* none */ }
  if (pending) open(null, pending);
  if (way === "browser") {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "conduit-push-open") open(null, String(event.data.path || ""));
    });
    return;
  }
  if (way !== "android") return;
  const push = await native();
  const consume = async () => { const tap = await push.consumeOpened(); if (tap.path) open(tap.instance, tap.path); };
  await push.addListener("opened", () => void consume());
  await push.addListener("endpoint", (endpoint: Endpoint) => void sync(endpoint));
  await push.addListener("unregistered", ({ instance }: { instance: string }) => { if (instance === hubKey()) void forget(); });
  await consume();
  const current = (await push.endpoints()).endpoints.find((endpoint) => endpoint.instance === hubKey());
  if (current) await sync(current);
}

async function sync(endpoint: Endpoint) {
  const saved = read();
  if (endpoint.instance !== hubKey() || !saved || saved.endpoint === endpoint.url || !endpoint.pubKey || !endpoint.auth) return;
  await remember(endpoint.url, { p256dh: endpoint.pubKey, auth: endpoint.auth }, "unifiedpush", saved.label || "Android").catch(() => undefined);
}

/** The settings row's state and actions for this device on the hub it is using. */
export function createPushControl() {
  const [on, setOn] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<PushProblem | null>(null);
  const way = pushWay();

  const refresh = async () => {
    if (!way) return;
    const saved = read();
    if (!saved) return setOn(false);
    const hub = await api<HubPush>("/v0/push").catch(() => null);
    // The hub drops a subscription its push service says is gone: then this device is off again.
    if (hub && !hub.subscriptions.some((item) => item.id === saved.id)) { write(null); return setOn(false); }
    setOn(true);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try { await work(); } catch (error) { setProblem({ text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); void refresh(); }
  };

  const enableAndroid = async (publicKey: string, label: string) => {
    const push = await native();
    let { permission } = await push.status();
    if (permission !== "granted") ({ permission } = await push.requestPermission());
    if (permission !== "granted") throw new Error("Notifications are off for Conduit in Android's settings.");
    const instance = hubKey();
    // The distributor answers on its own time; the endpoint event is the answer, the saved list a fallback.
    const arrived = new Promise<Endpoint | null>((resolve) => {
      let listener: Listener | null = null;
      const timer = setTimeout(() => { void listener?.remove(); resolve(null); }, 30_000);
      void push.addListener("endpoint", (endpoint: Endpoint) => {
        if (endpoint.instance !== instance) return;
        clearTimeout(timer); void listener?.remove(); resolve(endpoint);
      }).then((handle) => { listener = handle; });
    });
    try {
      await push.register({ instance, vapid: publicKey, label: `Conduit · ${activeServer()?.name || location.host}` });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "no_distributor") throw new Error("Install a UnifiedPush app such as ntfy, then turn this on.");
      if (code === "choose_distributor") {
        setProblem({ text: "Choose which app delivers Conduit's notifications.", distributors: (await push.status()).distributors });
        return;
      }
      throw error;
    }
    const endpoint = await arrived ?? (await push.endpoints()).endpoints.find((item) => item.instance === instance) ?? null;
    if (!endpoint?.pubKey || !endpoint.auth) throw new Error("The distributor did not answer. Open it, check it is running, and try again.");
    await remember(endpoint.url, { p256dh: endpoint.pubKey, auth: endpoint.auth }, "unifiedpush", label);
  };

  const enableBrowser = async (publicKey: string, label: string) => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("This page has no service worker yet. Reload it and try again.");
    if (await Notification.requestPermission() !== "granted") throw new Error("Notifications are blocked for this site in the browser.");
    const key = bytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    // A subscription made for another key (a reset hub) cannot carry this hub's messages.
    const current = subscription?.options.applicationServerKey;
    if (subscription && (!current || !new Uint8Array(current).every((byte, index) => byte === key[index]))) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const keys = subscription.toJSON().keys;
    if (!keys?.p256dh || !keys.auth) throw new Error("The browser gave no keys for this subscription.");
    await remember(subscription.endpoint, { p256dh: keys.p256dh, auth: keys.auth }, "webpush", label);
  };

  return {
    way, on, busy, problem, refresh,
    enable: (label: string) => run(async () => {
      const { publicKey } = await api<HubPush>("/v0/push");
      if (way === "android") await enableAndroid(publicKey, label);
      else if (way === "browser") await enableBrowser(publicKey, label);
    }),
    disable: () => run(async () => {
      if (way === "android") await (await native()).unregister({ instance: hubKey() });
      if (way === "browser") await (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription())?.unsubscribe();
      await forget();
    }),
    choose: (id: string, label: string) => run(async () => {
      await (await native()).useDistributor({ id });
      const { publicKey } = await api<HubPush>("/v0/push");
      await enableAndroid(publicKey, label);
    }),
    test: () => run(async () => {
      const saved = read();
      if (saved) await api("/v0/push/test", { method: "POST", body: JSON.stringify({ id: saved.id }) });
    }),
  };
}
