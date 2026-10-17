import type { Message, ToolItem } from "../client/api/contracts";
import { createSignal } from "solid-js";
import type { UploadAttachment } from "../client/state/attachments";

/*
 * Just enough of a chat for the real Composer to mount in the gallery: a
 * draft that types, a send that lands in the screen's own list, and every
 * other read answering "nothing here". Anything not named reads as empty, so
 * a new field on the store degrades to blank rather than breaking the page.
 */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 11, minutes)).toISOString();
/** The transcript the screen opens on. */
const EARLIER = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
export const SEED: Message[] = [
  // Earlier turns, so the transcript scrolls and scroll-to-latest can show.
  ...[1, 2, 3].flatMap((n) => [
    { id: `e${n}`, role: "user" as const, content: `earlier question ${n}: what goes in a lorem ipsum file?`, timestamp: at(n), outcome: "complete" as const },
    { id: `e${n}a`, role: "assistant" as const, answers: `e${n}`, interim: false, content: `${EARLIER}\n\n${EARLIER}\n\n${EARLIER}`, timestamp: at(n + 1) },
  ]),
  { id: "u1", role: "user", content: "write a .txt file in this folder that contains lorem ipsum text", timestamp: at(14), outcome: "complete" },
  { id: "a1", role: "assistant", answers: "u1", interim: false, content: "Created `lorem_ipsum.txt` in this folder with lorem ipsum text.", timestamp: at(16) },
  { id: "u2", role: "user", content: "and make the second paragraph shorter", timestamp: at(18), outcome: "complete" },
  // A turn with a trail (thinking, a read, an edit, a command), so the trace header opens.
  { id: "a2", role: "assistant", answers: "u2", interim: false, blocks: [{ kind: "thinking", text: "The second paragraph has four sentences; keep the first two." }, { kind: "tool_call", toolCallId: "t1" }, { kind: "tool_call", toolCallId: "t2" }, { kind: "tool_call", toolCallId: "t3" }] as Message["blocks"], content: "Done. The second paragraph is now two sentences:\n\n> Lorem ipsum dolor sit amet. Consectetur adipiscing elit.\n\n```txt\nlorem_ipsum.txt  412 bytes\n```", timestamp: at(19) },
];

/** The tools the seeded turn ran. */
const TOOLS: ToolItem[] = [
  { toolCallId: "t1", name: "read", kind: "read", subject: "lorem_ipsum.txt", input: { path: "lorem_ipsum.txt" }, output: "Lorem ipsum dolor sit amet. Consectetur adipiscing elit. Sed do eiusmod tempor. Ut enim ad minim veniam.", done: true, timestamp: at(18), completedAt: at(18) },
  { toolCallId: "t2", name: "edit", kind: "edit", subject: "lorem_ipsum.txt", input: { path: "lorem_ipsum.txt" }, output: "1 edit", done: true, timestamp: at(18), completedAt: at(19) },
  { toolCallId: "t3", name: "bash", kind: "command", subject: "wc -c lorem_ipsum.txt", input: { command: "wc -c lorem_ipsum.txt" }, output: "412 lorem_ipsum.txt", done: true, timestamp: at(19), completedAt: at(19) },
];

/** A real chat's saved session (GET /v0/sessions/:id) put in localStorage under gallery:seed replaces the seed,
 *  so the previews can be checked against the app on the same transcript. */
const stored = (() => { try { return JSON.parse(localStorage.getItem("gallery:seed") || "null") as { messages: Message[]; tools: ToolItem[]; id?: string } | null; } catch { return null; } })();

export function fakeChat() {
  const [draft, setDraft] = createSignal("");
  const [messages, setMessages] = createSignal<Message[]>(stored?.messages ?? SEED);
  // Editing an earlier message: its text into the draft, and the way out the transcript shows over the composer.
  const [editingEntryId, setEditingEntryId] = createSignal<string | null>(null);
  let next = 0;
  const named: Record<string, unknown> = {
    draft, setDraft,
    loadedId: () => "gallery",
    generation: () => "idle",
    interactionReady: () => true,
    capabilities: () => ({}),
    editingEntryId,
    edit: (message: Message) => { if (editingEntryId() === message.id) { setEditingEntryId(null); setDraft(""); return; } setEditingEntryId(message.id); setDraft(typeof message.content === "string" ? message.content : ""); },
    cancelEdit: () => { setEditingEntryId(null); setDraft(""); },
    messages, hostUiRequests: () => [], pendingMessages: () => [], harnessCommands: () => [], tools: () => stored?.tools ?? TOOLS,
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

/** Files attached in the gallery stay in the page: added at once, as if uploaded. */
export function fakeAttachments() {
  const [items, setItems] = createSignal<UploadAttachment[]>([]);
  let next = 0;
  const addFiles = (files: File[]) => setItems((list) => [...list, ...files.map((file) => ({
    id: `fake-${next++}`, name: file.name, type: file.type, size: file.size, file,
    objectUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null, status: "done" as const, progress: 100,
  }))]);
  const remove = (item: UploadAttachment) => setItems((list) => list.filter((entry) => entry.id !== item.id));
  return { items, pendingIds: () => [], addFiles, remove, retry: () => {}, clear: () => setItems([]) } as never;
}
