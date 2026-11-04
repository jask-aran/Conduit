import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const STARTER_POLICY = Object.freeze({
  version: "starter",
  may: Object.freeze([
    "Reply in an email thread I started or have replied in myself (not one a stranger opened).",
    "Label, archive and mark mail as read or unread.",
    "Create and move events on my own calendars.",
    "Write drafts of anything.",
  ]),
  always: Object.freeze([
    "Sending to someone I have not emailed before.",
    "Deleting anything.",
    "Paying for or transferring anything.",
    "Sharing a file or calendar with anyone outside.",
    "Changing account, security or forwarding settings.",
  ]),
  limits: Object.freeze([]), exact: Object.freeze([]),
});

export async function readPolicy(agent) {
  const stored = (await agent.state()).approvalPolicy;
  return { policy: JSON.parse(JSON.stringify({ ...STARTER_POLICY, ...stored })), starter: !stored };
}

/** The rules as jbot and Settings › Blocks read them (the live block `live-approval-rules`), without their tag. */
export function renderRules(policy) {
  const list = (items) => items?.length ? items.map((item) => `- ${item}`).join("\n") : "(none)";
  return `It may:\n${list(policy.may)}\n\nAlways yours:\n${list(policy.always)}\n\nNever:\n${list(policy.limits)}`;
}

export async function savePolicy(agent, patch) {
  const invalid = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) invalid("Policy must be an object");
  const changes = {};
  for (const field of ["may", "always", "limits", "exact"]) {
    if (!Object.hasOwn(patch, field)) continue;
    const values = patch[field];
    const maximum = field === "exact" ? 500 : 40;
    if (!Array.isArray(values) || values.length > maximum) invalid(`${field} must be an array of at most ${maximum} strings`);
    changes[field] = Array.from(values, (value) => {
      if (typeof value !== "string") invalid(`${field} must contain only strings`);
      if (field === "exact") {
        if (!/^[0-9a-f]{64}$/i.test(value)) invalid("exact must contain only 64-hex strings");
        return value;
      }
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 300) invalid(`${field} strings must have 1–300 characters after trimming`);
      return trimmed;
    });
  }
  return agent.update((doc) => {
    doc.approvalPolicy = { ...STARTER_POLICY, ...doc.approvalPolicy, ...changes, version: `${Date.now()}-${randomUUID()}` };
    // The document's objects cannot be read after the commit settles.
    return JSON.parse(JSON.stringify(doc.approvalPolicy));
  });
}

/** Daily audit files are append-only; read the newest file and its newest lines first. */
export async function readApprovals(dir, limit = 50) {
  const requested = Number(limit);
  limit = Math.min(200, Math.max(1, limit == null || limit === "" || !Number.isFinite(requested) ? 50 : Math.trunc(requested)));
  const files = await fs.readdir(dir).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  for (const file of files.filter((name) => /^approvals-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().reverse()) {
    const lines = (await fs.readFile(path.join(dir, file), "utf8")).split("\n");
    const daily = [];
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.at !== "string") continue;
        daily.push(record);
      } catch { continue; }
    }
    records.push(...daily.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit - records.length));
    if (records.length >= limit) return records;
  }
  return records;
}
