import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStore, statusSummary } from "../conduit-web/src/auth-store.js";

export const COOKIE_NAME = "conduit_session";
export const DEFAULT_ORIGIN = "http://127.0.0.1:4310";
export const DEFAULT_AGENT_USER = "conduit-local-agent";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveLocalAuthFile(env = process.env) {
  const dataRoot = path.resolve(env.CONDUIT_DATA_ROOT || path.join(repositoryRoot, "data"));
  return path.resolve(env.CONDUIT_AUTH_FILE || path.join(dataRoot, "auth.json"));
}

export function localCookie(token, origin = DEFAULT_ORIGIN) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("local session auth only accepts http://127.0.0.1");
  }
  return {
    name: COOKIE_NAME,
    value: token,
    domain: url.hostname,
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  };
}

export async function mintLocalSession({
  authFile = resolveLocalAuthFile(),
  userAgent = DEFAULT_AGENT_USER,
} = {}) {
  const store = new AuthStore(authFile);
  await store.load();
  if (!store.hasPassword()) {
    throw new Error("No Conduit password is configured; refuse to mint a session");
  }
  const { token, session } = await store.createSession({ userAgent });
  await store.load({ force: true });
  return {
    token,
    userAgent: session.userAgent,
    sessionCount: statusSummary(store).sessionCount,
  };
}

export function sessionArtifact(session, {
  format = "token",
  origin = DEFAULT_ORIGIN,
} = {}) {
  if (format === "token") return `${session.token}\n`;
  if (format === "cookie") return `${COOKIE_NAME}=${session.token}\n`;
  if (format === "json") return `${JSON.stringify(session)}\n`;
  if (format === "playwright") {
    return `${JSON.stringify({ cookies: [localCookie(session.token, origin)], origins: [] })}\n`;
  }
  throw new Error("--format must be token, cookie, json, or playwright");
}
