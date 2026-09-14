import type { ProjectedReviewComment, ReviewComment } from "./review-comments";

export const REVIEW_NAVIGATION_EVENT = "conduit:review-navigation";

export interface ReviewNavigationRequest {
  chatId: string;
  path: string;
  scope: ProjectedReviewComment["scope"];
  side: ProjectedReviewComment["side"];
  from: number;
  to: number;
  note: string;
  nonce: number;
}

export function requestReviewNavigation(chatId: string, item: ReviewComment | ProjectedReviewComment): void {
  if (!chatId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReviewNavigationRequest>(REVIEW_NAVIGATION_EVENT, { detail: {
    chatId,
    path: item.path,
    scope: item.scope,
    side: item.side,
    from: item.from,
    to: item.to,
    note: item.note,
    nonce: Date.now(),
  } }));
}
