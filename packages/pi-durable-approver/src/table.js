/** The model rates; this table decides, so the same rating always gets the same decision. */
export const DEFAULT_TABLE = Object.freeze({
  low: Object.freeze({ none: "allow", low: "allow", medium: "allow", high: "allow" }),
  medium: Object.freeze({ none: "deny", low: "escalate", medium: "allow", high: "allow" }),
  high: Object.freeze({ none: "deny", low: "deny", medium: "escalate", high: "allow" }),
  critical: Object.freeze({ none: "escalate", low: "escalate", medium: "escalate", high: "escalate" }),
});

const RISKS = ["low", "medium", "high", "critical"];
const AUTHORIZATIONS = ["none", "low", "medium", "high"];
const OUTCOMES = new Set(["allow", "deny", "escalate"]);
export const isRisk = (value) => RISKS.includes(value);
export const isAuthorization = (value) => AUTHORIZATIONS.includes(value);

/** The overrides here apply whatever table the host passes; no table may loosen them. */
export function outcomeOf({ risk, authorization, always }, held, table = DEFAULT_TABLE) {
  if (risk === "critical" || always) return "escalate";
  const chosen = table?.[risk]?.[authorization];
  const outcome = OUTCOMES.has(chosen) ? chosen : "escalate";
  if (outcome === "allow" && held?.reversible === false && risk !== "low" && authorization !== "high") return "escalate";
  return outcome;
}
