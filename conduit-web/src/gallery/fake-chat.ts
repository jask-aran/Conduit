import type { Message } from "../client/api/contracts";
import { createSignal } from "solid-js";

/*
 * Just enough of a chat for the real Composer to mount in the gallery: a
 * draft that types, a send that lands in the screen's own list, and every
 * other read answering "nothing here". Anything not named reads as empty, so
 * a new field on the store degrades to blank rather than breaking the page.
 */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 11, minutes)).toISOString();
/** The transcript the screen opens on. */
export const SEED: Message[] = [
  { id: "u1", role: "user", content: "write a .txt file in this folder that contains lorem ipsum text", timestamp: at(14), outcome: "complete" },
  { id: "a1", role: "assistant", answers: "u1", interim: false, content: "Created `lorem_ipsum.txt` in this folder with lorem ipsum text.", timestamp: at(16) },
  { id: "u2", role: "user", content: "and make the second paragraph shorter", timestamp: at(18), outcome: "complete" },
  { id: "a2", role: "assistant", answers: "u2", interim: false, content: "Done. The second paragraph is now two sentences:\n\n> Lorem ipsum dolor sit amet. Consectetur adipiscing elit.\n\n```txt\nlorem_ipsum.txt  412 bytes\n```", timestamp: at(19) },
];

export function fakeChat() {
  const [draft, setDraft] = createSignal("");
  const [messages, setMessages] = createSignal<Message[]>(SEED);
  let next = 0;
  const named: Record<string, unknown> = {
    draft, setDraft,
    loadedId: () => "gallery",
    generation: () => "idle",
    interactionReady: () => true,
    capabilities: () => ({}),
    messages, hostUiRequests: () => [], pendingMessages: () => [], harnessCommands: () => [], tools: () => [],
    title: () => "Lorem ipsum file", status: () => "active", presentation: () => ({ kind: "ready" }),
    send: async () => {
      const text = draft().trim();
      if (!text) return;
      const id = `g${next++}`;
      setMessages((list) => [...list, { id, role: "user", content: text, timestamp: new Date().toISOString(), outcome: "complete" },
        { id: `${id}a`, role: "assistant", answers: id, interim: false, content: "A seeded reply: nothing here talks to a server.", timestamp: new Date().toISOString() }]);
      setDraft("");
    },
  };
  return new Proxy(named, { get: (target, key: string) => key in target ? target[key] : () => undefined }) as never;
}

export function fakeAttachments() {
  return { items: () => [], pendingIds: () => [], addFiles: () => {}, remove: () => {}, retry: () => {} } as never;
}

export function fakeModels() {
  const model = { spec: "anthropic/opus", label: "Opus 5.5" };
  return { models: () => [model], model: () => model.spec, effort: () => "medium", notice: () => "", chooseModel: () => {}, chooseEffort: () => {} } as never;
}
