import { TestStreamAdapter, TEST_STREAM_CAPABILITIES } from "../test-stream-adapter.js";
import { READY } from "./probe.js";

// It answers every prompt itself, at a rate the model picker chooses, so the live path can be watched under steady
// pressure without a provider deciding how fast today is.
export const manifest = {
  id: "test-stream",
  label: "Render test",
  profileLabel: "Render test profile",
  description: "A synthetic backend that streams tokens, or replays a real reply, at a fixed rate, for profiling the transcript",
  protocol: "native_api",
  installationId: "conduit-test-stream",
  capabilities: TEST_STREAM_CAPABILITIES,
  // Nothing on the machine to find, and no threads of its own to enumerate.
  discovery: "none",
  // No process to start: a chat is usable the moment it is selected.
  warm: "none",
  nameGeneration: "conduit",
  drive: false,
  profile: true,
  builtIn: true,
  probe: () => READY(),
  build: (config) => new TestStreamAdapter({ dataDir: config.testStreamDataDir, logs: config.logs }),
};
