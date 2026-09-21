import { installedClientKind } from "./installed-client.ts";

/**
 * Three things ship separately and can disagree: the interface in this bundle,
 * the server it is talking to, and, on an installed client, the shell the
 * bundle is running inside. Naming one of them is not enough to say which
 * Conduit someone is looking at.
 */
export interface BuildStamp {
  version: string;
  commit: string;
  /** The tag, when this build came from a release. Empty otherwise. */
  release: string;
  builtAt: string;
}

declare const __CONDUIT_BUILD__: BuildStamp;

// Defined by Vite at build time. A test importing this module runs without
// that definition, so it is read defensively rather than assumed.
export const clientBuild: BuildStamp = typeof __CONDUIT_BUILD__ === "undefined"
  ? { version: "dev", commit: "unknown", release: "", builtAt: "" }
  : __CONDUIT_BUILD__;

/** How a build is named in one line: the release if it is one, else the commit. */
export function buildLabel(build: BuildStamp): string {
  if (build.release) return `${build.release} · ${build.commit}`;
  return `${build.version} · ${build.commit}`;
}

/**
 * The version of the shell around this client -- the installer that was run,
 * not the bundle it carries. Null in a browser, where there is no shell, and
 * null when the shell is too old to answer.
 */
export async function shellVersion(): Promise<string | null> {
  try {
    if (installedClientKind === "desktop") {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    }
    if (installedClientKind === "android") {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      return info.build ? `${info.version} (${info.build})` : info.version;
    }
  } catch {
    return null;
  }
  return null;
}

export interface ServerBuild {
  release: string;
  status: string;
}

/** What the server says it is. /healthz carries the release it was built from. */
export async function serverBuild(fetchHealth: () => Promise<Response>): Promise<ServerBuild | null> {
  try {
    const response = await fetchHealth();
    if (!response.ok) return null;
    const body = await response.json() as { release?: unknown; status?: unknown };
    return {
      release: typeof body.release === "string" && body.release ? body.release : "unknown",
      status: typeof body.status === "string" ? body.status : "",
    };
  } catch {
    return null;
  }
}
