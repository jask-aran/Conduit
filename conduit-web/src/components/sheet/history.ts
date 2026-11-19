import * as Y from "yjs";
import type { SheetCellsOp } from "./host";

/** One step of the page's history: the origin of every transaction it makes, here and, tagged, on the hub (live.ts), so all of it is undone as one. */
export class SheetStep { counted = false; constructor(readonly id: number, readonly label: string) {} }

// Excel keeps 100 steps; the list shows the latest of them.
const KEPT = 100, LISTED = 20, STEP = "step", LABEL = "label", WAIT_MS = 3000;
// A change made outside any named step is named by the look it changed.
const LOOKS: Record<string, string> = { style: "Format cells", fmt: "Number format", width: "Column width", height: "Row height", hidden: "Hide rows", freezeRows: "Freeze panes", freezeCols: "Freeze panes", filter: "Filter", table: "Table", type: "Column type" };
const described = (changed: Map<unknown, readonly unknown[]>) => {
  for (const events of changed.values()) for (const event of events) if (event instanceof Y.YMapEvent) for (const name of event.keysChanged) { const what = LOOKS[name.slice(0, name.indexOf(":"))]; if (what) return what; }
  return "Edit";
};
const opLabel = (op: SheetCellsOp) => {
  const many = "count" in op && (op.count ?? 1) > 1 ? `${op.count} ` : "", [verb, what] = op.op.split("-");
  return op.op === "sort" ? `Sort ${op.descending ? "Z–A" : "A–Z"}` : what ? `${verb === "insert" ? "Insert" : "Delete"} ${many}${what === "rows" ? "row" : "column"}${many ? "s" : ""}` : op.op === "fill" ? "Fill" : "Typing";
};

/**
 * The page's one history, as a spreadsheet's: every change made here, the hub's for it included, is a step; another person's or agent's never is.
 * `act` runs a change as one named step (its writes one transaction); `hub` sends an op whose updates come back tagged with the step (inside an `act`,
 * its step). Undo and redo are each one local transaction. While an op is out, or the tagged updates its reply counts (`tagged`) have not all come, Undo
 * waits, so it never undoes the step before it; a step made meanwhile drops it, as it was pressed for an older one. An op the hub never answers is
 * given up on after a while, and the Undo waiting on it with it.
 */
// Any Yjs type, whatever its events.
type Scoped = Y.AbstractType<any>;
export function createSheetHistory(doc: Y.Doc, scope: Scoped[], send: (op: SheetCellsOp) => Promise<unknown>) {
  const um = new Y.UndoManager(scope, { captureTimeout: 0, trackedOrigins: new Set<unknown>([null, SheetStep]) });
  const steps = new Map<number, SheetStep>(), listeners = new Set<() => void>(), owed: (() => void)[] = [];
  // `made`: steps that changed something or sent an op (each once), and changes made outside any. A step begun for a key that did nothing is not one.
  let open: SheetStep | null = null, lone: SheetStep | null = null, next = 1, made = 0, out = 0, owedFrames = 0, late: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    clearTimeout(late);
    if (out) return;
    if (owedFrames > 0) { late = setTimeout(() => { owedFrames = 0; settle(); }, WAIT_MS); return; }
    // Nothing out: a count left below none (updates after a reply's error, or after giving up) is not carried into the next op.
    owedFrames = 0;
    for (const run of owed.splice(0)) run();
  };
  const changed = () => listeners.forEach((listener) => listener());
  const count = (step: SheetStep | null) => { if (step?.counted) return; if (step) step.counted = true; made++; };
  const begin = (label: string) => { const step = new SheetStep(next++, label); steps.set(step.id, step); if (steps.size > KEPT * 2) steps.delete(steps.keys().next().value!); return step; };
  um.on("stack-item-added", ({ stackItem, origin, changedParentTypes }) => {
    const step = origin instanceof SheetStep ? origin : null, stack = um.undoStack;
    if (origin === um) stackItem.meta.set(LABEL, um.currStackItem?.meta.get(LABEL));
    else {
      const into = step && stack.findLast((item) => item !== stackItem && item.meta.get(STEP) === step.id);
      if (into) {
        into.insertions = Y.mergeDeleteSets([into.insertions, stackItem.insertions]); into.deletions = Y.mergeDeleteSets([into.deletions, stackItem.deletions]);
        stack.splice(stack.lastIndexOf(stackItem), 1);
      } else {
        count(step);
        stackItem.meta.set(STEP, step?.id).set(LABEL, step?.label || described(changedParentTypes));
        if (stack.length > KEPT) stack.shift();
      }
    }
    changed();
  });
  const walk = (back: boolean, count = 1) => {
    if (out || owedFrames > 0) { const at = made; owed.push(() => { if (made === at) walk(back, count); }); return true; }
    let done = false;
    for (let n = 0; n < count; n++) done = (back ? um.undo() : um.redo()) !== null || done;
    changed();
    return done;
  };
  const labels = (stack: typeof um.undoStack) => stack.slice(-LISTED).reverse().map((item) => String(item.meta.get(LABEL) ?? "Edit"));
  return {
    act<T>(label: string, run: () => T): T {
      if (open) return run();
      open = begin(label);
      try { return doc.transact(run, open); } finally { open = null; }
    },
    hub(op: SheetCellsOp) {
      // Ops sent together outside a step (the fill handle's, a run of shown rows each) are one step.
      const step = open ?? lone ?? (lone = begin(opLabel(op)));
      queueMicrotask(() => { lone = null; });
      count(step);
      out++;
      let over = false;
      const done = () => { if (over) return; over = true; clearTimeout(gaveUp); out--; settle(); }, gaveUp = setTimeout(() => { owed.length = 0; done(); }, WAIT_MS * 10);
      return send({ ...op, step: step.id, client: doc.clientID }).then((said) => {
        const tagged = (said as { tagged?: unknown } | null)?.tagged;
        if (typeof tagged === "number") owedFrames += tagged;
        return said;
      }).finally(done);
    },
    // A tagged update applied (live.ts): one fewer owed, counted below none when it comes before its op's reply.
    // Asked for as the update is about to be applied (live.ts): settled after it, so a queued Undo sees it.
    origin: (id: number) => { if (--owedFrames === 0) queueMicrotask(settle); return steps.get(id) ?? new SheetStep(id, ""); },
    // A tab gone takes its steps' cells with it: a step on it could not be undone.
    clear: () => { um.clear(); changed(); },
    undo: (count?: number) => walk(true, count),
    redo: (count?: number) => walk(false, count),
    canUndo: () => um.canUndo(),
    canRedo: () => um.canRedo(),
    steps: () => ({ undo: labels(um.undoStack), redo: labels(um.redoStack) }),
    scope: (types: Scoped[]) => um.addToScope(types),
    onChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    destroy: () => { listeners.clear(); um.destroy(); },
  };
}
export type SheetHistory = ReturnType<typeof createSheetHistory>;
