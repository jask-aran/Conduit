export interface WorkspaceRequest {
  projectId: string;
  version: number;
}

export function ownsWorkspaceRequest(current: WorkspaceRequest, candidate: WorkspaceRequest) {
  return current.projectId === candidate.projectId && current.version === candidate.version;
}
