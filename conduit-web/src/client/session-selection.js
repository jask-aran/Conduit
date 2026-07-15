export function sessionIdForLive(projects, liveId) {
  if (!liveId) return null;
  for (const project of projects) {
    const session = project.sessions?.find((item) => item.liveId === liveId);
    if (session) return session.id;
  }
  return null;
}
