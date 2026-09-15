/** Return the persisted session reference understood by the selected adapter. */
export function opaqueSessionFor(chat) {
  return chat?.backend?.opaqueSession ?? null;
}

/** Conduit Pi currently persists its opaque reference as a JSONL file path. */
export function conduitPiSessionFile(chat) {
  const opaque = chat?.backend?.implementation === "conduit_pi" ? opaqueSessionFor(chat) : null;
  return typeof opaque === "string" && opaque ? opaque : null;
}
