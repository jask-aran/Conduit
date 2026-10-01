/**
 * The account's plan usage, asked of the vendor directly with the login the
 * harness already holds -- as codex-auth and ccusage-style tools do -- so the
 * readout is current even when no live session is declaring it. Tokens are
 * read, never refreshed or written: the harness owns its login, and an
 * expired one just leaves the readout without a plan until the harness runs.
 * Each answer is kept for a minute; they are the account's, not a chat's.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planWindowLabel } from "./cache-stats.js";

const TTL_MS = 60_000;
// A live harness's own declaration outranks a poll: it says what the request
// it just made counted against. Polls wait this long after one before asking.
const DECLARED_HOLD_MS = 5 * 60_000;
const cache = new Map();

function cached(key, ask) {
  const entry = cache.get(key);
  if (entry?.declaredAt && Date.now() - entry.declaredAt < DECLARED_HOLD_MS) return Promise.resolve(entry.value);
  if (entry && (entry.pending || Date.now() - entry.at < TTL_MS)) return entry.pending || Promise.resolve(entry.value);
  const pending = ask().catch(() => null).then((value) => {
    // A failed read keeps the last good answer rather than blanking it.
    const current = cache.get(key);
    // A declaration that landed while this poll was out stands.
    if (current?.declaredAt && current.declaredAt > (entry?.declaredAt || 0)) return current.value;
    cache.set(key, { at: Date.now(), value: value ?? entry?.value ?? null });
    return value ?? entry?.value ?? null;
  });
  cache.set(key, { ...(entry || { at: 0, value: null }), pending });
  return pending;
}

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const timeout = () => AbortSignal.timeout(8000);

/** ChatGPT's plan, for a Codex login (Codex itself, or Pi's openai-codex). */
async function chatgptPlan(accessToken, accountId) {
  if (!accessToken) return null;
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { signal: timeout(), headers: {
    authorization: `Bearer ${accessToken}`, ...(accountId ? { "chatgpt-account-id": accountId } : {}), "user-agent": "codex-cli",
  } });
  if (!response.ok) return null;
  const body = await response.json();
  const window = (id, value) => value && value.used_percent != null ? { id,
    label: planWindowLabel(value.limit_window_seconds ? Math.round(value.limit_window_seconds / 60) : null),
    usedPercent: value.used_percent, resetsAt: value.reset_at ? new Date(value.reset_at * 1000).toISOString() : null } : null;
  const windows = [window("primary", body.rate_limit?.primary_window), window("secondary", body.rate_limit?.secondary_window)].filter(Boolean);
  return windows.length ? { name: body.plan_type || null, windows } : null;
}

/** The claude.ai plan, for a Claude Code login: the endpoint Claude Code's /usage reads. */
async function claudePlan(accessToken) {
  if (!accessToken) return null;
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", { signal: timeout(), headers: {
    authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20",
  } });
  if (!response.ok) return null;
  const body = await response.json();
  const labels = { five_hour: "5-hour", seven_day: "Weekly" };
  // The plan's own windows; the endpoint also carries internal and add-on buckets.
  const windows = Object.entries(body || {})
    .filter(([id, window]) => /^(five_hour|seven_day)(_(opus|sonnet))?$/.test(id) && window?.utilization != null)
    .map(([id, window]) => ({ id, label: labels[id] || id.replace(/^seven_day_/, "Weekly · "),
      usedPercent: window.utilization, resetsAt: window.resets_at || null }));
  return windows.length ? { name: null, windows } : null;
}

export function codexPlanUsage() {
  return cached("codex", async () => {
    const auth = await readJson(path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json"));
    return chatgptPlan(auth?.tokens?.access_token, auth?.tokens?.account_id);
  });
}

export function claudePlanUsage() {
  return cached("claude", async () => {
    const credentials = await readJson(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), ".credentials.json"));
    const oauth = credentials?.claudeAiOauth;
    const plan = oauth?.expiresAt && oauth.expiresAt < Date.now() ? null : await claudePlan(oauth?.accessToken);
    return plan ? { ...plan, name: oauth?.subscriptionType || null } : null;
  });
}

/** Pi's plan for the model it runs: a subscription login has one, an API key does not. */
export function piPlanUsage(agentDir, model) {
  const provider = String(model || "").split("/")[0];
  if (provider !== "openai-codex") return Promise.resolve(null);
  return cached(`pi:${agentDir}:${provider}`, async () => {
    const auth = (await readJson(path.join(agentDir, "auth.json")))?.[provider];
    if (auth?.type !== "oauth" || (auth.expires && auth.expires < Date.now())) return null;
    return chatgptPlan(auth.access, auth.accountId);
  });
}

/**
 * What a live harness declared about its plan (`codex`, `claude`): its windows
 * replace the same windows from any poll, the rest stand, and polls hold off.
 */
export function declarePlan(key, plan) {
  if (!plan?.windows?.length) return cache.get(key)?.value ?? null;
  const previous = cache.get(key)?.value;
  const known = previous?.windows || [];
  const windows = [...known.map((window) => plan.windows.find((declared) => declared.id === window.id) || window),
    ...plan.windows.filter((declared) => !known.some((window) => window.id === declared.id))];
  const value = { name: plan.name ?? previous?.name ?? null, windows };
  cache.set(key, { at: Date.now(), declaredAt: Date.now(), value });
  return value;
}
