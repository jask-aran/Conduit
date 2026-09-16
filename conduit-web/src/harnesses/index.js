import { manifest as codex } from "./codex.js";
import { manifest as chatgptWeb } from "./chatgpt-web.js";
import { manifest as pi } from "./pi.js";

export const NAME_GENERATION_MODES = Object.freeze(["conduit", "backend"]);

// One entry per backend. Registration, the harness catalogue, profile
// selection, thread discovery and detection all read from here, so adding a
// harness is this array plus its module - not seven edits across the server.
export const MANIFESTS = [pi, codex, chatgptWeb];

export const manifestFor = (id) => MANIFESTS.find((manifest) => manifest.id === id) || null;

/** Implementation keys a manifest answers to, defaulting to its own id. */
export const implementationsOf = (manifest) => manifest.implementations || [manifest.id];

const MANIFEST_BY_IMPLEMENTATION = new Map(MANIFESTS.flatMap((manifest) =>
  implementationsOf(manifest).map((implementation) => [implementation, manifest])));

export const manifestForImplementation = (implementation) => MANIFEST_BY_IMPLEMENTATION.get(implementation) || null;
