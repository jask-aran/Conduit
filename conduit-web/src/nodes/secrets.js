import path from "node:path";

/**
 * Names still list, and shell is unaffected: it has the device user's full access. Patterns match case-insensitively,
 * since a Windows or macOS disk would otherwise let `.ENV` through.
 */
export const DEFAULT_DENY = Object.freeze([
  ".env", ".env.*",
  "*.pem", "*.key", "*.p12", "*.pfx", "*.keystore", "*.jks",
  "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*",
  ".ssh/", ".gnupg/", ".aws/", ".azure/", ".kube/", ".docker/",
  ".netrc", ".git-credentials", ".npmrc", ".pypirc", ".pgpass",
  "*.kdbx", "credentials.json", "service-account*.json",
]);

// Templates of secrets are not secrets: `.env.example` stays readable.
const DEFAULT_ALLOW = Object.freeze(["*.example", "*.sample", "*.template", "*.pub"]);

const compiled = new Map();
function matcher(pattern) {
  if (!compiled.has(pattern)) {
    const directory = pattern.endsWith("/");
    const body = pattern.replace(/\/$/, "").split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    compiled.set(pattern, { directory, test: new RegExp(`^${body}$`, "i") });
  }
  return compiled.get(pattern);
}

const matches = (patterns, segments) => patterns.some((pattern) => {
  const { directory, test } = matcher(pattern);
  // A directory pattern matches any segment (the folder and all under it); a
  // file pattern only the last.
  return directory ? segments.some((segment) => test.test(segment)) : test.test(segments.at(-1) || "");
});

export function rootDeny(root) {
  return { deny: [...DEFAULT_DENY, ...(root.deny || [])], allow: [...DEFAULT_ALLOW, ...(root.allow || [])] };
}

/** Whether `absolute`, inside `root` (both real paths), is kept back. */
export function keptBack(root, absolute) {
  const segments = path.relative(root.path, absolute).split(/[\\/]/).filter(Boolean);
  if (!segments.length) return false;
  const { deny, allow } = root.secrets || rootDeny(root);
  return matches(deny, segments) && !matches(allow, segments);
}
