import { manifest as codex } from "./codex.js";
import { manifest as chatgptWeb } from "./chatgpt-web.js";
import { manifest as claudeCode } from "./claude-code.js";
import { manifest as fx } from "./fx.js";
import { manifest as opencode } from "./opencode.js";
import { manifest as pi } from "./pi.js";
import { manifest as testStream } from "./test-stream.js";

export const NAME_GENERATION_MODES = Object.freeze(["conduit", "backend"]);

// One entry per backend. Registration, the harness catalogue, profile
// selection, thread discovery and detection all read from here, so adding a
// harness is this array plus its module - not seven edits across the server.
export const MANIFESTS = [pi, codex, claudeCode, fx, opencode, chatgptWeb, testStream];

export const manifestFor = (id) => MANIFESTS.find((manifest) => manifest.id === id) || null;

/** Implementation keys a manifest answers to, defaulting to its own id. */
export const implementationsOf = (manifest) => manifest.implementations || [manifest.id];

const MANIFEST_BY_IMPLEMENTATION = new Map(MANIFESTS.flatMap((manifest) =>
  implementationsOf(manifest).map((implementation) => [implementation, manifest])));

export const manifestForImplementation = (implementation) => MANIFEST_BY_IMPLEMENTATION.get(implementation) || null;

/**
 * Whether Conduit has to supply message identity for a chat.
 *
 * A harness that names its own messages the moment they exist needs nothing
 * from Conduit; one that does not gets ids claimed, bound and translated at
 * the adapter boundary. This is a capability a manifest declares, not a
 * question answered by naming one harness, so adding a backend is a manifest
 * entry rather than another equality test spread across the server.
 */
export const conduitOwnsMessageIds = (chat) => {
  const manifest = manifestForImplementation(chat?.backend?.implementation);
  return Boolean(manifest) && manifest.suppliesMessageIds === false;
};

/*
 * `statesTranscript` was here.
 *
 * It asked whether a harness stated its own transcript or left the browser to
 * work one out, because for a while only some of them did. Every adapter does
 * now: an adapter is the thing publishing the events, so it is always the one
 * in a position to say what the transcript holds, and a harness that declined
 * to only meant the client went back to guessing. So it is not a capability a
 * manifest declares -- it is what an adapter is for. What remains is
 * `conduitOwnsMessageIds`, which is a real difference between harnesses: who
 * names a message and who says where it goes are still separate questions.
 */
