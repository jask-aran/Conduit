import assert from "node:assert/strict";
import test from "node:test";
import {
  decideTailScroll,
  shouldLoadEarlierHistory,
  shouldRestoreHistoryAnchor,
  shouldFollowAfterHistoryRestore,
  usedMaxScrollTop,
  TAIL_NEAR_LATEST_PX,
  TAIL_REJOIN_PX,
} from "../src/client/chat/transcript-tail-follow.ts";

const at = (scrollTop, previousScrollTop, overrides = {}) => decideTailScroll({
  scrollTop,
  previousScrollTop,
  maxScrollTop: 1000,
  userOwned: true,
  following: true,
  ...overrides,
});

test("scrolling up inside the near-latest band does not keep following", () => {
  // The regression: 960 is 40px from the bottom, inside the 80px band, so the
  // old near-latest test read this as "still following" and let the spring pull
  // the reader back down.
  const decision = at(960, 1000);
  assert.equal(decision.direction, "up");
  assert.ok(decision.nearLatest);
  assert.equal(decision.following, false);
  assert.equal(decision.rejoin, false);
});

test("stopping an upward scroll never schedules a rejoin", () => {
  for (const scrollTop of [999, 995, 960, 800, 0]) {
    const decision = at(scrollTop, 1000);
    assert.equal(decision.rejoin, false, `rejoined at ${scrollTop}`);
    assert.equal(decision.following, false, `kept following at ${scrollTop}`);
  }
});

test("being near the bottom is not on its own consent to be pulled to it", () => {
  // Downward, but stopping 40px short: inside the near-latest band and so the
  // button hides, yet still outside the tighter rejoin distance.
  const decision = at(960, 940);
  assert.equal(decision.direction, "down");
  assert.ok(decision.nearLatest);
  assert.equal(decision.atBottom, false);
  assert.equal(decision.rejoin, false);
});

test("a downward scroll that reaches the bottom hands the tail back", () => {
  const decision = at(1000, 900);
  assert.equal(decision.direction, "down");
  assert.equal(decision.atBottom, true);
  assert.equal(decision.rejoin, true);
  assert.equal(decision.following, true);
});

test("the app never takes the tail back while it already owns it", () => {
  assert.equal(at(1000, 900, { userOwned: false }).rejoin, false);
});

test("sub-pixel jitter counts as no movement", () => {
  const decision = at(1000.2, 1000);
  assert.equal(decision.direction, "none");
  assert.equal(decision.following, true);
});

test("the first scroll of a session has no previous position to compare", () => {
  const decision = at(500, null);
  assert.equal(decision.direction, "none");
  assert.equal(decision.following, false, "500 of 1000 is not near the latest");
});

test("a stopped follower only resumes once genuinely at the bottom", () => {
  assert.equal(at(960, 940, { following: false }).following, false);
  assert.equal(at(1000, 960, { following: false }).following, true);
});

test("the rejoin distance is far tighter than the button's near-latest band", () => {
  assert.ok(TAIL_REJOIN_PX < TAIL_NEAR_LATEST_PX);
});

test("following the tail does not paginate from a skeleton-sized viewport", () => {
  assert.equal(shouldLoadEarlierHistory({ following: true, maxScrollTop: 0, scrollTop: 0 }), false);
});

test("following the tail does not paginate just because scrollTop is near zero", () => {
  assert.equal(shouldLoadEarlierHistory({ following: true, maxScrollTop: 5000, scrollTop: 0 }), false);
});

test("a reader who scrolled up near the top paginates", () => {
  assert.equal(shouldLoadEarlierHistory({ following: false, maxScrollTop: 5000, scrollTop: 100 }), true);
});

test("a reader parked in the middle does not paginate", () => {
  assert.equal(shouldLoadEarlierHistory({ following: false, maxScrollTop: 5000, scrollTop: 2000 }), false);
});

test("following skips history-anchor restore", () => {
  assert.equal(shouldRestoreHistoryAnchor(true), false);
  assert.equal(shouldRestoreHistoryAnchor(false), true);
});

test("a restore that leaves the tail shows scroll-to-latest", () => {
  assert.equal(shouldFollowAfterHistoryRestore(3959), false);
  assert.equal(shouldFollowAfterHistoryRestore(0), true);
});

test("the used max scroll prefers a clamped scrollTop over the naive integer max", () => {
  assert.equal(usedMaxScrollTop({ scrollHeight: 2418.2, clientHeight: 1727, scrollTop: 691 }), 691);
});
