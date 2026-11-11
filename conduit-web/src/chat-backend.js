import { implementationsOf, MANIFESTS } from "./harnesses/index.js";

const PROFILE_MANIFESTS = MANIFESTS.filter((manifest) => manifest.profile);

export function harnessIdForImplementation(implementation, installationId = "") {
  if (implementation === "conduit-runtime") return "conduit";
  return implementation || "conduit";
}

export function templateBackend(template) {
  return { profileId: template.id, profileRevision: template.version || null, management: "conduit",
    protocol: "native_api", implementation: "conduit-runtime", installationId: "conduit-runtime", opaqueSession: null };
}

/**
 * Capabilities belong to the harness, not to the profiles that elect it, so a profile cannot disagree with the harness
 * running it. Keyed by backend.implementation, which chats carry and manifests are registered under.
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

export function profileSelection(body = {}) {
  if (body.profileId == null) return body;
  if (typeof body.profileId !== "string" || !body.profileId.trim()) {
    throw Object.assign(new Error("profileId must be a non-empty string"), { code: "invalid_profile", status: 400 });
  }
  const profileId = body.profileId.trim();
  if (PROFILE_MANIFESTS.some((manifest) => manifest.id === profileId)) return { ...body, profileId };
  return { ...body, profileId, templateId: profileId };
}
