import { InteractiveRequestCard } from "./interactive-request-card.jsx";
import { registerTimelineItemRenderer } from "./tool-registry.js";

export function QuestionTimelineItem({ item, sessionId, onRespond }) {
  const request = item?.value;
  const submit = (response) => {
    if (!request || typeof onRespond !== "function") return;
    onRespond({ id: request.id, ...response });
  };
  return <InteractiveRequestCard request={request} onSubmit={submit} />;
}

registerTimelineItemRenderer("question", QuestionTimelineItem);
