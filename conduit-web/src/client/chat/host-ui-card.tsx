import { For } from "solid-js";
import type { HostUiRequest } from "../api/contracts";
import { QuestionCard, type QuestionResponse } from "./question-card";

type HostUiResponse = { id: string; cancelled?: boolean; confirmed?: boolean; value?: string } | QuestionResponse;

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
    ...(request.kind === "confirm" ? { approval: { title: request.title || request.message || "Allow this?", lines: request.title && request.message ? [request.message] : [] } } : {}),
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

/* A harness reads a dismissed approval as a denial, so Esc says so. */
const dismissLabel = (request: HostUiRequest) =>
  request.kind === "confirm" || request.options?.some((option) => /^deny$/i.test(option)) ? "deny" : "dismiss";

export function HostUiRequests(props: { requests: HostUiRequest[]; onRespond: (response: HostUiResponse) => void; onStop?: () => void }) {
  return <For each={props.requests.slice(0, 1)}>{(request) =>
    <QuestionCard request={asQuestion(request)} dismissLabel={dismissLabel(request)} onStop={props.onStop} onRespond={(response) => props.onRespond(fromAnswer(request, response))} />}</For>;
}
