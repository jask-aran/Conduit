import crypto from "node:crypto";

/**
 * Where a workspace's work happens (plan › Architecture, "Making it
 * general"): a device, and a place on it. The head is a device like any
 * other (decision 24) -- it is listed with the rest, its folders are its
 * node's roots, unscoped chats live on it -- and differs only in transport:
 * its own folders are reached in process (`local`), every other device's
 * over its node's socket. Callers ask what a place can do; only the seams
 * ask how it is reached, through `remoteNode`.
 */

/** The head's own device and node, named from the server's identity so they stay put. */
export const headIds = (serverId) => ({ deviceId: `device_${serverId}`, nodeId: `node_${serverId}` });

/** A root of the head's node: one per folder it holds a workspace in, named from the path. */
export const headRootId = (folder) => `r_${crypto.createHash("sha256").update(String(folder)).digest("base64url").slice(0, 12)}`;

/**
 * The node a project's place is reached through over the network, or null
 * when it is reached in process: the head's own folders (a project view says
 * `local`), or a stored record that names no node.
 */
export const remoteNode = (project) => (project?.nodeId && project.local !== true ? project.nodeId : null);

/** A project's place: `{ device, nodeId, root, path, local }`. */
export function placeOf(project) {
  return { device: project?.nodeId || null, nodeId: project?.nodeId || null, root: project?.place?.root || null,
    path: project?.place?.path || "", local: !remoteNode(project) };
}

/**
 * What can be done at a project's place, and on which device:
 * - `harnesses`: implementations a chat there can use. On the head, what is
 *   installed here; on a device, what it runs (a harness adapter starts it
 *   there) and whatever runs on the head acting through the device (the
 *   Conduit durable agent).
 * - `checkpoints`: turn snapshots, for Chat review (the head's disk only).
 * - `deleteFiles`: Conduit may delete the folder (never on a device).
 * - `git`: Git can run there (a device runs it as a command: the shell grant).
 * `device` says whose it is: `{ id, name, local, online }`.
 */
export async function capabilitiesOf(project, { hub = null, backends, serverName = "This server" }) {
  const at = placeOf(project);
  const local = new Set(backends.local || backends.adapters.keys());
  if (at.local) {
    return { device: { id: at.nodeId, name: serverName, local: true, online: true },
      harnesses: [...local], checkpoints: true, deleteFiles: true, git: true };
  }
  const node = await hub?.get(at.nodeId);
  const live = hub?.live.get(at.nodeId);
  const onDevice = new Set(live?.harnesses || node?.harnesses || []);
  const harnesses = [...backends.adapters.keys()].filter((implementation) => {
    const adapter = backends.adapters.get(implementation);
    if (!adapter?.runsOnDevices) return false;
    // A harness that runs on devices runs that device's install; anything else runs here.
    return backends.manifestFor?.(implementation)?.devices ? onDevice.has(implementation) : local.has(implementation);
  });
  const root = (live?.roots || node?.roots || []).find((item) => item.id === at.root);
  const device = node && (await hub.listDevices()).find((item) => item.id === node.deviceId);
  return { device: { id: at.nodeId, name: device?.name || node?.name || "A device", local: false, online: Boolean(live?.ready) },
    harnesses, checkpoints: false, deleteFiles: false, git: Boolean(root?.shell) };
}
