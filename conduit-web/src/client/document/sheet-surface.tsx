import { createSignal } from "solid-js";
import { SheetEditor, type SheetFrozen, type SheetHost, type SheetMarks, type SheetPlace } from "@/components/sheet";
import type { SheetChartKind } from "@/sheet-charts.js";
import { toast } from "@/components/ui/notifications";
import { webSocketUrl } from "../api/transport.js";
import type { ArtifactSurfaceProps } from "./artifact-kinds";
import { api } from "../api/client";
import { ARTIFACT_KINDS } from "./artifact-kinds";
import { sheetCells } from "./artifacts";
import { sheetDisplay } from "../preferences/sheet-display";

/** A sheet in its pane: the hub's live copy in the sheet editor, comments on ranges of cells in the margin beside it. It declares no seats, suggestions or answer acts (Keep, Revert), which a sheet does not have yet. */
export default function SheetSurface(props: ArtifactSurfaceProps) {
  const id = props.about().id;
  const [marks, setMarks] = createSignal<SheetMarks>(), [away, setAway] = createSignal(false), [stale, setStale] = createSignal(false), [drawn, setDrawn] = createSignal(false);
  const host: SheetHost = {
    socket: async (sheet) => new WebSocket(await webSocketUrl(`/v0/document/${sheet}/live`)), author: () => "person",
    cells: (op) => sheetCells(id, op), failed: (message) => toast.error(message), tools: ARTIFACT_KINDS.sheet.cells,
    frozen: () => api<{ report: { frozen?: SheetFrozen } | null }>(`/v0/document/${encodeURIComponent(id)}?as=import`).then(({ report }) => report?.frozen ?? null, () => null),
    display: sheetDisplay, openSettings: () => window.dispatchEvent(new CustomEvent("conduit:open-settings", { detail: "artifacts" })),
  };
  props.onSurface({
    markup: {
      client: () => ({ kind: "sheet" }),
      subject: () => ({ sheet: props.about().name, file: props.about().path, ...marks()?.subject(),
        change: "This is a sheet: a CSV file of values, with its formulas kept beside it. A comment is about the cells under `range` (A1). Read it, and change cells or insert and delete rows and columns, with the conduit_artifact tool (`cells`, `set`, `fill`, `rows`, `cols`), and make or change a chart of them with its `chart`." }),
      under: (box) => marks()?.under(box) ?? null,
      margin: {
        anchors: (list) => marks()?.anchors(list), place: (key) => marks()?.where(key) ?? null, watch: (listener) => marks()?.watch(listener) ?? (() => {}),
        focus: () => marks()?.focus(),
      },
      history: { undo: (count) => marks()?.history.undo(count) ?? false, redo: (count) => marks()?.history.redo(count) ?? false, canUndo: () => marks()?.history.canUndo() ?? false, canRedo: () => marks()?.history.canRedo() ?? false, steps: () => marks()?.history.steps() ?? { undo: [], redo: [] } },
      place: () => props.quiet ? null : marks()?.place() ?? null,
      placeAt: (from, to) => marks()?.placeAt(from, to) ?? null,
      tools: () => marks()?.tools() ?? [],
      slot: () => marks()?.slot(),
    },
    offers: () => ({ shortcuts: () => marks()?.shortcuts() }),
    actions: () => marks()?.actions() ?? [],
    away, stale, drawn,
    reveal: () => { const show = marks()?.reveal; return show && ((place) => { if (place.cells) show(place.cells); }); },
  });
  // A chart is asked of the one comments go to, as a comment on its range; Markup's ask box says it is being made, with Stop, as for any request.
  const chart = (place: SheetPlace, kind?: SheetChartKind) => {
    const words = `Make a ${kind ? `${kind} ` : ""}chart of these cells${kind ? "" : ", of the kind that fits them"}, with the chart action of conduit_artifact.`;
    void offered()?.request(place, words, { doing: `Making the ${kind ? `${kind} ` : ""}chart…` }).catch((error: Error) => toast.error(`The chart was not asked for: ${error.message}`));
  };
  // Comment starts a comment on the cells selected, as the quote tool does; Ask the agent (and the ask key, as a paper's) asks the one comments go to about them. Both need Markup open.
  const about = (then: (place: NonNullable<ReturnType<SheetMarks["place"]>>) => void) => () => { const place = marks()?.place(); if (place && !props.quiet) then(place); };
  const offered = () => props.quiet ? null : props.offer();
  return <SheetEditor host={host} id={id} name={props.about().name} margin={props.margin} marginEmpty={props.marginEmpty} marks={(made) => setMarks(() => made)} onDrawn={() => setDrawn(true)}
    onAsk={offered()?.to() ? about((place) => offered()?.ask(place)) : undefined} onComment={offered() ? about((place) => offered()?.comment(place)) : undefined} onChart={chart}
    onState={(state) => { setAway(state === "away"); setStale(state === "stale"); }} />;
}
