/**
 * A tool call as the History pane lists it -- `[bash: sleep 90]` -- in the same
 * words whichever harness made the call.
 */
export const formatHistoryTool = (name, args = {}) => {
  const path = String(args?.path || args?.file_path || args?.filePath || "").replace(/^\/home\/[^/]+/, "~");
  if (["read", "write", "edit"].includes(name)) return `[${name}: ${path}]`;
  if (name === "bash") {
    const command = String(args?.command || "").replace(/\s+/g, " ").trim();
    return `[bash: ${command.slice(0, 50)}${command.length > 50 ? "..." : ""}]`;
  }
  return `[${name}]`;
};
