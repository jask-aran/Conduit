import { implementationsOf, manifestForImplementation, MANIFESTS } from "./harnesses/index.js";
export { conduitPiSessionFile, opaqueSessionFor } from "./backend-session.js";

// Harness-backed profiles come from the manifests; Pi profiles come from the
// template catalogue, which is why the built-in Pi manifest is not one of these.
const PROFILE_MANIFESTS = MANIFESTS.filter((manifest) => manifest.profile);

export function harnessIdForImplementation(implementation, installationId = "") {
  if (implementation === "conduit_pi") return "conduit";
  return implementation || "conduit";
}

// Pi identity metadata only. Runtime dispatch still belongs to PiManager.
export function piBackendFor(chat) {
  return {
    profileId: chat.templateId || chat.runtime?.profileId || null,
    profileRevision: chat.templateVersion || chat.runtime?.profileVersion || null,
    management: "conduit",
    protocol: "pi_rpc",
    implementation: "conduit_pi",
    installationId: chat.runtime?.installationId || "conduit-pinned",
    opaqueSession: chat.backend?.implementation === "conduit_pi" ? chat.backend.opaqueSession || null : null,
  };
}

// Convert legacy Pi columns at the registry boundary. Runtime code only reads
// backend.opaqueSession, and the next flush removes the old columns.
export function withPiCompatibilityFields(item) {
  const legacyFile = item.piSessionFile || item.file || null;
  const backend = item.backend || (legacyFile ? piBackendFor(item) : null);
  const { piSessionId: _piSessionId, piSessionFile: _piSessionFile, nativeId: _nativeId, file: _file, ...neutral } = item;
  if (!backend) return neutral;
  if (backend.protocol !== "pi_rpc" || !["conduit_pi", "native_pi"].includes(backend.implementation)) return { ...neutral, backend };
  const native = item.runtime?.kind === "native_pi" || backend.installationId === "host-pi"
    || backend.implementation === "native_pi";
  return {
    ...neutral,
    templateId: item.templateId ?? (native ? null : backend.profileId),
    templateVersion: item.templateVersion ?? backend.profileRevision,
    backend: {
      ...backend,
      management: "conduit",
      implementation: "conduit_pi",
      installationId: "conduit-pinned",
      opaqueSession: backend.opaqueSession || legacyFile,
    },
    runtime: item.runtime ?? {
      kind: "conduit_profile",
      installationId: native ? "conduit-pinned" : backend.installationId,
      profileId: native ? item.templateId || null : backend.profileId,
      profileVersion: native ? item.templateVersion || null : backend.profileRevision,
    },
  };
}

export function agentProfiles(templates, { available = null } = {}) {
  const usable = (manifest) => !available || implementationsOf(manifest).some((implementation) => available.has(implementation));
  // A Pi profile is still served by a harness, so it carries that harness's
  // capabilities like any other. Leaving them off meant the clients using these
  // profiles -- most chats -- had no manifest to consult, and could only learn
  // what the session could do once a process was running and said so. Deriving
  // them from the implementation keeps the two from drifting apart.
  const piCapabilities = manifestForImplementation("conduit_pi")?.capabilities;
  return [
    ...templates.map((template) => ({
      id: template.id,
      label: template.label,
      management: "conduit",
      ...(piCapabilities ? { capabilities: piCapabilities } : {}),
      agent: { protocol: "pi_rpc", implementation: "conduit_pi", installationId: "conduit-pinned" },
    })),
    ...PROFILE_MANIFESTS.map((manifest) => ({
      id: manifest.id,
      label: manifest.profileLabel || manifest.label,
      ...(manifest.description ? { description: manifest.description } : {}),
      management: "agent",
      disabled: !usable(manifest),
      capabilities: manifest.capabilities,
      drive: manifest.drive === true,
      agent: { protocol: manifest.protocol, implementation: manifest.id, installationId: manifest.installationId },
    })),
  ];
}

// Accept the neutral selection while retaining the existing v0 request contract.
export function profileSelection(body = {}) {
  if (body.profileId == null) return body;
  if (typeof body.profileId !== "string" || !body.profileId.trim()) {
    throw Object.assign(new Error("profileId must be a non-empty string"), { code: "invalid_profile", status: 400 });
  }
  const profileId = body.profileId.trim();
  if (profileId === "host-pi") {
    throw Object.assign(new Error("Host Pi is not supported"), { code: "invalid_profile", status: 400 });
  }
  if (PROFILE_MANIFESTS.some((manifest) => manifest.id === profileId)) {
    if (body.runtimeKind != null || body.templateId != null) {
      throw Object.assign(new Error("Profile selection conflicts with legacy fields"), { code: "profile_conflict", status: 400 });
    }
    return { ...body, profileId };
  }
  const runtimeKind = "conduit_profile";
  if ((body.runtimeKind != null && body.runtimeKind !== runtimeKind)
    || (body.templateId != null && body.templateId !== profileId)) {
    throw Object.assign(new Error("Profile selection conflicts with legacy fields"), { code: "profile_conflict", status: 400 });
  }
  return { ...body, runtimeKind, templateId: profileId };
}
