import { lazy, memo, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AgentActivityRow } from "./agent-activity";
import { ReasoningBlock } from "./reasoning-block";
import { ResponseActions } from "./response-actions";
import { AttachmentCards } from "./attachment-tray";
import { buildTimeline } from "./timeline-order";
import { timelineItemRenderers } from "./tool-registry.js";
import "./tool-card.jsx"; // registers the default tool renderer + timelineItemRenderers.tool
import "./question-card.jsx"; // registers timelineItemRenderers.question

const ChatMarkdown = lazy(() => import("./chat-markdown").then((module) => ({
  default: module.ChatMarkdown,
})));

// Timeline rows participate in the message-scroller's pre-paint scroll math, so
// they must lay out at their real height. Override the generated wrapper's lazy
// [content-visibility:auto]/[contain-intrinsic-size] placeholders (tailwind-merge
// keeps these later arbitrary-property values); pristine wrapper preserved.
const eagerItem = "[content-visibility:visible] [contain-intrinsic-size:none]";

const time = (value) => value
  ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  : "";

function AssistantMessage({ message, liveStore, live }) {
  const stream = useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot, liveStore.getServerSnapshot);
  const text = live ? `${message.content || ""}${stream.content}` : String(message.content || "");
  return <ChatMarkdown streaming={live}>{text}</ChatMarkdown>;
}

export const ChatThread = memo(function ChatThread({
  messages, tools, streaming, sessionId, hasOlder, loadingOlder, partialContinue,
  editingEntryId, onLoadOlder, onCopyMessage, onEditMessage, onRegenerate, onContinue, liveStore,
  activity = null, reasoning = null, requests = [], onRespond,
}) {
  const older = useRef(null);
  useEffect(() => {
    if (!hasOlder || !older.current || !onLoadOlder) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadOlder();
    }, { rootMargin: "240px" });
    observer.observe(older.current);
    return () => observer.disconnect();
  }, [hasOlder, onLoadOlder]);
  const timeline = buildTimeline(messages, tools, { streaming, requests });
  const lastMessage = messages[messages.length - 1];
  const empty = timeline.length === 0;

  return <MessageScrollerProvider autoScroll>
    <MessageScroller className="transcript">
      <MessageScrollerViewport>
        <MessageScrollerContent className="thread">
          {hasOlder && <MessageScrollerItem className={eagerItem}>
            <Button ref={older} variant="ghost" className="mx-auto" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder && <Spinner data-icon="inline-start" />}{loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
            </Button>
          </MessageScrollerItem>}
          {empty && !activity?.label && <MessageScrollerItem className={`empty-thread ${eagerItem}`}>
            <Empty className="welcome"><EmptyHeader><EmptyTitle><h1>How can I help you today?</h1></EmptyTitle></EmptyHeader></Empty>
          </MessageScrollerItem>}
          {timeline.map((item) => {
            const ItemRenderer = timelineItemRenderers[item.type];
            if (ItemRenderer) return <MessageScrollerItem key={`${item.type}_${item.value.id}`} className={eagerItem}>
              <ItemRenderer item={item} sessionId={sessionId} onRespond={onRespond} />
            </MessageScrollerItem>;
            const message = item.value;
            const isUser = message.role === "user";
            const isEditing = message.id === editingEntryId;
            const live = streaming && message === lastMessage && !isUser;
            const candidateReasoning = live ? reasoning : message.reasoning;
            const messageReasoning = candidateReasoning?.observed ? candidateReasoning : null;
            const precedingUser = !isUser ? messages.slice(0, item.index).findLast((candidate) => candidate.role === "user") : null;
            return <MessageScrollerItem
              key={`message_${message.key ?? message.id}`}
              className={eagerItem}
              messageId={message.id}
              scrollAnchor={isUser}
            >
              <Message align={isUser ? "end" : "start"}>
                <MessageContent>
                  {message.timestamp && <MessageHeader>{time(message.timestamp)}</MessageHeader>}
                  <Bubble
                    align={isUser ? "end" : "start"}
                    variant={isUser ? "muted" : "ghost"}
                    data-editing={isEditing}
                    className="data-[editing=true]:outline-2 data-[editing=true]:outline-offset-2 data-[editing=true]:outline-ring"
                  >
                    <BubbleContent>
                      {isUser ? <span className="user-message-text">{String(message.content || "")}</span>
                        : <>
                            {messageReasoning && (
                              <ReasoningBlock
                                content={messageReasoning.content}
                                redacted={messageReasoning.redacted}
                                active={messageReasoning.status === "active"}
                                durationSeconds={messageReasoning.durationSeconds}
                              />
                            )}
                            <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                              <AssistantMessage message={message} liveStore={liveStore} live={live} />
                            </Suspense>
                          </>}
                    </BubbleContent>
                  </Bubble>
                  {isUser && message.pending && <Marker>
                    <MarkerContent>
                      {message.queueMode === "steer" ? "Queued · steer (after tools)" : "Queued · follow-up (after turn)"}
                    </MarkerContent>
                  </Marker>}
                  {isUser && <AttachmentCards
                    items={message.attachments || []}
                    chatId={sessionId}
                    className="message-attachments"
                    label="Message attachments"
                  />}
                  {message.stopped && <Marker><MarkerContent>{message.status === "stopping" ? "Stopping…" : "Stopped"}</MarkerContent></Marker>}
                  {!streaming && <ResponseActions
                    message={message}
                    precedingUserId={precedingUser?.id}
                    partialContinue={partialContinue}
                    editing={isEditing}
                    onCopy={onCopyMessage}
                    onEdit={onEditMessage}
                    onRegenerate={onRegenerate}
                    onContinue={onContinue}
                  />}
                </MessageContent>
              </Message>
            </MessageScrollerItem>;
          })}
          {activity?.label && activity.kind !== "idle" && <MessageScrollerItem className={eagerItem} key="agent-activity">
            <AgentActivityRow activity={activity} />
          </MessageScrollerItem>}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  </MessageScrollerProvider>;
});
