// Pi identity metadata only. Runtime dispatch still belongs to PiManager.
export function piBackendFor(chat) {
  const native = chat.runtime?.kind === "native_pi";
  return {
    profileId: native ? "host-pi" : chat.templateId || chat.runtime?.profileId || null,
    profileRevision: native ? null : chat.templateVersion || chat.runtime?.profileVersion || null,
    management: native ? "agent" : "conduit",
    protocol: "pi_rpc",
    implementation: native ? "native_pi" : "conduit_pi",
    installationId: native ? "host-pi" : chat.runtime?.installationId || "conduit-pinned",
    opaqueSession: chat.piSessionFile || null,
  };
}

// Read neutral rows through the current Pi execution fields during slice 2.
export function withPiCompatibilityFields(item) {
  const backend = item.backend;
  if (!backend) return item;
  if (backend.protocol !== "pi_rpc" || !["conduit_pi", "native_pi"].includes(backend.implementation)) {
    throw Object.assign(new Error("Unsupported persisted chat backend"), { code: "unsupported_backend" });
  }
  const native = backend.implementation === "native_pi";
  return {
    ...item,
    templateId: item.templateId ?? (native ? null : backend.profileId),
    templateVersion: item.templateVersion ?? backend.profileRevision,
    piSessionFile: item.piSessionFile ?? backend.opaqueSession,
    runtime: item.runtime ?? {
      kind: native ? "native_pi" : "conduit_profile",
      installationId: backend.installationId,
      profileId: native ? null : backend.profileId,
      profileVersion: native ? null : backend.profileRevision,
    },
  };
}

export function agentProfiles(templates) {
  return [
    ...templates.map((template) => ({
      id: template.id,
      label: template.label,
      management: "conduit",
      agent: { protocol: "pi_rpc", implementation: "conduit_pi", installationId: "conduit-pinned" },
    })),
    {
      id: "host-pi",
      label: "Host Pi",
      management: "agent",
      agent: { protocol: "pi_rpc", implementation: "native_pi", installationId: "host-pi" },
    },
  ];
}

// Accept the neutral selection while retaining the existing v0 request contract.
export function profileSelection(body = {}) {
  if (body.profileId == null) return body;
  if (typeof body.profileId !== "string" || !body.profileId.trim()) {
    throw Object.assign(new Error("profileId must be a non-empty string"), { code: "invalid_profile", status: 400 });
  }
  const profileId = body.profileId.trim();
  const runtimeKind = profileId === "host-pi" ? "native_pi" : "conduit_profile";
  if ((body.runtimeKind != null && body.runtimeKind !== runtimeKind)
    || (profileId !== "host-pi" && body.templateId != null && body.templateId !== profileId)) {
    throw Object.assign(new Error("Profile selection conflicts with legacy fields"), { code: "profile_conflict", status: 400 });
  }
  return { ...body, runtimeKind, ...(profileId === "host-pi" ? {} : { templateId: profileId }) };
}
