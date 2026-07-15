import assert from "node:assert/strict";
import test from "node:test";
import { workingDirectoryCommand } from "../src/workspace-opener.js";

test("chooses the native working-directory opener", () => {
  assert.deepEqual(workingDirectoryCommand("/tmp/project", { platform: "darwin", env: {} }), {
    command: "open",
    args: ["/tmp/project"],
  });
  assert.deepEqual(workingDirectoryCommand("/home/me/project", { platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }), {
    command: "explorer.exe",
    args: ["\\\\wsl.localhost\\Ubuntu\\home\\me\\project"],
  });
  assert.deepEqual(workingDirectoryCommand("/tmp/project", { platform: "linux", env: {} }), {
    command: "xdg-open",
    args: ["/tmp/project"],
  });
});
