import assert from "node:assert/strict";
import test from "node:test";
import { pathChatId, pathProjectId, projectMatchesPath, projectPath } from "../src/client/api/routes.ts";

const engie = { id: "project_8120a2db-899b-41bd-852d-22e1e1222c30", slug: "engie", kind: "project", origin: "managed" };
const conduit = { id: "project_d63f103c-5e28-44cb-ac44-5320e571fe97", slug: "conduit", kind: "workspace", origin: "linked" };

test("a project's address is its name, not its id", () => {
  assert.equal(projectPath(engie), "/project/engie");
  assert.equal(projectPath(conduit), "/workspace/conduit");
  // Nothing without a slug is left without an address.
  assert.equal(projectPath({ id: "project_chat" }), "/project/project_chat");
});

test("a project path reads back whether it names a slug or an id", () => {
  assert.equal(pathProjectId("/project/engie"), "engie");
  assert.equal(pathProjectId("/workspace/conduit"), "conduit");
  assert.equal(pathProjectId(`/project/${engie.id}`), engie.id);
  assert.equal(pathProjectId("/project/"), null);
  assert.equal(pathProjectId("/chat/abcdefgh"), null);
  assert.equal(pathChatId("/project/engie"), null);
});

test("a link minted before slugs still opens its project", () => {
  assert.equal(projectMatchesPath(engie, "engie"), true);
  assert.equal(projectMatchesPath(engie, engie.id), true);
  assert.equal(projectMatchesPath(engie, "japan"), false);
});
