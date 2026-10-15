/*
 * No server stands behind the gallery, so its sockets are fakes. Dictation's
 * plays a transcriber: ready at once, a phrase arriving word by word while
 * audio flows, and the phrase as the final text when the take stops; a silent
 * take (fake-mic.ts) hears nothing. Any other
 * socket stays connecting forever rather than failing, as a slow server would.
 */
import { silentTake } from "./fake-mic";

const PHRASE = "make the second paragraph a little shorter and keep the first one as it is".split(" ");

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  protocol = ""; extensions = "";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private words = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(readonly url: string) {
    super();
    if (!/dictat|voice/.test(url)) return;
    setTimeout(() => {
      this.readyState = 1;
      this.fire("open", new Event("open"));
      this.say({ type: "ready" });
      this.say({ type: "runtime_ready" });
      this.timer = setInterval(() => { if (!silentTake && this.words < PHRASE.length) this.say({ type: "partial", text: PHRASE.slice(0, ++this.words).join(" ") }); }, 260);
    }, 80);
  }
  private fire(type: string, event: Event) {
    this.dispatchEvent(event);
    (this as unknown as Record<string, ((event: Event) => void) | null>)[`on${type}`]?.(event);
  }
  private say(message: object) { if (this.readyState === 1) this.fire("message", new MessageEvent("message", { data: JSON.stringify(message) })); }
  send(data: unknown) {
    if (typeof data !== "string") return;
    if ((JSON.parse(data) as { type?: string }).type !== "stop") return;
    clearInterval(this.timer);
    const text = silentTake ? "" : PHRASE.slice(0, Math.max(this.words, 4)).join(" ");
    setTimeout(() => { this.say({ type: "final", text }); this.say({ type: "completed", text, final: true, finalWithinDeadline: true }); }, 300);
  }
  close() {
    clearInterval(this.timer);
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire("close", new CloseEvent("close", { code: 1000 }));
  }
}

export function fakeSockets() {
  (window as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
}
