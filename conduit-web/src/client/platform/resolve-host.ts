import { installedClientKind } from "./installed-client.ts";

/** The addresses a host name stands for, from the app's own resolver (a page has none): empty where it cannot ask. */
export async function resolveHost(host: string): Promise<string[]> {
  try {
    if (installedClientKind === "android") {
      const { registerPlugin } = await import("@capacitor/core");
      const plugin = registerPlugin<{ resolve(options: { host: string }): Promise<{ addresses?: string[] }> }>("ConduitDiscovery");
      return (await plugin.resolve({ host })).addresses ?? [];
    }
    if (installedClientKind === "desktop") {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string[]>("resolve_host", { host });
    }
  } catch {}
  return [];
}
