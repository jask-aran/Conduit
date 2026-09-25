import { createResource, createSignal, createEffect, onCleanup, Show } from "solid-js";
import { api } from "../api/client";
import type { ChatSummary, Message, Project, ToolKind, TranscriptDetail } from "../api/contracts";
import { harnessLabelFor, ThreadHarnessMark } from "../harness-brand";
import { PLAIN_SPHERE, SPUTTERING_SPHERE } from "../chat/orb-frames";
import { ThinkingOrb } from "../chat/thinking-orb";

/*
 * Chat search's preview column: the highlighted chat's last prompt, the start
 * of what it answered, and how that turn ended, so chats that share a title
 * can be told apart without opening them. It reads the chat's latest page,
 * a moment after the cursor settles, and keeps what it read for the rest of
 * the search.
 */
type Target = { chat: ChatSummary; project: Project };
type Glance = { prompt: string; answer: string; outcome: "Done" | "Interrupted" | "Failed" | null; took: string; work: string };

const WORK_WORDS: Record<ToolKind, [string, string]> = {
  command: ["command", "commands"], read: ["read", "reads"], edit: ["edit", "edits"],
  search: ["search", "searches"], fetch: ["fetch", "fetches"], other: ["tool", "tools"],
};
const cache = new Map<string, Glance>();

/* Markdown's marks, dropped for a few quiet lines. */
const plain = (text = "") => text.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~|]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
const textOf = (message?: Message) => plain(message?.content || (message?.blocks || []).map((block) => (block as { type?: string; text?: string }).type === "text" ? (block as { text?: string }).text || "" : "").join(" "));

function took(from?: string, to?: string) {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.floor(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${String(seconds).padStart(2, "0")}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function glance(detail: TranscriptDetail): Glance {
  const messages = detail.messages || [];
  const promptAt = messages.findLastIndex((message) => message.role === "user");
  const prompt = messages[promptAt];
  const answers = messages.slice(promptAt + 1).filter((message) => message.role === "assistant");
  const answer = answers.findLast((message) => textOf(message)) || answers.at(-1);
  const outcome = !prompt || detail.turnOpen ? null
    : prompt.outcome === "failed" || answer?.stopReason === "error" ? "Failed"
      : prompt.outcome === "interrupted" || answer?.stopped ? "Interrupted" : "Done";
  const since = prompt?.timestamp ? Date.parse(prompt.timestamp) : 0;
  const counts = new Map<ToolKind, number>();
  for (const tool of detail.tools || []) {
    if (tool.timestamp && Date.parse(tool.timestamp) < since) continue;
    counts.set(tool.kind || "other", (counts.get(tool.kind || "other") || 0) + 1);
  }
  const work = [...counts].sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${n} ${WORK_WORDS[kind][n === 1 ? 0 : 1]}`).join(", ");
  return { prompt: textOf(prompt), answer: answer?.errorMessage ? plain(answer.errorMessage) : textOf(answer), outcome, took: took(prompt?.timestamp, answers.at(-1)?.timestamp), work };
}

const dateOf = (value?: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
};

export function ChatPreview(props: { target: Target | null; folder?: Project | null }) {
  // The cursor has to rest a moment before a chat is read.
  const [settled, setSettled] = createSignal<Target | null>(null);
  createEffect(() => {
    const target = props.target;
    const timer = setTimeout(() => setSettled(target), target && cache.has(key(target)) ? 0 : 140);
    onCleanup(() => clearTimeout(timer));
  });
  const key = (target: Target) => `${target.chat.id}:${target.chat.lastMessageAt || target.chat.updatedAt || ""}`;
  const [read] = createResource(settled, async (target) => {
    const found = cache.get(key(target));
    if (found) return found;
    const next = glance(await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(target.chat.id)}`));
    cache.set(key(target), next);
    return next;
  });

  return <aside class="command-preview" aria-label="Chat preview" aria-live="polite">
    <Show when={props.target} fallback={<p class="command-preview-empty">{props.folder ? props.folder.name : "Nothing highlighted"}</p>}>
      {(target) => <>
        <div class="command-preview-title"><ThreadHarnessMark id={target().chat.harnessId} /><span>{target().chat.title || "Untitled chat"}</span></div>
        <div class="command-preview-facts">
          <span>{harnessLabelFor(target().chat.harnessId || target().chat.backend?.implementation)}</span>
          <span>{target().project.slug === "chat" ? "Chats" : target().project.name}</span>
          <span>Updated {dateOf(target().chat.lastMessageAt || target().chat.updatedAt)} · created {dateOf(target().chat.createdAt)}</span>
        </div>
        <Show when={settled()?.chat.id === target().chat.id && !read.loading && !read.error && read()}>
          {(seen) => <>
            <Show when={seen().prompt}><p class="command-preview-prompt">{seen().prompt}</p></Show>
            <Show when={seen().answer}><p class="command-preview-answer">{seen().answer}</p></Show>
            <Show when={seen().outcome}>
              <div class="command-preview-turn">
                <ThinkingOrb state="working" frame={seen().outcome === "Done" ? PLAIN_SPHERE : SPUTTERING_SPHERE} tint={seen().outcome === "Done" ? undefined : "var(--destructive)"} />
                <span><b>{seen().outcome}</b>{seen().took ? ` · ${seen().took}` : ""}{seen().work ? ` · ${seen().work}` : ""}</span>
              </div>
            </Show>
            <Show when={!seen().prompt}><p class="command-preview-empty">No messages yet</p></Show>
          </>}
        </Show>
        <Show when={read.error && settled()?.chat.id === target().chat.id}><p class="command-preview-empty">Couldn't read this chat</p></Show>
      </>}
    </Show>
  </aside>;
}
