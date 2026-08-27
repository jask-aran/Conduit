import os from "node:os";
import fs from "node:fs/promises";

async function terminalContext(projects, id) {
  const project = await projects.get(id);
  if (!project) throw Object.assign(new Error("Terminal project was not found"), { code: "pty_project_not_found" });
  if (project.kind === "workspace") {
    try { await projects.validate(project); }
    catch (error) {
      if (error.code === "workspace_identity_changed") {
        throw Object.assign(new Error(`Terminal working directory is unavailable to this Conduit server: ${project.path}`), {
          code: "pty_cwd_unavailable",
          status: 409,
          path: project.path,
          cause: error,
        });
      }
      throw error;
    }
    return { project, cwd: project.path };
  }
  const cwd = await fs.realpath(os.homedir());
  if (!(await fs.stat(cwd)).isDirectory()) throw Object.assign(new Error("Terminal home directory is unavailable"), { code: "pty_home_unavailable" });
  return { project, cwd };
}

export function registerPtyRoutes(app, { projects, terminals }) {
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
      const { project, cwd } = await terminalContext(projects, String(request.body?.projectId || ""));
      response.status(201).json(await terminals.create({ project, cwd, templateId: String(request.body?.templateId || "shell"), title: request.body?.title, cols: request.body?.cols, rows: request.body?.rows }));
    }
    catch (error) { next(error); }
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
