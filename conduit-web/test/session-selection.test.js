import assert from "node:assert/strict";
import test from "node:test";
import { sessionIdForLive } from "../src/client/session-selection.js";

test("selects a newly persisted session by its live process", () => {
  const projects = [{
    id: "project_chat",
    sessions: [
      { id: "session_old", liveId: null },
      { id: "session_created", liveId: "live_new" },
    ],
  }];

  assert.equal(sessionIdForLive(projects, "live_new"), "session_created");
  assert.equal(sessionIdForLive(projects, "live_missing"), null);
  assert.equal(sessionIdForLive(projects, ""), null);
});
