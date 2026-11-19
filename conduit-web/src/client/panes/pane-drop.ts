export type DropZone = "left" | "middle" | "right";

/**
 * Where over a pane a dragged document lands, from the pointer's fraction of
 * its width: the outer thirds open panes; without room for one, only the middle.
 */
export function dropZoneAt(fraction: number, edges: boolean): { zone: DropZone; edge: number } {
  const edge = 1 / 3;
  return { zone: !edges ? "middle" : fraction < edge ? "left" : fraction > 1 - edge ? "right" : "middle", edge };
}

export function dropWash(box: { left: number; right: number; width: number }, zone: DropZone, edge: number, edges: boolean) {
  const band = edges ? box.width * edge : 0;
  return zone === "left" ? { left: box.left, width: band } : zone === "right" ? { left: box.right - band, width: band } : { left: box.left + band, width: box.width - band * 2 };
}
