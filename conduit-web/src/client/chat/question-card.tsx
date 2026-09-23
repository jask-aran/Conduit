import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { CheckIcon, XIcon } from "lucide-solid";
import { Button } from "@/components/primitives";
import type { HostUiRequest, Question, QuestionAnswer } from "../api/contracts";
import { COMPOSER_SURFACE_CHANGE_EVENT, selectedComposerSurface, type ComposerSurfaceMode } from "./composer-surface";
import "./question-card.css";

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
export function QuestionCard(props: { request: HostUiRequest; onRespond: (response: QuestionResponse) => void }) {
  const questions = () => props.request.questions || [];
  const [drafts, setDrafts] = createStore<Record<string, Draft>>(
    Object.fromEntries(questions().map((question) => [question.id, { ...EMPTY }])));
  const draft = (question: Question): Draft => drafts[question.id] ?? EMPTY;
  const review = createMemo(() => questions().length > 1 || Boolean(questions()[0]?.multiSelect) || Boolean(props.request.notes));
  const [page, setPage] = createSignal(0);
  const [cursor, setCursor] = createSignal(0);
  const pages = () => questions().length + (review() ? 1 : 0);
  const current = () => questions()[page()];
  const lastQuestion = () => page() === questions().length - 1;
  const ready = createMemo(() => questions().every((question) => !question.required || answered(draft(question)))
    && questions().some((question) => answered(draft(question))));
  const [surface, setSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  let root: HTMLElement | undefined;
  let own: HTMLInputElement | HTMLTextAreaElement | undefined;

  onMount(() => {
    const changed = (event: Event) => setSurface((event as CustomEvent<ComposerSurfaceMode>).detail);
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, changed);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, changed));
    // The card stands in for the composer while it is up, so it takes the
    // keyboard; a half-typed message waits in the composer for its return.
    root?.focus({ preventScroll: true });
  });

  const respond = (response: QuestionResponse) => {
    const hadFocus = root?.contains(document.activeElement);
    props.onRespond(response);
    if (hadFocus) document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true });
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
  const hints = () => [
    ...(pages() > 1 ? [["⇥", "tab"]] : []),
    ...(current() ? [["↑↓", "select"], ["↵", current()!.multiSelect ? "toggle" : "confirm"]] : [["↵", "submit"]]),
    ["esc", "dismiss"],
  ];
  const preview = () => current()?.options[cursor()]?.preview;

  return <section ref={root} class="question-card composer-surface-material" data-composer-surface={surface()}
    tabIndex={-1} aria-label={props.request.title || "The agent has a question"} onKeyDown={keydown}>
    <div class="question-top">
      <Show when={pages() > 1} fallback={<span class="question-title">{current()?.header || props.request.title}</span>}>
        <div class="question-tabs" role="tablist">
          <For each={questions()}>{(question, index) => <button type="button" role="tab" aria-selected={page() === index()}
            tabIndex={-1} onClick={() => go(index())}>
            <Show when={answered(draft(question))}><CheckIcon aria-label="Answered" /></Show>
            {question.header || `Question ${index() + 1}`}
          </button>}</For>
          <Show when={review()}><button type="button" role="tab" tabIndex={-1} aria-selected={!current()}
            onClick={() => go(questions().length)}>Submit</button></Show>
        </div>
      </Show>
      <button type="button" class="question-close" tabIndex={-1} aria-label="Dismiss" onClick={dismiss}><XIcon /></button>
    </div>

    <Show when={current()} keyed fallback={
      <div class="question-summary">
        <For each={questions()}>{(question, index) => <button type="button" tabIndex={-1} onClick={() => go(index())}>
          <span class="question-summary-header">{question.header || question.prompt}</span>
          <span class="question-summary-answer" data-empty={answered(draft(question)) ? undefined : "true"}>
            {answered(draft(question)) ? answerText(question) : question.required ? "Needs an answer" : "Not answered"}</span>
        </button>}</For>
      </div>}>
      {(question) => <div class="question-page">
        <p class="question-prompt">{question.prompt}<Show when={question.multiSelect}><span> · pick any</span></Show></p>
        <div class="question-options" role="listbox" aria-multiselectable={question.multiSelect}>
          <For each={question.options}>{(option, index) => {
            const chosen = () => draft(question).optionIds.includes(option.id);
            return <div role="option" class="question-option" aria-selected={chosen()} data-active={cursor() === index()}
              title={option.description || undefined} onPointerMove={() => setCursor(index())} onClick={() => choose(question, index())}>
              <span class="question-number">{index() + 1}</span>
              <span class="question-option-label">{option.label}</span>
              <Show when={option.description}><span class="question-option-description">{option.description}</span></Show>
              <span class="question-check" data-multi={question.multiSelect ? "true" : undefined}><Show when={chosen()}><CheckIcon /></Show></span>
            </div>;
          }}</For>
          <Show when={question.freeform}>{(freeform) => {
            const placeholder = freeform().placeholder || (question.options.length ? "Type your own answer" : "Type your answer");
            const input = (event: InputEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => type(question, event.currentTarget.value);
            return <div class="question-option question-own" data-active={cursor() === question.options.length}
              onPointerMove={() => setCursor(question.options.length)} onClick={() => own?.focus()}>
              <span class="question-number">{question.options.length + 1}</span>
              {freeform().multiline
                ? <textarea ref={(element) => { own = element; }} rows={2} class="question-own-input" placeholder={placeholder} aria-label={placeholder}
                  value={draft(question).freeform} onInput={input} onFocus={() => setCursor(question.options.length)} />
                : <input ref={(element) => { own = element; }} class="question-own-input" placeholder={placeholder} aria-label={placeholder}
                  type={question.secret ? "password" : "text"} inputmode={freeform().numeric ? "decimal" : undefined}
                  value={draft(question).freeform} onInput={input} onFocus={() => setCursor(question.options.length)} />}
              <span class="question-check"><Show when={draft(question).freeform.trim()}><CheckIcon /></Show></span>
            </div>;
          }}</Show>
        </div>
        <Show when={preview()}>{(shown) => <pre class="question-preview" data-format={shown().format}>{shown().text}</pre>}</Show>
        <Show when={props.request.notes && answered(draft(question))}>
          <input class="question-note" placeholder="Add a note (optional)" aria-label="Note"
            value={draft(question).note} onInput={(event) => setDrafts(question.id, "note", event.currentTarget.value)} />
        </Show>
      </div>}
    </Show>

    <div class="question-footer">
      <div class="question-hints" aria-hidden="true">
        <For each={hints()}>{([key, label]) => <span><kbd class="command-hint-key">{key}</kbd>{label}</span>}</For>
      </div>
      <Button size="sm" tabIndex={-1} disabled={!current() && !ready()} onClick={() => current() ? advance() : submit()}>
        {!current() || (lastQuestion() && !review()) ? "Submit" : "Next"}
      </Button>
    </div>
  </section>;
}
