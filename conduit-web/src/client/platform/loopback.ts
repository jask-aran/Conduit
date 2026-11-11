import { registerPlugin } from "@capacitor/core";
import { installedClientKind } from "./installed-client";

/**
 * A provider sign-in ends on http://localhost:<port>; when the hub is elsewhere nothing answers there, so an
 * installed app listens on its own loopback port and hands the URL back to be forwarded.
 */
const nativeLoopback = registerPlugin<{
  listen(options: { port: number }): Promise<{ url: string | null }>;
  stop(): Promise<void>;
}>("ConduitLoopback");

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

/** Resolves null when the port is taken: the hub is on this machine and catches it itself. */
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
