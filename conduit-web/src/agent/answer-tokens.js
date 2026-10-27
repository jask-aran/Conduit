import { randomBytes } from "node:crypto";

const tokens = new Map();

export function mintAnswerToken(chatId, requestId) {
  const now = Date.now();
  for (const [token, entry] of tokens) if (entry.expiresAt <= now) tokens.delete(token);
  const token = randomBytes(32).toString("base64url");
  tokens.set(token, { chatId, requestId, expiresAt: now + 86400_000 });
  return token;
}

export function takeAnswerToken(token) {
  const entry = tokens.get(token);
  tokens.delete(token);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}
