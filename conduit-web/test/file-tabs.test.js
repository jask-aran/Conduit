import assert from "node:assert/strict";
import test from "node:test";
import {
  FILE_TAB_CAP,
  dropWash,
  dropZoneAt,
  fileTabParam,
  fileTabsFromParams,
  moveKey,
  nextShownTab,
  reconcileSide,
  swapRecordKeys,
  withoutTab,
} from "../src/client/workspace/file-tabs.ts";

// The file viewer's tab rules (docs/design/panes-and-rail.md). The browser
// half -- focus, drag, folding -- is scripts/panes-smoke.mjs.

const file = (path, projectId = "p") => ({ projectId, path });
const keys = (tabs) => tabs.entries.map((entry) => entry.path);

test("a newly opened file joins the end of its side's tabs", () => {
  let tabs = reconcileSide(undefined, file("a"), undefined, false);
  tabs = reconcileSide(tabs, file("b"), file("a"), true);
  tabs = reconcileSide(tabs, file("c"), file("b"), true);
  assert.deepEqual(keys(tabs), ["a", "b", "c"]);
  assert.deepEqual(tabs.used, ["p:c", "p:b", "p:a"]);
});

test("opening without Ctrl replaces the file shown, in its place", () => {
  let tabs = { entries: [file("a"), file("b"), file("c")], used: ["p:b", "p:a", "p:c"] };
  tabs = reconcileSide(tabs, file("x"), file("b"), false);
  assert.deepEqual(keys(tabs), ["a", "x", "c"]);
  assert.equal(tabs.used[0], "p:x");
});

test("a file already a tab is shown in place, not duplicated", () => {
  let tabs = { entries: [file("a"), file("b"), file("c")], used: ["p:c", "p:b", "p:a"] };
  tabs = reconcileSide(tabs, file("a"), file("c"), true);
  assert.deepEqual(keys(tabs), ["a", "b", "c"]);
  assert.equal(tabs.used[0], "p:a");
  // Unkept, the replaced file goes as the existing tab is shown.
  tabs = reconcileSide(tabs, file("b"), file("a"), false);
  assert.deepEqual(keys(tabs), ["b", "c"]);
});

test("past the cap the least recently shown tab goes", () => {
  let tabs;
  let previous;
  for (const name of ["a", "b", "c", "d", "e", "f"]) {
    tabs = reconcileSide(tabs, file(name), previous, true);
    previous = file(name);
  }
  assert.equal(tabs.entries.length, FILE_TAB_CAP);
  assert.deepEqual(keys(tabs), ["b", "c", "d", "e", "f"]);
});

test("a showing tab closing gives way to the side's last used", () => {
  const tabs = { entries: [file("a"), file("b"), file("c")], used: ["p:b", "p:c", "p:a"] };
  assert.equal(nextShownTab(tabs, "p:b").path, "c");
  assert.deepEqual(keys(withoutTab(tabs, "p:b")), ["a", "c"]);
  assert.deepEqual(withoutTab(tabs, "p:b").used, ["p:c", "p:a"]);
  assert.equal(nextShownTab({ entries: [file("a")], used: ["p:a"] }, "p:a"), undefined);
});

test("side tabs round-trip through the URL", () => {
  const tabs = { entries: [file("a b.md"), file("dir/c.txt", "q")], used: [] };
  assert.equal(fileTabParam(0, 1, { entries: [file("a")], used: [] }), null, "a lone showing file needs no ftabs");
  const params = new URLSearchParams();
  params.append("pane", "chat:x");
  params.append("ftabs", fileTabParam(0, 1, tabs));
  params.append("ftabs", fileTabParam(1, 0, tabs));
  params.append("ftabs", fileTabParam(2, 0, tabs)); // no third pane: dropped
  const found = fileTabsFromParams(params);
  assert.deepEqual(Object.keys(found).sort(), ["0#0", "main#1"]);
  assert.deepEqual(found["main#1"].entries, tabs.entries);
  assert.deepEqual(found["0#0"].used, ["p:a b.md", "q:dir/c.txt"]);
});

test("the URL is held to the cap", () => {
  const many = { entries: ["a", "b", "c", "d", "e", "f", "g"].map((name) => file(name)), used: [] };
  const found = fileTabsFromParams(new URLSearchParams({ ftabs: fileTabParam(0, 0, many) }));
  assert.equal(found["main#0"].entries.length, FILE_TAB_CAP);
});

test("a side closing shifts the next down; sides swap with everything keyed to them", () => {
  assert.deepEqual(moveKey({ "main#0": 1, "main#1": 2 }, "main#1", "main#0"), { "main#0": 2 });
  assert.deepEqual(moveKey({ "main#0": 1 }, "main#1", "main#0"), {}, "an empty source clears the target");
  assert.deepEqual(swapRecordKeys({ "0#0": "x", "0#1": "y", other: 1 }, "0#0", "0#1"), { "0#0": "y", "0#1": "x", other: 1 });
  assert.deepEqual(swapRecordKeys({ "0#0": false }, "0#0", "0#1"), { "0#1": false }, "a false wrap still moves");
});

test("a file viewer's pane targets are its outer fifths; anything else's, thirds", () => {
  const viewer = { edges: true, viewer: true };
  const other = { edges: true, viewer: false };
  assert.equal(dropZoneAt(0.19, viewer).zone, "left");
  assert.equal(dropZoneAt(0.21, viewer).zone, "middle");
  assert.equal(dropZoneAt(0.81, viewer).zone, "right");
  assert.equal(dropZoneAt(0.3, other).zone, "left");
  assert.equal(dropZoneAt(0.5, other).zone, "middle");
  assert.equal(dropZoneAt(0.7, other).zone, "right");
  assert.equal(dropZoneAt(0.05, { edges: false, viewer: true }).zone, "middle", "no room: only the middle");
});

test("the wash is exactly the target band", () => {
  const box = { left: 100, right: 600, width: 500 };
  const { edge } = dropZoneAt(0.1, { edges: true, viewer: true });
  assert.deepEqual(dropWash(box, "left", edge, true), { left: 100, width: 100 });
  assert.deepEqual(dropWash(box, "right", edge, true), { left: 500, width: 100 });
  assert.deepEqual(dropWash(box, "middle", edge, true), { left: 200, width: 300 });
  assert.deepEqual(dropWash(box, "middle", edge, false), { left: 100, width: 500 });
});
