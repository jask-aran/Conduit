import assert from "node:assert/strict";
import test from "node:test";
import {
  BufferedIncremarkTypewriter,
  chooseAdaptiveStep,
  chooseBufferedStep,
  chooseFrameBudget,
  chooseFixedStep,
  normalizeFrameInterval,
  prepareTypewriterNode,
  updateEma,
  visibleAstCharacters,
} from "../src/client/chat/incremark-typewriter.ts";
import {
  advanceTailFollow,
  createTailFollowState,
  rebaseTailFollowState,
} from "../src/client/chat/transcript-tail-follow.ts";

test("frame budget follows the measured display interval", () => {
  const refresh144Hz = 1000 / 144;
  assert.equal(chooseFrameBudget(16), 8);
  assert.ok(Math.abs(chooseFrameBudget(refresh144Hz) - refresh144Hz * 0.5) < 0.001);
  assert.equal(normalizeFrameInterval(1), 16);
  assert.ok(Math.abs(normalizeFrameInterval(refresh144Hz) - refresh144Hz) < 0.001);
});

test("buffered work grows from measured frame cost and halves after an overrun", () => {
  assert.equal(chooseBufferedStep(200, 16, 0, 8), 32);
  assert.equal(chooseBufferedStep(200, 16, 5, 8), 16);
  assert.equal(chooseBufferedStep(200, 16, 12, 8), 8);
  assert.equal(updateEma(null, 4), 4);
  assert.equal(updateEma(4, 12), 6);
});

test("fixed and adaptive pacing remain distinct from the buffered scheduler", () => {
  assert.equal(chooseFixedStep(200), 32);
  assert.equal(chooseFixedStep(8), 8);
  assert.equal(chooseAdaptiveStep(200, 100, 0, 16), 2);
  assert.equal(chooseAdaptiveStep(200, null, 500, 16), 32);
});

test("buffered scheduler can drain several complete blocks in one frame", () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = [];
  const displays = [];
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const controller = new BufferedIncremarkTypewriter({
      onChange: (blocks) => displays.push(blocks),
    });
    controller.push([
      { id: "one", status: "pending", node: { type: "paragraph", children: [{ type: "text", value: "one" }] } },
      { id: "two", status: "pending", node: { type: "paragraph", children: [{ type: "text", value: "two" }] } },
    ]);
    controller.setEnabled(true);
    frames.shift()(16);
    assert.equal(controller.getMetrics().terminal, true);
    assert.equal(displays.at(-1).length, 2);
    assert.equal(controller.getDebugState().pendingBlockCount, 0);
    controller.destroy();
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("math is one visible atomic character while ordinary AST text is retained", () => {
  assert.equal(visibleAstCharacters({ type: "paragraph", children: [
    { type: "text", value: "before " },
    { type: "inlineMath", value: "x^2 + y^2" },
    { type: "text", value: " after" },
  ] }), 14);
});

test("nested math is prepared as an atomic leaf for the native slicer", () => {
  const node = prepareTypewriterNode({ type: "paragraph", children: [
    { type: "text", value: "before " },
    { type: "inlineMath", value: "\\frac{a}{b}" },
    { type: "text", value: " after" },
  ] });
  assert.equal(node.children[1].value, undefined);
  assert.equal(node.children[1].__conduitMathSource, "\\frac{a}{b}");
  assert.equal(visibleAstCharacters(node), 14);
});

test("inertial tail-follow moves by fractional frame steps without a gutter jump", () => {
  let frame = advanceTailFollow(createTailFollowState(0), 100, 0, 0);
  assert.equal(frame.nextScrollTop, 0);
  frame = advanceTailFollow(frame.state, 100, 16, 0);
  assert.ok(frame.nextScrollTop > 0);
  assert.ok(frame.nextScrollTop < 8);
  assert.equal(frame.mode, "tracking");
});

test("inertial tail-follow remains monotonic and does not overshoot", () => {
  let state = createTailFollowState(0);
  let previous = 0;
  for (let time = 0; time <= 1_000; time += 16) {
    const frame = advanceTailFollow(state, 100, time, previous);
    state = frame.state;
    assert.ok(frame.nextScrollTop >= previous);
    assert.ok(frame.nextScrollTop <= 100);
    previous = frame.nextScrollTop;
  }
  assert.ok(previous > 99);
});

test("layout growth adds fractional feed-forward without a catch-up snap", () => {
  const frame = advanceTailFollow(createTailFollowState(0), 0, 0, 0);
  const withoutFeedForward = advanceTailFollow(frame.state, 100, 16, 0, 0);
  const withFeedForward = advanceTailFollow(frame.state, 100, 16, 0, 100);
  assert.ok(withFeedForward.feedForwardVelocityPxPerSecond > 0);
  assert.ok(withFeedForward.nextScrollTop > withoutFeedForward.nextScrollTop);
  assert.ok(withFeedForward.nextScrollTop > 0);
  assert.ok(withFeedForward.nextScrollTop < 100);
  assert.equal(withFeedForward.mode, "tracking");
});

test("a long frame gap rebases instead of creating a catch-up jump", () => {
  let frame = advanceTailFollow(createTailFollowState(0), 100, 0, 0);
  frame = advanceTailFollow(frame.state, 100, 16, 0);
  const resumed = advanceTailFollow(frame.state, 200, 200, frame.nextScrollTop);
  assert.equal(resumed.mode, "rebase");
  assert.equal(resumed.movementPx, 0);
  assert.equal(resumed.state.velocity, 0);
});

test("user-owned scrolling does not receive app movement", () => {
  const state = rebaseTailFollowState(createTailFollowState(0), 20, "user");
  const frame = advanceTailFollow(state, 200, 16, 20);
  assert.equal(frame.nextScrollTop, 20);
  assert.equal(frame.movementPx, 0);
  assert.equal(frame.state.owner, "user");
});
