import { createMemo, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { Button, Input, Textarea } from "@/components/primitives";
import type { HostUiRequest, Question, QuestionAnswer } from "../api/contracts";
import "./question-card.css";

export type QuestionResponse = { id: string; cancelled?: boolean; answers?: QuestionAnswer[] };

type Draft = { optionIds: string[]; freeform: string; note: string };

const answered = (draft: Draft) => draft.optionIds.length > 0 || draft.freeform.trim() !== "";

/**
 * A harness's question tool: one or more questions, each with offered answers
 * and, where the harness takes one, a typed answer, sent back together.
 *
 * A single question of offered answers alone is answered by the tap, as an
 * approval is; anything more waits for Submit.
 */
export function QuestionCard(props: { request: HostUiRequest; onRespond: (response: QuestionResponse) => void }) {
  const questions = () => props.request.questions || [];
  const [drafts, setDrafts] = createStore<Record<string, Draft>>(
    Object.fromEntries(questions().map((question) => [question.id, { optionIds: [], freeform: "", note: "" }])));
  // The option whose preview is shown: the one last pointed at, else the chosen one.
  const [previewed, setPreviewed] = createSignal<Record<string, string>>({});
  const draft = (question: Question): Draft => drafts[question.id] ?? { optionIds: [], freeform: "", note: "" };
  const oneTap = createMemo(() => {
    const [only, ...rest] = questions();
    return Boolean(only && !rest.length && !only.multiSelect && !only.freeform && !props.request.notes);
  });
  const ready = createMemo(() => questions().every((question) => !question.required || answered(draft(question)))
    && questions().some((question) => answered(draft(question))));

  const answers = (): QuestionAnswer[] => questions().map((question) => ({ questionId: question.id,
    optionIds: [...draft(question).optionIds], freeform: draft(question).freeform.trim() || undefined,
    note: draft(question).note.trim() || undefined }));
  const submit = () => { if (ready()) props.onRespond({ id: props.request.id, answers: answers() }); };

  const choose = (question: Question, optionId: string) => {
    setPreviewed((current) => ({ ...current, [question.id]: optionId }));
    if (question.multiSelect) {
      const chosen = draft(question).optionIds;
      setDrafts(question.id, "optionIds", chosen.includes(optionId) ? chosen.filter((id) => id !== optionId) : [...chosen, optionId]);
      return;
    }
    // One answer: an offered one replaces anything typed.
    setDrafts(question.id, { optionIds: [optionId], freeform: "" });
    if (oneTap()) submit();
  };
  const type = (question: Question, value: string) => {
    setDrafts(question.id, question.multiSelect ? { freeform: value } : { freeform: value, optionIds: value ? [] : draft(question).optionIds });
  };
  const preview = (question: Question) => {
    const id = previewed()[question.id] || draft(question).optionIds[0];
    return question.options.find((option) => option.id === id)?.preview;
  };

  return <section class="host-ui-card question-card" aria-label={props.request.title || "The agent has a question"}>
    <strong>{props.request.title || "The agent has a question"}</strong>
    <div class="question-card-body">
      <For each={questions()}>{(question) => <div class="question-block" role="group" aria-label={question.header || question.prompt}>
        <Show when={question.header}><span class="question-header">{question.header}</span></Show>
        <Show when={question.prompt}><p class="question-prompt">{question.prompt}</p></Show>
        <Show when={question.options.length}>
          <div class="question-options" role={question.multiSelect ? "group" : "radiogroup"}>
            <For each={question.options}>{(option) => <button type="button" class="question-option"
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={draft(question).optionIds.includes(option.id)}
              data-multi={question.multiSelect ? "true" : undefined}
              onPointerEnter={() => option.preview && setPreviewed((current) => ({ ...current, [question.id]: option.id }))}
              onFocus={() => option.preview && setPreviewed((current) => ({ ...current, [question.id]: option.id }))}
              onClick={() => choose(question, option.id)}>
              <span class="question-mark" aria-hidden="true" />
              <span class="question-option-text">
                <span class="question-option-label">{option.label}</span>
                <Show when={option.description}><span class="question-option-description">{option.description}</span></Show>
              </span>
            </button>}</For>
          </div>
        </Show>
        <Show when={preview(question)}>{(shown) =>
          <pre class="question-preview" data-format={shown().format}>{shown().text}</pre>}</Show>
        <Show when={question.freeform}>{(freeform) => {
          const label = question.options.length ? "Other answer" : question.prompt || "Answer";
          const placeholder = freeform().placeholder || (question.options.length ? "Something else…" : "Type your answer");
          return freeform().multiline
            ? <Textarea class="question-freeform" aria-label={label} placeholder={placeholder}
              value={draft(question).freeform} onInput={(event) => type(question, event.currentTarget.value)} />
            : <Input class="question-freeform" aria-label={label} placeholder={placeholder}
              type={question.secret ? "password" : "text"} inputmode={freeform().numeric ? "decimal" : undefined}
              value={draft(question).freeform} onInput={(event) => type(question, event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submit(); } }} />;
        }}</Show>
        <Show when={props.request.notes && answered(draft(question))}>
          <Input class="question-note" aria-label="Note" placeholder="Add a note (optional)"
            value={draft(question).note} onInput={(event) => setDrafts(question.id, "note", event.currentTarget.value)} />
        </Show>
      </div>}</For>
    </div>
    <div class="host-ui-actions">
      <Button size="sm" variant="ghost" onClick={() => props.onRespond({ id: props.request.id, cancelled: true })}>Dismiss</Button>
      <Show when={!oneTap()}><Button size="sm" disabled={!ready()} onClick={submit}>Submit</Button></Show>
    </div>
  </section>;
}
