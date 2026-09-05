import path from "node:path";

// Ignored directories still inherit an ancestor repository unless discovery
// stops at the managed scope's parent. Repositories inside the scope still work.
export function projectEnvironment(project, cwd, environment) {
  if (project.kind === "workspace") return environment;
  return {
    ...environment,
    GIT_CEILING_DIRECTORIES: [path.dirname(cwd), environment.GIT_CEILING_DIRECTORIES].filter(Boolean).join(path.delimiter),
  };
}
