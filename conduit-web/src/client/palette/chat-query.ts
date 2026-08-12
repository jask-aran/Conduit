import type { Project } from "../api/contracts";

export type ChatQueryFilter = {
  kind: "scope" | "in";
  value: string;
  raw: string;
};

export type ParsedChatQuery = {
  text: string;
  filters: ChatQueryFilter[];
};

export type ChatQueryScope =
  | { kind: "all" }
  | { kind: "project"; project: Project }
  | { kind: "unresolved"; value: string };

const FILTER_PATTERN = /(^|\s)(scope|in):("([^"]+)"|'([^']+)'|([^\s]+))/gi;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function filterKey(filter: Pick<ChatQueryFilter, "kind" | "value">): string {
  return `${filter.kind}:${normalize(filter.value)}`;
}

function quoteFilterValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function tokenText(filter: ChatQueryFilter): string {
  return `${filter.kind}:${quoteFilterValue(filter.value)}`;
}

/** Parse free text and the small set of chat-search filters. */
export function parseChatQuery(raw: string): ParsedChatQuery {
  const source = String(raw || "");
  const removals: Array<[number, number]> = [];
  const filters: ChatQueryFilter[] = [];
  let match: RegExpExecArray | null;
  FILTER_PATTERN.lastIndex = 0;
  while ((match = FILTER_PATTERN.exec(source))) {
    const prefix = match[1] || "";
    const kind = match[2]!.toLocaleLowerCase() as "scope" | "in";
    const value = match[4] || match[5] || match[6] || "";
    const normalized = normalize(value);
    if (!normalized || (kind === "scope" && normalized !== "chats" && normalized !== "all")) continue;
    const start = match.index + prefix.length;
    const end = match.index + match[0].length;
    removals.push([start, end]);
    const filter = { kind, value: value.trim(), raw: source.slice(start, end) };
    const existing = filters.findIndex((item) => item.kind === kind);
    if (existing >= 0) filters[existing] = filter;
    else filters.push(filter);
  }

  let text = source;
  for (let index = removals.length - 1; index >= 0; index -= 1) {
    const [start, end] = removals[index]!;
    text = `${text.slice(0, start)} ${text.slice(end)}`;
  }
  return { text: text.replace(/\s+/g, " ").trim(), filters };
}

/** Serialize filters and free text into the raw value owned by the input. */
export function serializeChatQuery(filters: ChatQueryFilter[], text: string): string {
  const unique: ChatQueryFilter[] = [];
  const seen = new Set<string>();
  for (const filter of filters) {
    const value = filter.value.trim();
    if (!value) continue;
    const key = filterKey({ kind: filter.kind, value });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...filter, value });
  }
  return [unique.map(tokenText).join(" "), String(text || "").trim()].filter(Boolean).join(" ");
}

export function removeChatQueryFilter(parsed: ParsedChatQuery, index: number): string {
  return serializeChatQuery(parsed.filters.filter((_, itemIndex) => itemIndex !== index), parsed.text);
}

function projectMatches(project: Project, value: string): boolean {
  const target = normalize(value);
  return [project.id, project.slug, project.name].some((candidate) => normalize(candidate) === target);
}

/** Resolve the active project constraint against the current catalogue. */
export function resolveChatQueryScope(parsed: ParsedChatQuery, projects: Project[]): ChatQueryScope {
  const filter = [...parsed.filters].reverse().find((item) => item.kind === "scope" || item.kind === "in");
  if (!filter || (filter.kind === "scope" && normalize(filter.value) === "all")) return { kind: "all" };
  if (filter.kind === "scope" && normalize(filter.value) === "chats") {
    const project = projects.find((item) => item.slug === "chat");
    return project ? { kind: "project", project } : { kind: "unresolved", value: "Chats" };
  }
  const project = projects.find((item) => projectMatches(item, filter.value));
  return project ? { kind: "project", project } : { kind: "unresolved", value: filter.value };
}
