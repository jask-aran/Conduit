import assert from "node:assert/strict";
import test from "node:test";
import { beginEdgeSwipe } from "../src/client/navigation/mobile-swipe.ts";

const run = (start, points, state = {}) => {
  const gesture = beginEdgeSwipe({ t: 0, width: 400, sidebarOpen: false, workspaceOpen: false, ...state, ...start });
  if (!gesture) return null;
  const last = points.pop();
  for (const point of points) gesture.move(point);
  return gesture.end(last);
};

test("panels open only from their edge, and close from anywhere", () => {
  assert.equal(run({ x: 10, y: 100 }, [{ x: 30, y: 101, t: 50 }, { x: 160, y: 105, t: 200 }]), "open-sidebar");
  assert.equal(run({ x: 390, y: 100 }, [{ x: 370, y: 101, t: 50 }, { x: 240, y: 105, t: 200 }]), "open-workspace");
  assert.equal(run({ x: 200, y: 100 }, [{ x: 220, y: 101, t: 50 }, { x: 350, y: 105, t: 200 }]), null);
  assert.equal(run({ x: 300, y: 100 }, [{ x: 280, y: 101, t: 50 }, { x: 150, y: 105, t: 200 }], { sidebarOpen: true }), "close-sidebar");
});

test("a scroll stays a scroll, and a flick is enough", () => {
  assert.equal(run({ x: 10, y: 100 }, [{ x: 14, y: 130, t: 50 }, { x: 200, y: 140, t: 300 }]), null);
  assert.equal(run({ x: 10, y: 100 }, [{ x: 30, y: 101, t: 20 }, { x: 60, y: 102, t: 50 }]), "open-sidebar");
  assert.equal(run({ x: 10, y: 100 }, [{ x: 30, y: 101, t: 100 }, { x: 60, y: 102, t: 1000 }]), null);
});
