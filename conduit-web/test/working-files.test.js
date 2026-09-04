import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("managed Python project includes the advertised working-file libraries", async () => {
  const project = await fs.readFile(path.join(root, "working-files/pyproject.toml"), "utf8");
  for (const dependency of [
    "odfpy",
    "openpyxl",
    "pandas",
    "pyarrow",
    "pymupdf",
    "pypdf",
    "python-docx",
    "python-pptx",
    "pyxlsb",
    "xlrd",
  ]) {
    assert.match(project, new RegExp(`"${dependency}"`));
  }
});

test("source setup bootstraps pinned uv and managed Python", async () => {
  const shell = await fs.readFile(path.join(root, ".devcontainer/start-conduit.sh"), "utf8");
  const powershell = await fs.readFile(path.join(root, ".devcontainer/win-start-conduit.ps1"), "utf8");
  for (const launcher of [shell, powershell]) {
    assert.match(launcher, /0\.11\.29/);
    assert.match(launcher, /astral\.sh\/uv/);
    assert.match(launcher, /UV_UNMANAGED_INSTALL/);
    assert.match(launcher, /UV_PYTHON_INSTALL_DIR/);
    assert.match(launcher, /--python 3\.13/);
    assert.match(launcher, /--managed-python/);
  }
});
