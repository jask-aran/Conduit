import path from "node:path";
import { NODE_TARGETS } from "../device-api.js";

/**
 * The vocabulary is Conduit's own and versioned, so an installed node survives changes to pi-durable's environment
 * API. A write or command carries an `action` id: asked again after a reconnect, the node answers from what it
 * recorded instead of doing it again; another boot has no receipts, so main reports the outcome unknown.
 */
/** A node uses only what is listed, so adding a feature never refuses an older node. The version is for breaking changes. */
export const NODE_FEATURES = ["relay", "capabilities"];

export const NODE_PROTOCOL_VERSION = 1;

export function encode(value) {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Error && value.constructor?.name === "FileError") return { $error: "file", code: value.code, message: value.message, ...(value.path ? { path: value.path } : {}) };
  if (value instanceof Error && value.constructor?.name === "ExecutionError") return { $error: "exec", code: value.code, message: value.message, ...(value.spillPath ? { spillPath: value.spillPath } : {}) };
  if (value instanceof Error) return { $error: "file", code: "unknown", message: value.message };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  return value;
}

export function decode(value, { FileError, ExecutionError, handle = null } = {}) {
  if (Array.isArray(value)) return value.map((item) => decode(item, { FileError, ExecutionError, handle }));
  if (!value || typeof value !== "object") return value;
  if (typeof value.$bytes === "string") return new Uint8Array(Buffer.from(value.$bytes, "base64"));
  if (value.$error === "file") return new FileError(value.code, value.message, value.path);
  if (value.$error === "exec") return Object.assign(new ExecutionError(value.code, value.message), value.spillPath ? { spillPath: value.spillPath } : {});
  if (typeof value.$handle === "string" && handle) return handle(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, { FileError, ExecutionError, handle })]));
}

/**
 * Checked on the node: main asks, the device decides. A method that is not listed is not served. `contents` methods
 * are refused on files the root keeps back.
 */
export const METHOD_GRANTS = Object.freeze({
  absolutePath: { grant: "read", paths: [] },
  joinPath: { grant: "read", paths: [] },
  canonicalPath: { grant: "read", paths: [0] },
  readTextFile: { grant: "read", paths: [0], contents: true },
  openTextLineReader: { grant: "read", paths: [0], contents: true },
  readTextLines: { grant: "read", paths: [0], contents: true },
  readBinaryFile: { grant: "read", paths: [0], contents: true },
  openBinaryReader: { grant: "read", paths: [0], contents: true },
  fileInfo: { grant: "read", paths: [0] },
  listDir: { grant: "read", paths: [0] },
  listFiles: { grant: "read", paths: [0] },
  openDirReader: { grant: "read", paths: [0] },
  exists: { grant: "read", paths: [0] },
  watch: { grant: "read", paths: [] },
  writeFile: { grant: "write", paths: [0], contents: true },
  appendFile: { grant: "write", paths: [0], contents: true },
  truncateFile: { grant: "write", paths: [0], contents: true },
  flushFile: { grant: "write", paths: [0], contents: true },
  renameFile: { grant: "write", paths: [0, 1], contents: true },
  createDir: { grant: "write", paths: [0], contents: true },
  remove: { grant: "write", paths: [0], contents: true },
  // Not served: temporary files go to the device's own temp directory, outside
  // every shared root. A command's own spill files are the device's business.
  exec: { grant: "shell", paths: [] },
});

export function servedCall(target, method) {
  const declared = Object.hasOwn(NODE_TARGETS, target) ? NODE_TARGETS[target] : null;
  if (!declared) return false;
  return declared.methods === "grants" ? Object.hasOwn(METHOD_GRANTS, method) : declared.methods.includes(method);
}

export const HANDLE_METHODS = Object.freeze(["readLine", "read", "scanLines", "info", "next", "close"]);

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export function rootFor(roots, absolute, grant) {
  return roots.find((root) => root[grant] && inside(path.resolve(root.path), absolute)) || null;
}

