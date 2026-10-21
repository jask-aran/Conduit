/** Return the persisted session reference understood by the selected adapter. */
export function opaqueSessionFor(chat) {
  return chat?.backend?.opaqueSession ?? null;
}

/** Legacy classic Pi chats persisted their opaque reference as a JSONL path. */
export function conduitPiSessionFile(chat) {
  const opaque = chat?.backend?.implementation === "conduit_pi" ? opaqueSessionFor(chat) : null;
  return typeof opaque === "string" && opaque ? opaque : null;
}
