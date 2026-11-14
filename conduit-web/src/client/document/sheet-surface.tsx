import { createSignal } from "solid-js";
import { SheetEditor, type SheetHost, type SheetMarks } from "@/components/sheet";
import { toast } from "@/components/ui/notifications";
import { webSocketUrl } from "../api/transport.js";
import type { ArtifactSurfaceProps } from "./artifact-kinds";
import { sheetCells } from "./artifacts";

/** A sheet in its pane: the hub's live copy in the sheet editor, comments on ranges of cells in the margin beside it. It declares no seats, suggestions or answer acts (Keep, Revert), which a sheet does not have yet. */
export default function SheetSurface(props: ArtifactSurfaceProps) {
  const id = props.about().id;
  const [marks, setMarks] = createSignal<SheetMarks>(), [away, setAway] = createSignal(false), [stale, setStale] = createSignal(false), [drawn, setDrawn] = createSignal(false);
  const host: SheetHost = {
    socket: async (sheet) => new WebSocket(await webSocketUrl(`/v0/document/${sheet}/live`)), author: () => "person",
    cells: (op) => sheetCells(id, op), failed: (message) => toast.error(message),
  };
  props.onSurface({
    markup: {
      client: () => ({ kind: "sheet" }),
      subject: () => ({ sheet: props.about().name, file: props.about().path, ...marks()?.subject(),
        change: "This is a sheet: a CSV file of values, with its formulas kept beside it. A comment is about the cells under `range` (A1). Read it, and change cells or insert and delete rows and columns, with the conduit_artifact tool (`cells`, `set`, `fill`, `rows`, `cols`)." }),
      under: (box) => marks()?.under(box) ?? null,
      margin: {
        anchors: (list) => marks()?.anchors(list), place: (key) => marks()?.where(key) ?? null, watch: (listener) => marks()?.watch(listener) ?? (() => {}),
        focus: () => marks()?.focus(),
      },
      history: { undo: () => marks()?.history.undo() ?? false, redo: () => marks()?.history.redo() ?? false, canUndo: () => marks()?.history.canUndo() ?? false, canRedo: () => marks()?.history.canRedo() ?? false },
      place: () => props.quiet ? null : marks()?.place() ?? null,
      placeAt: (from, to) => marks()?.placeAt(from, to) ?? null,
      slot: () => marks()?.slot(),
    },
    away, stale, drawn,
    reveal: () => { const show = marks()?.reveal; return show && ((place) => { if (place.cells) show(place.cells); }); },
  });
  // The ask key asks the one comments go to about the cells selected.
  const ask = () => { const place = marks()?.place(); if (place && !props.quiet) props.offer()?.ask(place); };
  return <SheetEditor host={host} id={id} name={props.about().name} margin={props.margin} marginEmpty={props.marginEmpty} marks={(made) => setMarks(() => made)} onDrawn={() => setDrawn(true)} onAsk={ask}
    onState={(state) => { setAway(state === "away"); setStale(state === "stale"); }} />;
}
