export function createLiveStreamStore({ scheduleFrame, cancelFrame } = {}) {
  const schedule = scheduleFrame || ((callback) => requestAnimationFrame(callback));
  const cancel = cancelFrame || ((frame) => cancelAnimationFrame(frame));
  let content = "";
  let snapshot = Object.freeze({ generationId: null, content: "" });
  let frame = null;
  const listeners = new Set();

  function publish() {
    frame = null;
    snapshot = Object.freeze({ generationId: snapshot.generationId, content });
    listeners.forEach((listener) => listener());
  }

  function schedulePublish() {
    if (frame == null) frame = schedule(publish);
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(generationId, initialContent = "") {
      if (frame != null) cancel(frame);
      frame = null;
      content = String(initialContent || "");
      snapshot = Object.freeze({ generationId: generationId || null, content });
      listeners.forEach((listener) => listener());
    },
    setSnapshot(generationId, nextContent) {
      if (frame != null) cancel(frame);
      frame = null;
      content = String(nextContent || "");
      snapshot = Object.freeze({ generationId: generationId || null, content });
      listeners.forEach((listener) => listener());
    },
    append(generationId, delta) {
      if (!delta || (snapshot.generationId && generationId !== snapshot.generationId)) return false;
      if (!snapshot.generationId) snapshot = Object.freeze({ generationId: generationId || null, content });
      content += String(delta);
      schedulePublish();
      return true;
    },
    flush() {
      if (frame != null) cancel(frame);
      if (frame != null || content !== snapshot.content) publish();
    },
    clear() {
      if (frame != null) cancel(frame);
      frame = null;
      content = "";
      snapshot = Object.freeze({ generationId: null, content: "" });
      listeners.forEach((listener) => listener());
    },
  };
}
