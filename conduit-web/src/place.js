/**
 * Where a workspace's work happens (plan › Architecture, "Making it
 * general"): a device, and a place on it. The head is a device like any
 * other -- its own folders, reached in process rather than over a socket --
 * so callers ask what a place can do, never whether it is a device.
 */

/** The head's own device: always there, never in nodes.json. */
export const HEAD = "head";

/** A project's place: `{ device, nodeId, root, path, local }`; `nodeId` is null on the head. */
export function placeOf(project) {
  if (project?.nodeId) {
    return { device: project.nodeId, nodeId: project.nodeId, root: project.place?.root || null, path: project.place?.path || "", local: false };
  }
  return { device: HEAD, nodeId: null, root: null, path: project?.workingRoot || "", local: true };
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
    return { device: { id: HEAD, name: serverName, local: true, online: true },
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
