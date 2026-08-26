import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_DIR,
  buildChromeLaunchArgs,
  chromeDevtoolsEnv,
  cookieParams,
  cookieValue,
  resolveChromeExecutable,
  resolveUserDataDir,
} from "../../scripts/windows-chrome-devtools.mjs";

test("resolves Windows Chrome and a dedicated user-data dir", () => {
  const chrome = resolveChromeExecutable({
    env: { CONDUIT_WINDOWS_CHROME: "C:\\Chrome\\chrome.exe" },
    exists: () => true,
  });
  assert.equal(chrome, "C:\\Chrome\\chrome.exe");
  const userDataDir = resolveUserDataDir({
    env: { CONDUIT_WINDOWS_LOCALAPPDATA: "C:\\Users\\jaska\\AppData\\Local" },
  });
  assert.equal(userDataDir, "C:\\Users\\jaska\\AppData\\Local\\Conduit\\chrome-agent");
  assert.deepEqual(
    buildChromeLaunchArgs({ port: 9222, userDataDir }),
    [
      "--remote-debugging-port=9222",
      "--user-data-dir=C:\\Users\\jaska\\AppData\\Local\\Conduit\\chrome-agent",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "about:blank",
    ],
  );
});

test("pins the DevTools runtime dir and reads the session cookie", () => {
  const env = chromeDevtoolsEnv({ PATH: "/bin" });
  assert.equal(env.XDG_RUNTIME_DIR, RUNTIME_DIR);
  assert.equal(cookieValue({ cookies: [{ name: "other", value: "x" }] }), null);
  assert.equal(
    cookieValue({ cookies: [{ name: "conduit_session", value: "tok" }] }),
    "tok",
  );
});

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
