import { createSignal } from "solid-js";
import type { ComparisonPayload } from "../workspace/workspace-comparison";

export type ReviewCommentSide = "original" | "modified";
export type ReviewCommentScope = ComparisonPayload["scope"] | "file";

export interface ReviewComment {
  id: string;
  chatId: string;
  path: string;
  side: ReviewCommentSide;
  scope: ReviewCommentScope;
  from: number;
  to: number;
  /** 1-based column the selection starts at, within line `from`. */
  startColumn: number;
  /** 1-based column the selection ends at, within line `to`. */
  endColumn: number;
  /** Every line the selection touched, whole, so the span has context around it. */
  excerpt: string;
  note: string;
}

export type ProjectedReviewComment = Omit<ReviewComment, "id" | "chatId">;

export const MAX_REVIEW_COMMENTS = 12;
export const MAX_EXCERPT_BYTES = 4 * 1024;
export const MAX_NOTE_LENGTH = 2_000;

const [comments, setComments] = createSignal<ReviewComment[]>([]);

const truncateUtf8 = (value: string, maxBytes: number) => {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  return new TextDecoder().decode(bytes.slice(0, maxBytes), { stream: true });
};

const escapeText = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const escapeAttribute = (value: string) => escapeText(value)
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

export const reviewComments = (chatId: string) => comments().filter((comment) => comment.chatId === chatId);

export function addReviewComment(comment: ReviewComment): boolean {
  if (reviewComments(comment.chatId).length >= MAX_REVIEW_COMMENTS) return false;
  setComments((current) => [...current, {
    ...comment,
    excerpt: truncateUtf8(comment.excerpt, MAX_EXCERPT_BYTES),
    note: comment.note.slice(0, MAX_NOTE_LENGTH),
  }]);
  return true;
}

export function updateReviewComment(id: string, note: string): void {
  setComments((current) => current.map((comment) => comment.id === id
    ? { ...comment, note: note.slice(0, MAX_NOTE_LENGTH) }
    : comment));
}

export function removeReviewComment(id: string): void {
  setComments((current) => current.filter((comment) => comment.id !== id));
}

export function clearReviewComments(chatId: string): void {
  setComments((current) => current.filter((comment) => comment.chatId !== chatId));
}

export function restoreReviewComments(chatId: string, values: readonly ProjectedReviewComment[]): void {
  setComments((current) => [
    ...current.filter((comment) => comment.chatId !== chatId),
    ...values.slice(0, MAX_REVIEW_COMMENTS).map((comment) => ({ ...comment, id: `rc_${crypto.randomUUID()}`, chatId })),
  ]);
}

export function projectReviewComments(text: string, values: readonly ReviewComment[]): string {
  if (values.length === 0) return text;
  const blocks = values.map((comment) => [
    `<review_comment path="${escapeAttribute(comment.path)}" lines="${comment.from}-${comment.to}" columns="${comment.startColumn}-${comment.endColumn}" side="${comment.side}" scope="${comment.scope}">`,
    "<excerpt>",
    escapeText(comment.excerpt),
    "</excerpt>",
    "<note>",
    escapeText(comment.note),
    "</note>",
    "</review_comment>",
  ].join("\n"));
  return [text, ...blocks].filter(Boolean).join("\n\n");
}

/**
 * Splits an excerpt into the text before the selection, the selection, and the
 * text after it. The excerpt holds whole lines, so the parts outside the span
 * are the context the reader needs to place it.
 */
export function reviewCommentParts(comment: Pick<ReviewComment, "excerpt" | "startColumn" | "endColumn">): { before: string; selected: string; after: string } {
  const lines = comment.excerpt.split("\n");
  const lastLine = lines.at(-1) ?? "";
  const start = Math.max(0, Math.min(comment.startColumn - 1, lines[0]?.length ?? 0));
  const tail = Math.max(0, Math.min(comment.endColumn - 1, lastLine.length));
  const end = comment.excerpt.length - (lastLine.length - tail);
  if (end <= start) return { before: "", selected: comment.excerpt, after: "" };
  return {
    before: comment.excerpt.slice(0, start),
    selected: comment.excerpt.slice(start, end),
    after: comment.excerpt.slice(end),
  };
}

const REVIEW_SCOPES: readonly ReviewCommentScope[] = ["changes", "staged", "head", "turn", "session", "file"];
const isReviewScope = (value: string): value is ReviewCommentScope => REVIEW_SCOPES.some((scope) => scope === value);
const decodeText = (value: string) => value
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replaceAll("&amp;", "&");

export function parseReviewComments(value: string): { text: string; comments: ProjectedReviewComment[] } {
  const start = value.indexOf("<review_comment ");
  if (start < 0) return { text: value, comments: [] };
  const text = value.slice(0, start).trimEnd();
  const suffix = value.slice(start);
  // Columns arrived after the first messages were sent, so they stay optional.
  const pattern = /<review_comment path="([^"]*)" lines="(\d+)-(\d+)"(?: columns="(\d+)-(\d+)")? side="(original|modified)" scope="([^"]*)">\n<excerpt>\n([\s\S]*?)\n<\/excerpt>\n<note>\n([\s\S]*?)\n<\/note>\n<\/review_comment>/gy;
  const comments: ProjectedReviewComment[] = [];
  let offset = 0;
  while (offset < suffix.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(suffix);
    if (!match) return { text: value, comments: [] };
    const [, encodedPath = "", from = "0", to = "0", startColumn, endColumn, side = "modified", scope = "", excerpt = "", note = ""] = match;
    if (!isReviewScope(scope)) return { text: value, comments: [] };
    const excerptText = decodeText(excerpt);
    comments.push({
      path: decodeText(encodedPath),
      from: Number(from),
      to: Number(to),
      startColumn: startColumn ? Number(startColumn) : 1,
      endColumn: endColumn ? Number(endColumn) : (excerptText.split("\n").at(-1)?.length ?? 0) + 1,
      side: side === "original" ? "original" : "modified",
      scope,
      excerpt: excerptText,
      note: decodeText(note),
    });
    offset = pattern.lastIndex;
    if (suffix.slice(offset, offset + 2) === "\n\n") offset += 2;
  }
  return { text, comments };
}
