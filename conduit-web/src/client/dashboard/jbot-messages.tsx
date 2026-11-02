import { createSignal, For, Match, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { Answer, DashConversation, Message, MessageFoot, ReportCard, Transcript, TranscriptRow, Turn, type TranscriptFlow } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { api } from "../api/client";
import { ChatMarkdown } from "../chat/lazy-markdown";
import type { MarkdownRendererId } from "../chat/markdown-settings";

/**
 * jbot's messages on its page (docs/plans/persistent-agent.md › Talking to the person): the message log's app room,
 * newest at the foot, held there while you read (DashConversation), over the page's composer. What the person says
 * is a bubble; what jbot says is an answer; a report (a message with a title) is a card opening in a reader.
 */
export interface LogMessage {
  id: string; at: string; channel: string; room: string; direction: "in" | "out"; sender: "person" | "jbot";
  title?: string; body: string; notify: "none" | "push" | "urgent"; delivery?: { state: string; error?: string };
}

const clock = (at: string) => { const date = new Date(at); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; };
const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.replace(/^[#>*\s-]+/, "").trim()).find(Boolean) || "";

/** The stream, over the page's composer (the home thread's own); polls while the page is open. */
export function useJbotMessages() {
  const [messages, setMessages] = createSignal<LogMessage[]>([]);
  const refresh = () => api<{ messages: LogMessage[] }>("/v0/agent/messages?limit=100").then((result) => setMessages(result.messages)).catch(() => {});
  onMount(() => {
    void refresh();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3000);
    onCleanup(() => window.clearInterval(tick));
  });
  return { messages, refresh };
}

export function JbotMessages(props: { messages: LogMessage[]; renderer: MarkdownRendererId; name: string }) {
  const [reading, setReading] = createSignal<LogMessage | null>(null);
  // The person's message starts an exchange; jbot's reply to it is the exchange's; what jbot says next, a step on.
  const flowAt = (index: number): TranscriptFlow | undefined => {
    if (index <= 0) return undefined;
    const row = props.messages[index]!, above = props.messages[index - 1]!;
    return row.direction === "in" ? "turn" : above.direction === "in" ? "exchange" : "step";
  };
  const markdown = (text: string) => <Answer><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown renderer={props.renderer} streaming={false}>{text}</ChatMarkdown></Suspense></Answer>;
  return <>
    <DashConversation label={`Messages with ${props.name}`}>
      <Show when={props.messages.length} fallback={<p class="ui-dash-empty">Nothing said yet. Say something to {props.name}.</p>}>
        <Transcript>
          <For each={props.messages}>{(message, index) =>
            <TranscriptRow flow={flowAt(index())} data-message-id={message.id}>
              <Switch>
                <Match when={message.direction === "in"}>
                  <Message time={clock(message.at)} dateTime={message.at}>{message.body}</Message>
                </Match>
                <Match when={message.title}>
                  <ReportCard title={message.title!} line={firstLine(message.body)} time={clock(message.at)} notified={message.notify !== "none"} onOpen={() => setReading(message)} />
                </Match>
                <Match when={true}>
                  <Turn>{markdown(message.body)}<MessageFoot time={clock(message.at)} dateTime={message.at} status={message.notify !== "none" ? "Sent to your phone" : undefined} /></Turn>
                </Match>
              </Switch>
            </TranscriptRow>}
          </For>
        </Transcript>
      </Show>
    </DashConversation>
    <Dialog open={reading() !== null} onOpenChange={(open) => { if (!open) setReading(null); }} title={reading()?.title || ""} size="large" close="Close">
      <Show when={reading()}>{(message) => markdown(message().body)}</Show>
    </Dialog>
  </>;
}
