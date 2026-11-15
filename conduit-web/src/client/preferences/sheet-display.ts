// How a sheet is drawn on this device: the zoom that reads well is the screen's, so it is the device's, not the person's.
import { createRoot, createSignal } from "solid-js";
import type { SheetDisplay } from "@/components/sheet";

const KEY = "conduit:sheet-display";
export const SHEET_ZOOMS = [0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;
const first: SheetDisplay = { gridlines: true, zoom: 1, focusCell: false };

function saved(): SheetDisplay {
  try {
    const kept = { ...first, ...JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<SheetDisplay> };
    return SHEET_ZOOMS.some((zoom) => zoom === kept.zoom) ? kept : { ...kept, zoom: 1 };
  } catch { return first; }
}
const [display, setDisplay] = createRoot(() => createSignal(saved()));
export const sheetDisplay = display;

export function saveSheetDisplay(patch: Partial<SheetDisplay>) {
  setDisplay({ ...display(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(display())); } catch { /* this session only */ }
}
