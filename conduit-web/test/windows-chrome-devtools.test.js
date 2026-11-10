import assert from "node:assert/strict";
import test from "node:test";
import { cookieParams } from "../../scripts/windows-chrome-devtools.mjs";

test("session cookie params stay on local Conduit", () => {
  assert.deepEqual(cookieParams("token-1"), {
    name: "conduit_session",
    value: "token-1",
    url: "http://127.0.0.1:4310/",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  });
  assert.throws(() => cookieParams("token-1", "https://example.com"), /only accepts/);
});
