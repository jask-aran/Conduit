import path from "node:path";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function nullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safePath(value) {
  const candidate = nullableString(value);
  return candidate ? path.resolve(candidate) : null;
}

function uniquePaths(values) {
  return [...new Set(values.map(safePath).filter(Boolean))];
}

function projectInstallation(installation = {}) {
  return {
    id: nullableString(installation.id),
    label: nullableString(installation.label),
    available: installation.available === true,
    compatible: installation.compatible === true,
    version: nullableString(installation.version),
    source: nullableString(installation.source),
    executablePath: safePath(installation.executablePath),
    agentHome: {
      path: safePath(installation.agentHome?.path),
      source: nullableString(installation.agentHome?.source),
    },
    checkedAt: nullableString(installation.checkedAt),
    error: nullableString(installation.error),
  };
}

function projectGeneration(process = {}) {
  const generation = process.generation;
  if (!generation || typeof generation !== "object") return null;
  const closed = generation.closed === true;
  const settled = generation.settled === true;
  return {
    id: nullableString(generation.id),
    active: process.active === true || (!closed && !settled),
    closed,
    settled,
  };
}

function projectProcess(process = {}) {
  return {
    id: nullableString(process.id),
    chatId: nullableString(process.chatId),
    projectId: nullableString(process.projectId),
    status: nullableString(process.status),
    activity: nullableString(process.activity),
    installationId: nullableString(process.runtime?.installationId),
    clientCount: Number.isFinite(process.clientCount) ? Math.max(0, Math.trunc(process.clientCount)) : 0,
    generation: projectGeneration(process),
  };
}

export function projectDiagnostics({ installations, processes, projects, config = {} } = {}) {
  const projectRows = list(projects);
  return {
    installations: list(installations).map(projectInstallation),
    processes: list(processes).map(projectProcess),
    storage: {
      dataRoot: safePath(config.dataRoot),
      transcriptRoots: uniquePaths(projectRows.map((project) => project?.sessionsDir)),
      uploadRoots: uniquePaths(projectRows.map((project) => {
        const projectPath = safePath(project?.path);
        return projectPath ? path.join(projectPath, ".conduit", "chats") : null;
      })),
    },
  };
}
