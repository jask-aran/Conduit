import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { buildMaterialIconManifest } from "../scripts/material-icon-manifest.mjs";

const manifest = buildMaterialIconManifest();
// Supply the same build-time manifest that Vite gives the app's v2 module.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "virtual:material-icon-manifest") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(manifest)}`)}` };
    }
    return nextResolve(specifier, context);
  },
});
let icons;
try {
  icons = await import("../src/components/ui/material-file-icons.ts");
} finally {
  hooks.deregister();
}
const { materialFileIconAsset, materialFolderIconAsset, materialIconLookup } = icons;

test("Material Icon Theme resolves files, compound extensions, and DAX", () => {
  for (const extension of ["csv", "txt", "dax", "test.ts"]) {
    const icon = manifest.fileExtensions[extension];
    assert.ok(icon, extension);
    assert.ok(manifest.icons[icon], icon);
    assert.equal(materialFileIconAsset(`report.${extension}`), manifest.icons[icon]);
  }
  assert.ok(manifest.fileNames["readme.md"]);
  assert.equal(materialFileIconAsset("README.md"), manifest.icons[manifest.fileNames["readme.md"]]);
  assert.equal(materialFileIconAsset("unknown.extension"), manifest.icons[manifest.file]);

  const lookup = materialIconLookup({
    ...manifest,
    fileNames: { "widget.test.ts": "named" },
    fileExtensions: { "test.ts": "compound", ts: "simple" },
    icons: { ...manifest.icons, named: "named.svg", compound: "compound.svg", simple: "simple.svg" },
  });
  assert.equal(lookup.materialFileIconAsset("folder/WIDGET.TEST.TS"), "named.svg");
  assert.equal(lookup.materialFileIconAsset("folder\\other.test.ts"), "compound.svg");
  assert.equal(lookup.materialFileIconAsset("other.ts"), "simple.svg");
});

test("Material Icon Theme resolves named and open folders", () => {
  assert.ok(manifest.folderNames.src);
  assert.ok(manifest.folderNamesExpanded.src);
  assert.equal(materialFolderIconAsset("src", false), manifest.icons[manifest.folderNames.src]);
  assert.equal(materialFolderIconAsset("src", true), manifest.icons[manifest.folderNamesExpanded.src]);
  assert.equal(materialFolderIconAsset("unknown", false), manifest.icons[manifest.folder]);
  assert.equal(materialFolderIconAsset("unknown", true), manifest.icons[manifest.folderExpanded]);
});
