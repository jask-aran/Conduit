import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("managed component workbench exposes source development, manual validation, packed preview, and promotion", async () => {
  const workbench = await fs.readFile(
    path.join(root, "scripts", "solid-components-workbench.mjs"),
    "utf8",
  );

  assert.match(workbench, /case "dev"/);
  assert.match(workbench, /case "serve"/);
  assert.match(workbench, /case "preview"/);
  assert.match(workbench, /case "promote"/);
  assert.match(workbench, /case "registry"/);
  assert.match(workbench, /"pack", "--json", "--ignore-scripts", "--pack-destination"/);
  assert.match(workbench, /hashDirectory\(path\.join\(packageRoot, "dist"\)\)/);
  assert.match(workbench, /Candidate HEAD changed after preview/);
  assert.match(workbench, /--follow-tags/);
  assert.match(workbench, /npm", \["install", "--save-exact"/);
});

test("the ordinary managed server refuses to clobber an active component mode", async () => {
  const launcher = await fs.readFile(
    path.join(root, ".devcontainer", "start-conduit.sh"),
    "utf8",
  );

  assert.match(launcher, /solid-components-workbench\.json/);
  assert.match(launcher, /guard_component_mode/);
  assert.match(launcher, /solid-components\.sh registry/);
  assert.match(launcher, /setup\) guard_component_mode; setup/);
  assert.match(launcher, /deploy\)\n\s+guard_component_mode/);
  assert.match(launcher, /pushd "\$WEB_DIR"/);
});

test("the public component command remains a thin executable wrapper", async () => {
  const wrapper = path.join(root, ".devcontainer", "solid-components.sh");
  const contents = await fs.readFile(wrapper, "utf8");
  const stats = await fs.stat(wrapper);

  assert.match(contents, /scripts\/solid-components-workbench\.mjs/);
  assert.ok(stats.mode & 0o111, ".devcontainer/solid-components.sh must be executable");
});
