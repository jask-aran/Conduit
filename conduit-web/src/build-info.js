import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const git = (...args) => {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
};

/** Artifact metadata, never user data. Dev versions follow the Windows updater convention. */
export function buildStamp(env = process.env, now = new Date()) {
  try { return JSON.parse(readFileSync(new URL("../../BUILD.json", import.meta.url), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const commit = (env.GITHUB_SHA || git("rev-parse", "HEAD")).slice(0, 12) || "unknown";
  const release = env.CONDUIT_RELEASE_TAG || (env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME : "") || "";
  const last = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*") || "v0.0.0";
  const [major, minor, patch] = last.replace(/^v/, "").split(".").map(Number);
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const version = env.CONDUIT_BUILD_VERSION || release.replace(/^v/, "")
    || `${major || 0}.${minor || 0}.${(patch || 0) + 1}-dev.${timestamp}.${commit.slice(0, 7)}`;
  const dirty = !release && Boolean(git("status", "--porcelain", "--untracked-files=no"));
  return { version, commit, release, builtAt: now.toISOString(), dirty };
}

export function buildLabel(build) {
  const label = build.release || build.version;
  return `${label}${build.release || !label.endsWith(build.commit.slice(0, 7)) ? ` · ${build.commit}` : ""}${build.dirty ? " · modified" : ""}`;
}
