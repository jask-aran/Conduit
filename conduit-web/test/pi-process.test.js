import assert from "node:assert/strict";
import test from "node:test";
import { resolvePiProcess } from "../../scripts/pi-runtime.mjs";

test("Windows runs JavaScript Pi entry points through Node", () => {
  assert.deepEqual(resolvePiProcess("C:/conduit/pi/dist/cli.js", ["--mode", "rpc"], {
    platform: "win32",
    nodePath: "C:/Program Files/nodejs/node.exe",
  }), {
    command: "C:/Program Files/nodejs/node.exe",
    args: ["C:/conduit/pi/dist/cli.js", "--mode", "rpc"],
  });
});

test("native Pi commands are unchanged on Windows", () => {
  assert.deepEqual(resolvePiProcess("C:/conduit/pi/pi.exe", ["--mode", "rpc"], {
    platform: "win32",
    nodePath: "C:/Program Files/nodejs/node.exe",
  }), {
    command: "C:/conduit/pi/pi.exe",
    args: ["--mode", "rpc"],
  });
});
