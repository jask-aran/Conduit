export type MobileSwipeAction = "open-sidebar" | "close-sidebar" | "open-workspace" | "close-workspace";

export function mobileSwipeAction(input: {
  startX: number; startY: number; endX: number; endY: number;
  sidebarOpen: boolean; workspaceOpen: boolean;
}): MobileSwipeAction | null {
  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.25) return null;
  if (input.sidebarOpen) return dx < 0 ? "close-sidebar" : null;
  if (input.workspaceOpen) return dx > 0 ? "close-workspace" : null;
  return dx > 0 ? "open-sidebar" : "open-workspace";
}
