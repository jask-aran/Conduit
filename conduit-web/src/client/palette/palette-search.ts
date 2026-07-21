/**
 * Palette ranking (VS Code–style priorities):
 * 1. Exact / prefix label matches beat fuzzy noise
 * 2. Word-boundary and contiguous substring beats scattered fuzzy
 * 3. Matches only in keywords/id score lower and need higher quality
 * 4. Weak fuzzy hits are dropped (a permissive default filter is very noisy)
 *
 * When searching, results are a flat score-sorted list so models and dynamic
 * sources are not trapped under static command groups.
 *
 * Ported verbatim from the React app; framework-agnostic. Keep it pure.
 */

const SCORE_THRESHOLD = 0.42;
const LABEL_EXACT = 1;
const LABEL_PREFIX = 0.97;
const LABEL_WORD_PREFIX = 0.94;
const LABEL_SUBSTRING = 0.9;
const SPEC_SUBSTRING = 0.86;
const FUZZY_LABEL_FLOOR = 0.55;
const KEYWORD_CAP = 0.72;

function normalize(value: unknown): string {
  return String(value || "").toLowerCase().trim();
}

function tokens(value: unknown): string[] {
  return normalize(value).split(/[\s·/_\-.:]+/).filter(Boolean);
}

/** Contiguous subsequence score in [0, 1]; 0 if any query char is missing. */
function contiguousFuzzy(haystack: string, needle: string): number {
  if (!needle) return 1;
  if (!haystack) return 0;
  let score = 0;
  let streak = 0;
  let at = 0;
  for (let i = 0; i < needle.length; i += 1) {
    const ch = needle[i]!;
    const found = haystack.indexOf(ch, at);
    if (found < 0) return 0;
    if (found === at) {
      streak += 1;
      score += 1 + streak * 0.15;
    } else if (found === 0 || /[\s·/_\-.:]/.test(haystack[found - 1]!)) {
      streak = 1;
      score += 1.1;
    } else {
      streak = 0;
      score += 0.35;
    }
    at = found + 1;
  }
  const density = needle.length / Math.max(haystack.length, needle.length);
  const normalized = score / (needle.length * 1.5);
  return Math.min(1, normalized * 0.85 + density * 0.15);
}

/**
 * Score one searchable row. `label` is primary; `haystack` is secondary text
 * (spec, id, keywords joined). Returns 0 to hide.
 */
export function scorePaletteMatch({ label, haystack = "", keywords = [], query }: {
  label?: string;
  haystack?: string;
  keywords?: string[];
  query: string;
}): number {
  const q = normalize(query);
  if (!q) return 1;

  const labelNorm = normalize(label);
  const hayNorm = normalize(haystack);
  const keywordText = keywords.map(normalize).filter(Boolean);
  const allSecondary = [hayNorm, ...keywordText].filter(Boolean).join(" ");

  if (labelNorm === q) return LABEL_EXACT;
  if (labelNorm.startsWith(q)) return LABEL_PREFIX + Math.min(0.02, q.length / Math.max(labelNorm.length, 1) * 0.02);

  const labelWords = tokens(labelNorm);
  if (labelWords.some((word) => word.startsWith(q))) return LABEL_WORD_PREFIX;
  if (labelNorm.includes(q)) return LABEL_SUBSTRING + Math.min(0.04, q.length / labelNorm.length * 0.04);

  if (allSecondary.includes(q)) {
    // Prefer tight matches on model specs / ids over loose keyword-only hits.
    const inSpec = hayNorm.includes(q);
    const base = inSpec ? SPEC_SUBSTRING : KEYWORD_CAP * 0.85;
    const cap = inSpec ? SPEC_SUBSTRING + 0.04 : KEYWORD_CAP;
    return Math.min(cap, base + Math.min(0.04, q.length / Math.max(allSecondary.length, 1)));
  }

  const labelFuzzy = contiguousFuzzy(labelNorm, q);
  if (labelFuzzy >= 0.55) {
    return Math.max(FUZZY_LABEL_FLOOR, Math.min(0.88, labelFuzzy));
  }

  const secondaryFuzzy = contiguousFuzzy(allSecondary, q);
  if (secondaryFuzzy >= 0.7) {
    return Math.min(KEYWORD_CAP, secondaryFuzzy * 0.75);
  }

  // Multi-word query: require every token to hit label or secondary.
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const blob = `${labelNorm} ${allSecondary}`;
    if (parts.every((part) => blob.includes(part))) {
      return LABEL_SUBSTRING - 0.02;
    }
  }

  return 0;
}

interface MatchableCommand {
  id?: string;
  label?: string;
  keywords?: string[];
  searchValue?: string;
  detail?: string;
  description?: string;
  destructive?: boolean;
  group?: string;
}

interface MatchableModel {
  label?: string;
  spec?: string;
  provider?: string;
  id?: string;
}

export function commandMatchParts(command: MatchableCommand) {
  const label = command.label || "";
  const keywords = [command.label, ...(command.keywords || [])].filter(Boolean) as string[];
  const haystack = [
    command.searchValue,
    command.id,
    command.detail,
    command.description,
    ...(command.keywords || []),
  ].filter(Boolean).join(" ");
  return { label, haystack, keywords };
}

export function modelMatchParts(model: MatchableModel) {
  const label = model.label || model.spec || "";
  const keywords = [model.label, model.provider, model.spec, model.id].filter(Boolean) as string[];
  const haystack = [model.spec, model.provider, model.id, "model"].filter(Boolean).join(" ");
  return { label, haystack, keywords };
}

export interface RankedRow<C extends MatchableCommand = MatchableCommand, M extends MatchableModel = MatchableModel> {
  kind: "command" | "model";
  id: string;
  score: number;
  command?: C;
  model?: M;
  group: string;
}

/**
 * Flat ranked rows for a search query. Empty query returns null (browse mode).
 */
export function rankPaletteResults<C extends MatchableCommand, M extends MatchableModel>({ commands, models, query, currentModel }: {
  commands: C[];
  models?: M[];
  query: string;
  currentModel?: string;
}): RankedRow<C, M>[] | null {
  const q = String(query || "").trim();
  if (!q) return null;

  const rows: RankedRow<C, M>[] = [];
  for (const command of commands) {
    const parts = commandMatchParts(command);
    const score = scorePaletteMatch({ ...parts, query: q });
    if (score < SCORE_THRESHOLD) continue;
    rows.push({
      kind: "command",
      id: command.id || "",
      score,
      command,
      group: command.destructive ? "danger" : (command.group || "commands"),
    });
  }
  for (const model of models || []) {
    const parts = modelMatchParts(model);
    const score = scorePaletteMatch({ ...parts, query: q });
    if (score < SCORE_THRESHOLD) continue;
    // Prefer concrete model picks slightly over generic "Settings · Models".
    const boost = model.spec === currentModel ? 0.01 : 0;
    rows.push({
      kind: "model",
      id: `model:${model.spec}`,
      score: Math.min(1, score + boost),
      model,
      group: "models",
    });
  }

  rows.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftLabel = left.command?.label || left.model?.label || "";
    const rightLabel = right.command?.label || right.model?.label || "";
    return leftLabel.localeCompare(rightLabel);
  });
  return rows;
}

export const PALETTE_SCORE_THRESHOLD = SCORE_THRESHOLD;
