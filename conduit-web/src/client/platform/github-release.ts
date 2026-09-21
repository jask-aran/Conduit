export const RELEASES_API = "https://api.github.com/repos/jask-aran/Conduit/releases/latest";

export interface PublishedRelease {
  tag: string;
  version: string;
  apkUrl: string | null;
}

/** Version numbers only: a tag may be written `v0.7.1`, a manifest `0.7.1`. */
function parts(version: string): number[] {
  return version.replace(/^v/, "").split(/[.\-+]/).map((part) => Number.parseInt(part, 10)).map((part) => Number.isNaN(part) ? 0 : part);
}

/**
 * Whether `candidate` is a version to move to. Equal is not newer: an update
 * offered for the version already running is an update that does nothing.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parts(candidate);
  const right = parts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference > 0;
  }
  return false;
}

/**
 * The latest published release, as GitHub describes it. Read anonymously --
 * the repository is public and this is the same document a browser would be
 * shown -- so nothing here carries a Conduit token to a third party.
 */
export async function latestRelease(fetchImpl: typeof fetch = fetch): Promise<PublishedRelease | null> {
  const response = await fetchImpl(RELEASES_API, { headers: { accept: "application/vnd.github+json" } });
  if (!response.ok) return null;
  const body = await response.json() as { tag_name?: unknown; assets?: unknown };
  const tag = typeof body.tag_name === "string" ? body.tag_name : "";
  if (!tag) return null;
  const assets = Array.isArray(body.assets) ? body.assets as Array<{ name?: unknown; browser_download_url?: unknown }> : [];
  const apk = assets.find((asset) => typeof asset.name === "string" && asset.name.endsWith(".apk"));
  return {
    tag,
    version: tag.replace(/^v/, ""),
    apkUrl: apk && typeof apk.browser_download_url === "string" ? apk.browser_download_url : null,
  };
}
