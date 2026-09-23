import { For } from "solid-js";
import type { HostUiRequest } from "../api/contracts";
import { QuestionCard, type QuestionResponse } from "./question-card";

type HostUiResponse = { id: string; cancelled?: boolean; confirmed?: boolean; value?: string } | QuestionResponse;

/*
 * Everything the agent is blocked on is asked the same way: on the composer
 * takeover, as numbered rows with keys. An approval, a choice or a line of
 * text is one question of one answer -- choosing is answering -- so it takes
 * the question's place, motion and keyboard rather than a card of its own
 * stacked above the composer. What the harness asked for goes back in its own
 * shape.
 */
const asQuestion = (request: HostUiRequest): HostUiRequest => {
  if (request.kind === "question") return request;
  const labels = request.kind === "confirm" ? ["Approve", "Deny"] : request.kind === "select" ? request.options || [] : [];
  const typed = request.kind === "input" || request.kind === "editor";
  return { ...request, kind: "question", questions: [{
    id: request.id,
    header: request.message ? request.title || "" : "",
    prompt: request.message || request.title || "The agent needs your input",
    multiSelect: false, secret: false, required: true,
    options: labels.map((label, index) => ({ id: String(index), label, description: "" })),
    freeform: typed ? { placeholder: request.placeholder, multiline: request.kind === "editor", initial: request.prefill } : false,
  }] };
};

const fromAnswer = (request: HostUiRequest, response: QuestionResponse): HostUiResponse => {
  if (request.kind === "question") return response;
  const answer = response.cancelled ? undefined : response.answers?.[0];
  if (request.kind === "confirm") return { id: request.id, confirmed: answer?.optionIds[0] === "0" };
  if (!answer) return { id: request.id, cancelled: true };
  if (request.kind === "select") return { id: request.id, value: request.options?.[Number(answer.optionIds[0])] ?? "" };
  return { id: request.id, value: answer.freeform ?? "" };
};

/* Esc turns an approval down -- a harness reads a dismissed approval as a
   denial -- so it says so; anything else is dismissed. */
const dismissLabel = (request: HostUiRequest) =>
  request.kind === "confirm" || request.options?.some((option) => /^deny$/i.test(option)) ? "deny" : "dismiss";

export function HostUiRequests(props: { requests: HostUiRequest[]; onRespond: (response: HostUiResponse) => void }) {
  return <For each={props.requests.slice(0, 1)}>{(request) => <div class="question-dock">
    <QuestionCard request={asQuestion(request)} dismissLabel={dismissLabel(request)} onRespond={(response) => props.onRespond(fromAnswer(request, response))} />
  </div>}</For>;
}
