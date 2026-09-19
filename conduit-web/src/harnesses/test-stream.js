import { TestStreamAdapter, TEST_STREAM_CAPABILITIES } from "../test-stream-adapter.js";
import { READY } from "./probe.js";

// A backend with no backend behind it: it answers every prompt itself, at a
// rate the model picker chooses, so the live path can be watched under steady
// pressure without a provider deciding how fast today is.
//
// Built in and always available, like Pi, because there is nothing to install
// and nothing to detect. It costs a manifest entry and an adapter; whether it
// is offered at all is the `profile` flag below.
export const manifest = {
  id: "test-stream",
  label: "Test stream",
  profileLabel: "Test profile",
  description: "A synthetic backend that streams tokens at a fixed rate, for profiling the transcript",
  protocol: "native_api",
  installationId: "conduit-test-stream",
  capabilities: TEST_STREAM_CAPABILITIES,
  // Nothing on the machine to find, and no threads of its own to enumerate.
  discovery: "none",
  // No process to start: a chat is usable the moment it is selected.
  warm: "none",
  nameGeneration: "conduit",
  // It names its own messages before it writes a word of them.
  suppliesMessageIds: true,
  drive: false,
  profile: true,
  builtIn: true,
  probe: () => READY(),
  build: (config) => new TestStreamAdapter({ logs: config.logs }),
};
