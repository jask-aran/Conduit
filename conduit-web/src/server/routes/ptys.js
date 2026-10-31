import { remoteNode } from "../../place.js";
import { computerContext, resolveComputerContext } from "../../computer-context.js";

async function terminalContext(projects, id, cwd, nodeHub) {
  // A device's own terminal, in its home, outside any workspace: as "computer"
  // is this server's. Where any of its folders is shared with commands.
  if (id.startsWith("device:")) {
    const nodeId = id.slice("device:".length);
    const node = (await nodeHub?.list())?.find((item) => item.id === nodeId);
    if (!node) throw Object.assign(new Error("No such device"), { code: "pty_project_not_found", status: 404 });
    if (!node.online) throw Object.assign(new Error(`${node.name} is offline`), { code: "pty_cwd_unavailable", status: 409 });
    if (!node.terminal) {
      throw Object.assign(new Error(`${node.name} shares no folder with commands, so it offers no terminal`),
        { code: "pty_cwd_unavailable", status: 403 });
    }
    const device = (await nodeHub.listDevices()).find((item) => item.nodes.some((candidate) => candidate.id === nodeId));
    const where = `~ on ${device?.name || node.name}`;
    return { project: { id, nodeId, local: false, place: { home: true }, workingRoot: where }, cwd: where };
  }
  if (id === "computer") {
    const context = await computerContext(cwd);
    return { project: { ...context, id: "computer" }, cwd: context.workingRoot };
  }
  const computer = await resolveComputerContext(id);
  if (computer) return { project: computer, cwd: computer.workingRoot };
  const project = await projects.get(id);
  if (!project) throw Object.assign(new Error("Terminal project was not found"), { code: "pty_project_not_found" });
  // A device's folder: the device runs the shell there and checks the grant.
  if (remoteNode(project)) return { project, cwd: project.workingRoot };
  try { await projects.validate(project, { createManaged: !project.externalPath }); }
  catch (error) {
    if (error.code === "workspace_identity_changed") {
      const root = projects.workingRoot(project);
      throw Object.assign(new Error(`Terminal working directory is unavailable to this Conduit server: ${root}`), {
        code: "pty_cwd_unavailable",
        status: 409,
        path: root,
        cause: error,
      });
    }
    throw error;
  }
  return { project, cwd: projects.workingRoot(project) };
}

export function registerPtyRoutes(app, { projects, terminals, nodeHub = null }) {
  app.get("/v0/ptys", async (request, response, next) => {
    try {
      await terminals.reconcile();
      const projectId = String(request.query?.projectId || "");
      const ptys = terminals.list().filter((record) => !projectId || record.projectId === projectId);
      response.json({ ptys });
    } catch (error) { next(error); }
  });

  app.post("/v0/ptys", async (request, response, next) => {
    try {
      const { project, cwd } = await terminalContext(projects, String(request.body?.projectId || ""), request.body?.cwd, nodeHub);
      response.status(201).json(await terminals.create({ project, cwd, templateId: String(request.body?.templateId || "shell"), title: request.body?.title, cols: request.body?.cols, rows: request.body?.rows }));
    }
    catch (error) { next(error); }
  });

  // A grant to attach to a device's terminal on the device itself, the shortest way (nodes/node-direct.js).
  app.get("/v0/ptys/:id/direct", async (request, response, next) => {
    try {
      const shell = terminals.deviceShell(request.params.id);
      if (!shell) return response.status(404).json({ error: terminals.get(request.params.id) ? "direct_not_on_node" : "pty_not_found" });
      // The page asking is named, so the node lets that origin attach (the apps' it knows already).
      const named = String(request.query.origin || request.headers.origin || "");
      const origin = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(named) ? named.toLowerCase() : "";
      const grant = await nodeHub?.directPtyGrant(shell.nodeId, shell.procId, origin);
      if (!grant) return response.status(404).json({ error: "direct_unavailable" });
      response.setHeader("Cache-Control", "no-store");
      response.json(grant);
    } catch (error) { next(error); }
  });

  app.post("/v0/ptys/:id/rename", async (request, response, next) => {
    try { const record = await terminals.rename(request.params.id, request.body?.title); if (!record) return response.status(404).json({ error: "pty_not_found" }); response.json(record); }
    catch (error) { next(error); }
  });

  app.delete("/v0/ptys/:id", async (request, response, next) => {
    try { const removed = await terminals.remove(request.params.id); if (!removed) return response.status(404).json({ error: "pty_not_found" }); response.status(204).end(); }
    catch (error) { next(error); }
  });
}
