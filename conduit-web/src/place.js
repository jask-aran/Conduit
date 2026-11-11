import crypto from "node:crypto";

// The hub is a device like any other and differs only in transport: its own folders are reached in process, every
// other device's over its node's socket. Callers ask what a place can do; only the seams ask how, through `remoteNode`.

// Named from the server's identity so they stay put.
export const hubIds = (serverId) => ({ deviceId: `device_${serverId}`, nodeId: `node_${serverId}` });

export const headRootId = (folder) => `r_${crypto.createHash("sha256").update(String(folder)).digest("base64url").slice(0, 12)}`;

export const remoteNode = (project) => (project?.nodeId && project.local !== true ? project.nodeId : null);

export function placeOf(project) {
  return { device: project?.nodeId || null, nodeId: project?.nodeId || null, root: project?.place?.root || null,
    path: project?.place?.path || "", local: !remoteNode(project) };
}

/*
 * No checkpoints for the shared Chats folder: every such chat and the agent write there, so a turn's changes are
 * nobody's in particular. On a device only a Git workspace with the shell grant gets them: Git names the changed
 * files, where a plain folder's snapshot reads all of it, over the link, before each turn.
 */
export async function capabilitiesOf(project, { hub = null, backends, serverName = "This server" }) {
  const at = placeOf(project);
  const local = new Set(backends.local || backends.adapters.keys());
  if (at.local) {
    return { device: { id: at.nodeId, name: serverName, local: true, online: true },
      harnesses: [...local], checkpoints: project.kind !== "unstructured", deleteFiles: true, git: true };
  }
  const node = await hub?.get(at.nodeId);
  const live = hub?.live.get(at.nodeId);
  const onDevice = new Set(live?.harnesses || node?.harnesses || []);
  // Codex's app-server daemon is Unix-only: a Windows node that offers it cannot run it.
  if ((live?.platform || node?.platform) === "win32") onDevice.delete("codex");
  const harnesses = [...backends.adapters.keys()].filter((implementation) => {
    const adapter = backends.adapters.get(implementation);
    if (!adapter?.runsOnDevices) return false;
    // A harness that runs on devices runs that device's install; anything else runs here.
    return backends.manifestFor?.(implementation)?.devices ? onDevice.has(implementation) : local.has(implementation);
  });
  const root = (live?.roots || node?.roots || []).find((item) => item.id === at.root);
  const device = node && (await hub.listDevices()).find((item) => item.id === node.deviceId);
  return { device: { id: at.nodeId, name: device?.name || node?.name || "A device", local: false, online: Boolean(live?.ready) },
    harnesses, checkpoints: project.kind === "workspace" && Boolean(root?.shell), deleteFiles: false, git: Boolean(root?.shell) };
}
