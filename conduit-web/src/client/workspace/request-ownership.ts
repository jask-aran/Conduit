export interface WorkspaceRequest {
  projectId: string;
  generation: number;
  operation: string;
  version: number;
}

export function ownsWorkspaceRequest(current: WorkspaceRequest, candidate: WorkspaceRequest) {
  return current.projectId === candidate.projectId
    && current.generation === candidate.generation
    && current.operation === candidate.operation
    && current.version === candidate.version;
}
