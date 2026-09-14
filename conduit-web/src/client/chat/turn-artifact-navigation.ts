export const TURN_ARTIFACT_NAVIGATION_EVENT = "conduit:turn-artifact-navigation";

export interface TurnArtifactNavigationRequest {
  chatId: string;
  checkpointId: string;
  path: string;
}

export function requestTurnArtifactNavigation(request: TurnArtifactNavigationRequest): void {
  window.dispatchEvent(new CustomEvent<TurnArtifactNavigationRequest>(TURN_ARTIFACT_NAVIGATION_EVENT, { detail: request }));
}
