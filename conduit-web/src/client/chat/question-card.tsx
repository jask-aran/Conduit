import { Icons } from "@/components/ui";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";

import { ApprovalSummary, Button, Choice, ChoiceInput, Choices, ChoicesPage, Hints, Input, Preview, Prompt, Rider, RiderFoot, RiderTop, RiderTitle, Summary, Tab, Tabs, TextArea } from "@/components/ui";
import type { HostUiRequest, Question, QuestionAnswer } from "../api/contracts";

export type QuestionResponse = { id: string; cancelled?: boolean; answers?: QuestionAnswer[] };

type Draft = { optionIds: string[]; freeform: string; note: string };

const EMPTY: Draft = { optionIds: [], freeform: "", note: "" };
const answered = (draft: Draft) => draft.optionIds.length > 0 || draft.freeform.trim() !== "";
const typingIn = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/**
 * A harness's question tool, one question at a time.
 *
 * The questions are tabs, answered in turn and then reviewed on a Submit page
 * that sends them together. A single question of one answer is sent by
 * choosing that answer; nothing then needs reviewing. The card keeps the
 * keyboard while it is up -- arrows move, a number or Enter chooses, Tab turns
 * the page, Esc dismisses -- and touch has the same through taps and Next.
 */
export function QuestionCard(props: { request: HostUiRequest; dismissLabel?: string; onStop?: () => void; onRespond: (response: QuestionResponse) => void }) {
  const questions = () => props.request.questions || [];
  const [drafts, setDrafts] = createStore<Record<string, Draft>>(
    Object.fromEntries(questions().map((question) => [question.id, { ...EMPTY, freeform: (question.freeform && question.freeform.initial) || "" }])));
  const draft = (question: Question): Draft => drafts[question.id] ?? EMPTY;
  const review = createMemo(() => questions().length > 1 || Boolean(questions()[0]?.multiSelect) || Boolean(props.request.notes));
  const [page, setPage] = createSignal(0);
  const [cursor, setCursor] = createSignal(0);
  const pages = () => questions().length + (review() ? 1 : 0);
  const current = () => questions()[page()];
  const lastQuestion = () => page() === questions().length - 1;
  const ready = createMemo(() => questions().every((question) => !question.required || answered(draft(question)))
    && questions().some((question) => answered(draft(question))));
  let root: HTMLElement | undefined;
  let own: HTMLInputElement | HTMLTextAreaElement | undefined;

  onMount(() => {
    // The card stands in for the composer while it is up, so it takes the
    // keyboard; a half-typed message waits in the composer for its return.
    root?.focus({ preventScroll: true });
  });

  const respond = (response: QuestionResponse) => {
    const hadFocus = root?.contains(document.activeElement);
    props.onRespond(response);
    if (hadFocus) document.querySelector<HTMLTextAreaElement>("textarea[data-composer-input]")?.focus({ preventScroll: true });
  };
  const dismiss = () => respond({ id: props.request.id, cancelled: true });
  const submit = () => {
    if (!ready()) {
      const missing = questions().findIndex((question) => question.required && !answered(draft(question)));
      go(Math.max(0, missing));
      return;
    }
    respond({ id: props.request.id, answers: questions().map((question) => ({ questionId: question.id,
      optionIds: [...draft(question).optionIds], freeform: draft(question).freeform.trim() || undefined,
      note: draft(question).note.trim() || undefined })) });
  };

  const go = (index: number) => {
    const next = (index + pages()) % pages();
    const question = questions()[next];
    setPage(next);
    setCursor(question ? Math.max(0, question.options.findIndex((option) => draft(question).optionIds.includes(option.id))) : 0);
    root?.focus({ preventScroll: true });
  };
  const advance = () => {
    if (!lastQuestion() && current()) go(page() + 1);
    else if (review() && current()) go(questions().length);
    else submit();
  };
  const choose = (question: Question, index: number) => {
    setCursor(index);
    const option = question.options[index];
    if (!option) { own?.focus(); return; }
    const chosen = draft(question).optionIds;
    if (question.multiSelect) {
      setDrafts(question.id, "optionIds", chosen.includes(option.id) ? chosen.filter((id) => id !== option.id) : [...chosen, option.id]);
      return;
    }
    // One answer: an offered one replaces anything typed.
    setDrafts(question.id, { optionIds: [option.id], freeform: "" });
    advance();
  };
  const type = (question: Question, value: string) => setDrafts(question.id, question.multiSelect
    ? { freeform: value } : { freeform: value, optionIds: value ? [] : draft(question).optionIds });
  const rows = (question: Question) => question.options.length + (question.freeform ? 1 : 0);

  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const question = current();
    const typing = typingIn(event.target);
    const take = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "Escape") { take(); if (typing) root?.focus(); else dismiss(); return; }
    if (event.key === "Tab" && pages() > 1) { take(); go(page() + (event.shiftKey ? -1 : 1)); return; }
    if (typing) {
      if (event.key === "Enter" && !event.shiftKey) { take(); advance(); }
      else if (event.key === "ArrowUp" && question) { take(); setCursor(Math.max(0, question.options.length - 1)); root?.focus(); }
      return;
    }
    if (event.key === "ArrowLeft" && page() > 0) { take(); go(page() - 1); return; }
    if (event.key === "ArrowRight" && page() < pages() - 1) { take(); go(page() + 1); return; }
    if (!question) { if (event.key === "Enter") { take(); submit(); } return; }
    const count = rows(question);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      take();
      const next = (cursor() + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
      setCursor(next);
      if (next === question.options.length) own?.focus();
      return;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= count) { take(); choose(question, digit - 1); return; }
    if (event.key === "Enter" || event.key === " ") { take(); choose(question, cursor()); }
  };

  const answerText = (question: Question) => [
    ...question.options.filter((option) => draft(question).optionIds.includes(option.id)).map((option) => option.label),
    ...(draft(question).freeform.trim() ? [question.secret ? "••••" : draft(question).freeform.trim()] : []),
  ].join(", ");
  const hints = (): [string, string][] => [
    ...(pages() > 1 ? [["⇥", "tab"] as [string, string]] : []),
    ...(current() ? [["↑↓", "select"], ["↵", current()!.multiSelect ? "toggle" : "confirm"]] as [string, string][] : [["↵", "submit"] as [string, string]]),
    ["esc", props.dismissLabel || "dismiss"],
  ];
  const preview = () => current()?.options[cursor()]?.preview;

  return <Rider ref={(element: HTMLDivElement) => { root = element; }} layout="card" motion="entering" tabIndex={-1} label={props.request.title || "The agent has a question"} onKeyDown={keydown}>
    <RiderTop>
      <Show when={pages() > 1} fallback={<RiderTitle>{current()?.header || props.request.title}</RiderTitle>}>
        <Tabs>
          <For each={questions()}>{(question, index) => <Tab selected={page() === index()} done={answered(draft(question))} onClick={() => go(index())}>{question.header || `Question ${index() + 1}`}</Tab>}</For>
          <Show when={review()}><Tab selected={!current()} onClick={() => go(questions().length)}>Submit</Tab></Show>
        </Tabs>
      </Show>
      <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label={props.dismissLabel === "deny" ? "Deny" : "Dismiss"} onClick={dismiss}><Icons.Close /></Button>
    </RiderTop>

    <Show when={current()} keyed fallback={<Summary rows={questions().map((question, index) => ({ label: question.header || question.prompt,
      value: answered(draft(question)) ? answerText(question) : question.required ? "Needs an answer" : "Not answered", empty: !answered(draft(question)), onOpen: () => go(index) }))} />}>
      {(question) => <ChoicesPage>
        <Show when={question.approval} fallback={<Prompt multi={question.multiSelect}>{question.prompt}</Prompt>}>{(approval) =>
          <ApprovalSummary title={approval().title} service={approval().service} lines={approval().lines} />}
        </Show>
        <Choices multi={question.multiSelect}>
          <For each={question.options}>{(option, index) => <Choice n={index() + 1} label={option.label} detail={option.description || undefined} title={option.description || undefined}
            chosen={draft(question).optionIds.includes(option.id)} active={cursor() === index()} multi={question.multiSelect} onPoint={() => setCursor(index())} onPick={() => choose(question, index())} />}</For>
          <Show when={question.freeform}>{(freeform) => {
            const placeholder = freeform().placeholder || (question.options.length ? "Type your own answer" : "Type your answer");
            const input = (event: InputEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => type(question, event.currentTarget.value);
            const mine = () => setCursor(question.options.length);
            // A TextArea, held to one line unless the question asks for more; a secret stays a masked input.
            return <Choice n={question.options.length + 1} chosen={Boolean(draft(question).freeform.trim())} active={cursor() === question.options.length} onPoint={mine} onPick={() => own?.focus()}
              own={question.secret
                ? <ChoiceInput ref={(element) => { own = element; }} placeholder={placeholder} aria-label={placeholder} type="password" inputmode={freeform().numeric ? "decimal" : undefined}
                  value={draft(question).freeform} onInput={input} onFocus={mine} />
                : <TextArea ref={(element) => { own = element; }} rows={freeform().multiline ? 2 : 1} placeholder={placeholder} aria-label={placeholder}
                  inputmode={freeform().numeric ? "decimal" : undefined} value={draft(question).freeform}
                  onKeyDown={(event) => { if (!freeform().multiline && event.key === "Enter") event.preventDefault(); }}
                  onInput={(event) => { if (!freeform().multiline && event.currentTarget.value.includes("\n")) event.currentTarget.value = event.currentTarget.value.replace(/\n/g, " "); input(event); }}
                  onFocus={mine} />} />;
          }}</Show>
        </Choices>
        <Show when={preview()}>{(shown) => <Preview format={shown().format}>{shown().text}</Preview>}</Show>
        <Show when={props.request.notes && answered(draft(question))}>
          <Input data-note="" placeholder="Add a note (optional)" aria-label="Note" value={draft(question).note} onInput={(event) => setDrafts(question.id, "note", event.currentTarget.value)} />
        </Show>
      </ChoicesPage>}
    </Show>

    <RiderFoot>
      <Hints hints={hints()} />
      <Show when={props.onStop}>
        <Button variant="ghost" size="sm" tabIndex={-1} onClick={() => props.onStop?.()}>Stop</Button>
      </Show>
      <Button variant="primary" size="sm" tabIndex={-1} disabled={!current() && !ready()} onClick={() => current() ? advance() : submit()}>
        {!current() || (lastQuestion() && !review()) ? "Submit" : "Next"}
      </Button>
    </RiderFoot>
  </Rider>;
}
