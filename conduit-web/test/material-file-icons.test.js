import assert from "node:assert/strict";
import test from "node:test";
import {
  materialFileIconAsset,
  materialFolderIconAsset,
} from "../src/client/workspace/material-file-icons.ts";

test("Material Icon Theme resolves files, compound extensions, and DAX", () => {
  assert.equal(materialFileIconAsset("report.csv"), "table.svg");
  assert.equal(materialFileIconAsset("notes.txt"), "document.svg");
  assert.equal(materialFileIconAsset("measure.dax"), "table.svg");
  assert.equal(materialFileIconAsset("README.md"), "readme.svg");
  assert.equal(materialFileIconAsset("widget.test.ts"), "test-ts.svg");
  assert.equal(materialFileIconAsset("unknown.extension"), "file.svg");
});

test("Material Icon Theme resolves named and open folders", () => {
  assert.equal(materialFolderIconAsset("src", false), "folder-src.svg");
  assert.equal(materialFolderIconAsset("src", true), "folder-src-open.svg");
  assert.equal(materialFolderIconAsset("unknown", false), "folder.svg");
  assert.equal(materialFolderIconAsset("unknown", true), "folder-open.svg");
});
