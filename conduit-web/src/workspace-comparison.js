import fs from "node:fs/promises";
import { resolveInspectorPath, runBoundedGit } from "./workspace-inspector.js";

const MAX_BYTES = 1024 * 1024;
const absent = (id) => !id || /^0+$/.test(id);

// Resolve object IDs before reading content: staged comparisons must never use
// the working copy, and a missing revision must not hide a Git read failure.
export async function readWorkspaceComparison(root, filePath, { staged = false, signal } = {}) {
  const resolved = await resolveInspectorPath(root, "", { kind: "directory" });
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0") || filePath.includes("\\") || filePath.split("/").some((part) => !part || part === "." || part === "..") || filePath === ".conduit" || filePath.startsWith(".conduit/")) {
    throw new Error("Invalid comparison path");
  }
  const git = (args, maxBuffer = MAX_BYTES) => runBoundedGit(resolved.path, args, { signal, maxBuffer });
  const [{ stdout: raw }, { stdout: index }] = await Promise.all([
    git(["diff", ...(staged ? ["--cached"] : []), "--relative", "--raw", "-z", "--no-abbrev", "--find-renames", "--no-ext-diff", "--no-textconv"]),
    git(["ls-files", "--stage", "-z", "--", `:(literal)${filePath}`]),
  ]);
  const records = raw.split("\0");
  let change;
  for (let i = 0; i < records.length && records[i];) {
    const [oldMode, newMode, oldId, newId, status] = records[i++].slice(1).split(" ");
    const oldPath = records[i++];
    const newPath = /^[RC]/.test(status) ? records[i++] : oldPath;
    if (newPath === filePath) change = { oldMode, newMode, oldId, newId, oldPath, status };
    else if (status.startsWith("R") && oldPath === filePath) change = { oldMode, newMode: "000000", oldId, newId: "0", oldPath, status: "D" };
  }
  const entries = index.split("\0").filter(Boolean);
  const entry = entries.find((item) => item.slice(item.indexOf("\t") + 1) === filePath);
  const [mode, id, stage] = entry?.split("\t")[0].split(" ") ?? [];
  const base = { path: filePath, oldPath: change?.oldPath ?? filePath, staged };
  const unavailable = (message) => ({ ...base, kind: "unavailable", message });
  if (change?.status === "U" || (stage && stage !== "0")) return unavailable("Resolve this file's merge conflict before comparing it.");
  if ([mode, change?.oldMode, change?.newMode].some((value) => value && value !== "000000" && !/^100/.test(value))) return unavailable("Comparison is available for regular text files only.");
  const readObject = async (objectId) => {
    if (absent(objectId)) return "";
    const { stdout: size } = await git(["cat-file", "-s", objectId]);
    if (Number(size) > MAX_BYTES) throw new Error("comparison_size_limit");
    return (await git(["cat-file", "blob", objectId])).stdout;
  };
  const readWorkingCopy = async () => {
    let file;
    try { file = await resolveInspectorPath(resolved.path, filePath, { kind: "file" }); }
    catch (error) { if (error.code === "path_not_found") return ""; throw error; }
    if (file.stat.size > MAX_BYTES) throw new Error("comparison_size_limit");
    const handle = await fs.open(file.path, "r");
    try {
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES) throw new Error("comparison_size_limit");
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally { await handle.close(); }
  };
  try {
    const [original, modified] = await Promise.all([
      readObject(change ? change.oldId : id),
      staged ? readObject(change ? change.newId : id) : readWorkingCopy(),
    ]);
    if ([original, modified].some((text) => text.includes("\0") || text.includes("\ufffd"))) return unavailable("Binary or non-UTF-8 files cannot be shown as a text comparison.");
    return { ...base, kind: "text", original, modified };
  } catch (error) {
    if (error.message === "comparison_size_limit" || error.code === "workspace_git_output_limit") return unavailable("This file exceeds the 1 MiB comparison limit. Open it in Files to view it.");
    throw error;
  }
}
