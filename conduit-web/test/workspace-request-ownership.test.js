import assert from "node:assert/strict";
import test from "node:test";
import { ownsWorkspaceRequest } from "../src/client/workspace/request-ownership.ts";

test("a completed Workspace request owns only its original project and version", () => {
  const first = { projectId: "project_chat", version: 1 };
  const current = { projectId: "project_jasknem", version: 2 };

  assert.equal(ownsWorkspaceRequest(current, first), false);
  assert.equal(ownsWorkspaceRequest(current, current), true);
  assert.equal(ownsWorkspaceRequest({ projectId: "project_jasknem", version: 3 }, current), false);
});
