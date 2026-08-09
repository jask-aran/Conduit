export const DEFAULT_CONDUIT_ORIGIN = "http://127.0.0.1:4310";
const ALLOWED_HOSTS = new Set(["127.0.0.1", "0.0.0.0"]);
const LOCAL_PATH_PREFIXES = ["/", "./", "../", "?", "#"];

function isLocalRelativeUrl(rawUrl) {
  return LOCAL_PATH_PREFIXES.some((prefix) => rawUrl.startsWith(prefix));
}

export function resolveLocalBrowserUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    throw new Error("Conduit QA requires a local Conduit URL");
  }

  const candidate = new URL(rawUrl, DEFAULT_CONDUIT_ORIGIN);
  if (!isLocalRelativeUrl(rawUrl) && !/^https?:\/\//i.test(rawUrl)) {
    throw new Error("Conduit QA requires a local Conduit URL");
  }

  return resolveLocalTarget({
    rawOrigin: candidate.origin,
    rawPath: `${candidate.pathname}${candidate.search}${candidate.hash}`,
  });
}

export function resolveLocalTarget({
  rawOrigin = DEFAULT_CONDUIT_ORIGIN,
  rawPath = "/",
} = {}) {
  const origin = new URL(rawOrigin);
  if (
    origin.protocol !== "http:" ||
    !ALLOWED_HOSTS.has(origin.hostname) ||
    origin.port !== "4310" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "Conduit QA only accepts http://127.0.0.1:4310 or http://0.0.0.0:4310",
    );
  }

  const target = new URL(rawPath, origin);
  if (target.origin !== origin.origin) {
    throw new Error("Conduit QA path must stay on the local Conduit origin");
  }

  return target.toString();
}
