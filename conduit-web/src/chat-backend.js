import { implementationsOf, MANIFESTS } from "./harnesses/index.js";

// Harness-backed profiles come from manifests; Conduit profiles come from
// the template catalogue.
const PROFILE_MANIFESTS = MANIFESTS.filter((manifest) => manifest.profile);

export function harnessIdForImplementation(implementation, installationId = "") {
  if (implementation === "conduit-runtime") return "conduit";
  return implementation || "conduit";
}

/**
 * A Conduit profile's chat (Assistant, Coding, Runtime: a template) runs on
 * the Conduit durable agent (plan milestone 5); the template is the profile.
 */
export function templateBackend(template) {
  return { profileId: template.id, profileRevision: template.version || null, management: "conduit",
    protocol: "native_api", implementation: "conduit-runtime", installationId: "conduit-runtime", opaqueSession: null };
}

/**
 * What each harness can do, keyed by the implementation that names it.
 *
 * Capabilities belong to the harness, not to the profiles that elect it. Four
 * Pi profiles do not have four opinions about whether Pi answers approvals;
 * they have none, because it is not their question. Copying the answer onto
 * each profile invited a profile to disagree with the harness running it, and
 * made callers look capabilities up by the wrong key. Chats already carry
 * backend.implementation, which is exactly the key a manifest is registered
 * under, so this is the join both ends can make.
 */
export function harnessCapabilities() {
  return Object.fromEntries(MANIFESTS.flatMap((manifest) =>
    implementationsOf(manifest).map((implementation) => [implementation, {
      ...manifest.capabilities,
      ...(manifest.serviceLevels ? { serviceLevels: manifest.serviceLevels } : {}),
    }])));
}

export function agentProfiles(templates, { available = null } = {}) {
  const usable = (manifest) => !available || implementationsOf(manifest).some((implementation) => available.has(implementation));
  return [
    ...templates.filter((template) => !template.internal).map((template) => ({
      id: template.id,
      label: template.label,
      management: "conduit",
      agent: { protocol: "native_api", implementation: "conduit-runtime", installationId: "conduit-runtime" },
    })),
    ...PROFILE_MANIFESTS.map((manifest) => ({
      id: manifest.id,
      label: manifest.profileLabel || manifest.label,
      ...(manifest.description ? { description: manifest.description } : {}),
      management: "agent",
      disabled: !usable(manifest),
      drive: manifest.drive === true,
      agent: { protocol: manifest.protocol, implementation: manifest.id, installationId: manifest.installationId },
    })),
  ];
}

/** A request's `profileId` as what the chat routes read: a harness's profile as it is, a template's also as `templateId`. */
export function profileSelection(body = {}) {
  if (body.profileId == null) return body;
  if (typeof body.profileId !== "string" || !body.profileId.trim()) {
    throw Object.assign(new Error("profileId must be a non-empty string"), { code: "invalid_profile", status: 400 });
  }
  const profileId = body.profileId.trim();
  if (PROFILE_MANIFESTS.some((manifest) => manifest.id === profileId)) return { ...body, profileId };
  return { ...body, profileId, templateId: profileId };
}
