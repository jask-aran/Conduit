import { PiRpcAdapter, PI_CAPABILITIES } from "../pi-rpc-adapter.js";
import { READY } from "./probe.js";

// Pi is the built-in backend: Conduit ships it, so it is always available and
// needs no probe. One adapter serves both implementations - a Conduit-managed
// profile and the host's own Pi - which is why this manifest names two.
export const manifest = {
  id: "conduit-pi",
  label: "Conduit Pi",
  implementations: ["conduit_pi", "native_pi"],
  protocol: "pi_rpc",
  installationId: "conduit-pinned",
  capabilities: PI_CAPABILITIES,
  discovery: "none",
  drive: false,
  // Pi profiles come from the template catalogue rather than this manifest.
  profile: false,
  builtIn: true,
  probe: () => READY(),
  build: (config) => new PiRpcAdapter(config.manager),
};
