import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  hashDirectory,
  localTypeScriptConfig,
  resolveSolidComponents,
  SOLID_COMPONENTS_PACKAGE,
  solidComponentsViteOptions,
} from "../scripts/solid-components-mode.mjs";

async function makePackage(root, name = SOLID_COMPONENTS_PACKAGE) {
  await fs.mkdir(path.join(root, "src", "meteor-shower"), { recursive: true });
  await fs.mkdir(path.join(root, "dist", "meteor-shower"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name, version: "1.2.3" }));
  await fs.writeFile(path.join(root, "src", "meteor-shower", "index.ts"), "export const value = 1;\n");
  await fs.writeFile(path.join(root, "src", "meteor-shower", "meteor-shower.css"), ".source {}\n");
  await fs.writeFile(path.join(root, "dist", "meteor-shower", "index.js"), "export const value = 1;\n");
  await fs.writeFile(path.join(root, "dist", "meteor-shower", "index.d.ts"), "export declare const value = 1;\n");
  await fs.writeFile(path.join(root, "dist", "meteor-shower.css"), ".preview {}\n");
}

test("source and preview modes resolve exact package exports", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-components-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await makePackage(root);

  const source = resolveSolidComponents(root, "source");
  const preview = resolveSolidComponents(root, "preview");

  assert.equal(source.aliases[0].find, `${SOLID_COMPONENTS_PACKAGE}/meteor-shower.css`);
  assert.match(source.modulePath, /src\/meteor-shower\/index\.ts$/);
  assert.match(preview.modulePath, /dist\/meteor-shower\/index\.js$/);
  assert.match(preview.typesPath, /dist\/meteor-shower\/index\.d\.ts$/);
});

test("local mode fails closed for incomplete or unrelated packages", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-components-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await makePackage(root, "@someone/other-package");

  assert.throws(() => resolveSolidComponents(root, "source"), /Expected @jask-aran\/solid-components/);
  assert.throws(
    () => solidComponentsViteOptions({ CONDUIT_SOLID_COMPONENTS_MODE: "source" }),
    /must be set together/,
  );
});

test("directory hashes are deterministic and content-sensitive", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-components-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "b.txt"), "second");
  await fs.writeFile(path.join(root, "a.txt"), "first");

  const first = await hashDirectory(root);
  assert.equal(await hashDirectory(root), first);
  await fs.writeFile(path.join(root, "a.txt"), "changed");
  assert.notEqual(await hashDirectory(root), first);
});

test("generated typecheck config resolves package declarations without changing the project config", () => {
  const config = localTypeScriptConfig({
    conduitWebRoot: "/work/conduit-web",
    resolution: { typesPath: "/work/solid-components/dist/meteor-shower/index.d.ts" },
  });

  assert.equal(
    config.compilerOptions.paths[`${SOLID_COMPONENTS_PACKAGE}/meteor-shower`][0],
    "/work/solid-components/dist/meteor-shower/index.d.ts",
  );
  assert.deepEqual(config.compilerOptions.paths["@/*"], ["/work/conduit-web/src/*"]);
  assert.equal("baseUrl" in config.compilerOptions, false);
});
