import { registerPlugin } from "@capacitor/core";
import { installedClientKind } from "./installed-client";

/**
 * Catches the end of a provider sign-in on this device. The sign-in page ends by sending the browser to
 * http://localhost:<port>/...?code=...; when the hub is elsewhere nothing answers there, so an installed app
 * listens on its own loopback port for the length of the sign-in and hands the URL back to be forwarded.
 */
const nativeLoopback = registerPlugin<{
  listen(options: { port: number }): Promise<{ url: string | null }>;
  stop(): Promise<void>;
}>("ConduitLoopback");

/** The loopback port a sign-in page will end on, read from its redirect_uri (http, host localhost or 127.0.0.1); null when it ends elsewhere. */
export function loopbackPort(authUrl: string): number | null {
  try {
    const redirect = new URL(new URL(authUrl).searchParams.get("redirect_uri") ?? "");
    if (redirect.protocol !== "http:" || (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1")) return null;
    const port = Number(redirect.port || 80);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/** In an installed app: listen on this device's 127.0.0.1:<port> until a request with a query string arrives, and resolve with its full URL
 *  ("http://localhost:<port><path>?<query>"). Resolves null when it cannot listen (the port is taken: the hub is on this machine and catches
 *  it itself), when stopped, or after ten minutes. Returns null in a browser tab, where nothing can listen. */
export function catchLoopback(port: number): { url: Promise<string | null>; stop(): void } | null {
  if (installedClientKind === "android") {
    return {
      url: nativeLoopback.listen({ port }).then((r) => r.url ?? null, () => null),
      stop: () => { void nativeLoopback.stop().catch(() => {}); },
    };
  }
  if (installedClientKind === "desktop") {
    const tauri = import("@tauri-apps/api/core");
    return {
      url: tauri.then(({ invoke }) => invoke<string | null>("loopback_listen", { port })).then((u) => u ?? null, () => null),
      stop: () => { void tauri.then(({ invoke }) => invoke("loopback_stop")).catch(() => {}); },
    };
  }
  return null;
}
