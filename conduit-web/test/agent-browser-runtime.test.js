import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeLocalAgentBrowserEnvironment } from "../scripts/agent-browser-runtime.mjs";

test("removes environment overrides that bypass local browser policy", () => {
  const environment = sanitizeLocalAgentBrowserEnvironment({
    AGENT_BROWSER_PROVIDER: "browserbase",
    AGENT_BROWSER_ENABLE: "react-devtools",
    AGENT_BROWSER_ENCRYPTION_KEY: "secret",
    AGENT_BROWSER_SCREENSHOT_DIR: "/outside",
    AGENT_BROWSER_STATE: "/outside/state.json",
    HTTP_PROXY: "http://proxy.example",
    http_proxy: "http://proxy.example",
    NO_PROXY: "example.com",
    no_proxy: "example.com",
    AGENT_BROWSER_SESSION: "keep-this-session",
    PATH: "/usr/bin",
  });
  assert.equal(environment.AGENT_BROWSER_PROVIDER, undefined);
  assert.equal(environment.AGENT_BROWSER_ENABLE, undefined);
  assert.equal(environment.AGENT_BROWSER_ENCRYPTION_KEY, undefined);
  assert.equal(environment.AGENT_BROWSER_SCREENSHOT_DIR, undefined);
  assert.equal(environment.AGENT_BROWSER_STATE, undefined);
  assert.equal(environment.HTTP_PROXY, undefined);
  assert.equal(environment.http_proxy, undefined);
  assert.equal(environment.NO_PROXY, undefined);
  assert.equal(environment.no_proxy, undefined);
  assert.equal(environment.AGENT_BROWSER_SESSION, "keep-this-session");
  assert.equal(environment.PATH, "/usr/bin");
});
