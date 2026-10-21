import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { classifyWorkspaceFile, fileRevision, inspectorError, MAX_PREVIEW_BYTES } from "../workspace-inspector.js";
import { RemoteExecutionEnv } from "./remote-env.js";

const MAX_ENTRIES = 500;
const SNIFF_BYTES = 4 * 1024;
const RANKS = { directory: 0, file: 1, other: 2 };

/**
 * A device workspace's files, read for Conduit's own browser and viewer.
 *
 * Read-only in this version (plan decision 17): the tree, a file's metadata,
 * its text and its bytes, in the shapes the local inspector gives, each read
 * through the device. A device that is offline is said so at once rather than
 * waited for -- someone browsing is not a turn that can pause.
 */
export class RemoteWorkspace {
  constructor({ hub, project }) {
    this.hub = hub;
    this.project = project;
    this.env = new RemoteExecutionEnv({ hub, nodeId: project.nodeId, cwd: project.workingRoot });
  }

  context() {
    if (!this.hub.live.get(this.project.nodeId)?.ready) {
      throw Object.assign(inspectorError("device_offline", "The device holding this workspace is offline"), { status: 503 });
    }
    return withAbortSignal(AbortSignal.timeout(30_000), BACKGROUND_CONTEXT);
  }

  relative(input = "") {
    const segments = String(input).replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
    if (segments.includes("..")) throw Object.assign(inspectorError("invalid_path", "Path leaves the workspace"), { status: 400 });
    return segments.join("/");
  }

  static unwrap(result) {
    if (result.ok) return result.value;
    const status = { not_found: 404, permission_denied: 403, is_directory: 400, not_directory: 400 }[result.error.code] || 502;
    throw Object.assign(inspectorError(result.error.code === "not_found" ? "workspace_path_not_found" : result.error.code, result.error.message), { status });
  }

  async list(input, { after = null } = {}) {
    const context = this.context();
    const relative = this.relative(input);
    const found = RemoteWorkspace.unwrap(await this.env.listDir(relative || ".", context));
    const accepted = found.map((entry) => ({ name: entry.name, type: entry.kind === "symlink" ? "other" : entry.kind === "directory" ? "directory" : "file",
      size: entry.kind === "file" ? entry.size : null, modifiedAt: entry.mtimeMs ?? null }));
    const compare = (left, right) => RANKS[left.type] - RANKS[right.type] || left.name.localeCompare(right.name);
    accepted.sort(compare);
    let cursor = null;
    try { cursor = after ? JSON.parse(after) : null; } catch {}
    const remaining = cursor ? accepted.filter((entry) => compare(entry, { type: cursor[0], name: cursor[1] }) > 0) : accepted;
    const entries = remaining.slice(0, MAX_ENTRIES).map((entry) => ({ ...entry, path: relative ? `${relative}/${entry.name}` : entry.name, createdAt: null }));
    const truncated = remaining.length > entries.length;
    return { entries, total: accepted.length, truncated, cursor: truncated ? JSON.stringify([entries.at(-1).type, entries.at(-1).name]) : null, oversize: false };
  }

  async bytes(relative, limit, context) {
    const reader = RemoteWorkspace.unwrap(await this.env.openBinaryReader(relative, {}, context));
    try { return Buffer.from(RemoteWorkspace.unwrap(await reader.read(0, limit, context))); }
    finally { await reader.close(context); }
  }

  async metadata(input) {
    const context = this.context();
    const relative = this.relative(input);
    const info = RemoteWorkspace.unwrap(await this.env.fileInfo(relative, context));
    if (info.kind !== "file") throw Object.assign(inspectorError("workspace_path_not_file", "Not a file"), { status: 400 });
    const prefix = await this.bytes(relative, Math.min(SNIFF_BYTES, info.size), context);
    return { path: relative, size: info.size, createdAt: null, modifiedAt: info.mtimeMs,
      revision: fileRevision(Buffer.from(`${info.size}:${info.mtimeMs}`)), ...classifyWorkspaceFile(relative, prefix), head: prefix.subarray(0, 32).toString("hex") };
  }

  async read(input, { forceText = false, preview = false } = {}) {
    const metadata = await this.metadata(input);
    if (!forceText && metadata.kind !== "text") throw Object.assign(inspectorError("file_not_text", "Binary files cannot be previewed"), metadata);
    if (metadata.size > MAX_PREVIEW_BYTES && !preview && !forceText) throw Object.assign(inspectorError("file_too_large", "File is larger than the 25 MiB preview limit"), metadata);
    const content = await this.bytes(metadata.path, Math.min(metadata.size, MAX_PREVIEW_BYTES), this.context());
    return { ...metadata, revision: fileRevision(content), content: content.toString("utf8"),
      truncated: metadata.size > MAX_PREVIEW_BYTES,
      // Read-only: a device's files are not edited from here yet.
      readOnly: true };
  }

  async download(input) {
    const metadata = await this.metadata(input);
    if (metadata.size > MAX_PREVIEW_BYTES) throw Object.assign(inspectorError("file_too_large", "File is too large to open from a device"), { status: 413 });
    return { metadata, content: await this.bytes(metadata.path, metadata.size, this.context()) };
  }
}
