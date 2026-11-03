/**
 * Outcome by risk × authorisation (Codex's guardian scores them apart): risk says what could go wrong, authorisation
 * how clearly the person's own rules and words permit this exact action. The model rates; this table decides, so
 * the decision is the same for the same rating and can be read and tuned by the host.
 */
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

/**
 * The outcome for a rating, with the overrides no table may loosen:
 * - critical always goes to the person;
 * - an `always` class (one of the person's own "always mine" rules could apply) goes to the person;
 * - an action that cannot be undone is never allowed above low risk without high authorisation.
 * A table entry that is missing or not an outcome escalates.
 */
export function outcomeOf({ risk, authorization, always }, held, table = DEFAULT_TABLE) {
  if (risk === "critical" || always) return "escalate";
  const chosen = table?.[risk]?.[authorization];
  const outcome = OUTCOMES.has(chosen) ? chosen : "escalate";
  if (outcome === "allow" && held?.reversible === false && risk !== "low" && authorization !== "high") return "escalate";
  return outcome;
}
