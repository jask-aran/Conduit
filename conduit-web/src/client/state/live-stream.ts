import { createSignal } from "solid-js";

interface LiveStreamOptions {
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frame: number) => void;
}

export function createLiveStream(options: LiveStreamOptions = {}) {
  const [content, setContent] = createSignal("");
  const [version, setVersion] = createSignal(0);
  const scheduleFrame = options.scheduleFrame || requestAnimationFrame;
  const cancelFrame = options.cancelFrame || cancelAnimationFrame;
  let generationId: string | null = null;
  let pending = "";
  let frame = 0;

  const flush = () => {
    frame = 0;
    if (!pending) return;
    const chunk = pending;
    pending = "";
    setContent((current) => current + chunk);
  };

  return {
    content,
    version,
    start(id: string) {
      generationId = id;
      pending = "";
      setVersion((current) => current + 1);
      setContent("");
    },
    append(id: string, delta: string) {
      if (generationId && id !== generationId) return false;
      generationId ||= id;
      pending += delta;
      if (!frame) frame = scheduleFrame(flush);
      return true;
    },
    setSnapshot(id: string, value: string) {
      if (frame) cancelFrame(frame);
      frame = 0;
      pending = "";
      generationId = id;
      setVersion((current) => current + 1);
      setContent(value || "");
    },
    clear() {
      if (frame) cancelFrame(frame);
      frame = 0;
      pending = "";
      generationId = null;
      setContent("");
    },
    flush,
  };
}
