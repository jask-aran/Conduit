import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createEffect, createRoot, createSignal, on, onCleanup } from "solid-js/dist/solid.js";

// Run the page's actual home-thread effect without mounting the app or its UI.
const source = fs.readFileSync(new URL("../src/client/main.tsx", import.meta.url), "utf8");
const start = source.indexOf("    let loading: string | null = null;", source.indexOf("const renderAgent ="));
assert.ok(start >= 0);
const end = source.indexOf("    // The page shows none of the thread:", start);
assert.ok(end > start);
const mount = new Function("createEffect", "on", "onCleanup", "agentView", "current", "agentChat", "showError",
  stripTypeScriptTypes(source.slice(start, end)));

function page(loaded = "home") {
  const [loadedId, setLoadedId] = createSignal(loaded);
  const [navigatingId, setNavigatingId] = createSignal(null);
  const selected = [];
  const errors = [];
  const lookups = [];
  let dispose;
  createRoot((cleanup) => {
    dispose = cleanup;
    mount(createEffect, on, onCleanup, () => ({ home: { chatId: "home" } }), {
      chat: { loadedId, navigatingId, select: async (chat) => { selected.push(chat.id); setLoadedId(chat.id); } },
    }, () => new Promise((resolve) => lookups.push(resolve)), (error) => errors.push(error));
  });
  return { dispose, setLoadedId, setNavigatingId, selected, errors, lookups };
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
const home = { chat: { id: "home" }, project: { id: "agent" } };

test("opening a run does not reselect home when active-chat reset clears loadedId", async () => {
  const state = page();
  try {
    state.setNavigatingId("run");
    state.setLoadedId(null);
    state.dispose(); // The route commit unmounts the agent page.
    state.setLoadedId("run");
    state.setNavigatingId(null);
    for (const resolve of state.lookups) resolve(home);
    await flush();
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.selected, []);
    assert.equal(state.lookups.length, 0);
  } finally { state.dispose(); }
});

test("a pending home lookup cannot select after the agent page closes", async () => {
  const state = page(null);
  try {
    assert.equal(state.lookups.length, 1);
    state.dispose();
    state.setLoadedId("run");
    state.lookups[0](home);
    await flush();
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.selected, []);
  } finally { state.dispose(); }
});

test("a pending home lookup cannot replace a run selection before its route commits", async () => {
  const state = page(null);
  try {
    state.setNavigatingId("run");
    state.lookups[0](home);
    await flush();
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.selected, []);
  } finally { state.dispose(); }
});

test("the agent page still restores home after its session is cleared", async () => {
  const state = page();
  try {
    state.setLoadedId(null);
    assert.equal(state.lookups.length, 1);
    state.lookups[0](home);
    await flush();
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.selected, ["home"]);
  } finally { state.dispose(); }
});
