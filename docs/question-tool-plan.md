# Question tool plan

**Status (2026-09-23): rough plan, not started.** A later piece of work, recorded
so each harness's native question tool can be mapped onto one Conduit shape
instead of being squeezed through the permission card.

## Problem

Harnesses let the model stop and ask the user something, each in its own shape.
Conduit has one way to show that today: `permission_request`, rendered by
`src/client/chat/host-ui-card.tsx`. That card is Pi's extension UI — one prompt
of kind `select`, `confirm`, `input` or `editor`, with `select` options as plain
strings — and answers `{ id, cancelled?, confirmed?, value? }`.

That fits an approval. It does not fit a question tool:

- Several questions in one request cannot be asked. The OpenCode adapter shows
  only `questions[0]` and replies with a single answer.
- An option cannot carry a description, a note, or a drawing.
- There is no free-form answer beside the offered ones, and no multi-select.
- Adapters already disagree on the option shape: OpenCode sends
  `{ id, label }` objects where the card renders strings.

## The shape

One request holds one or more questions. Each question has offered answers and,
optionally, a free-form answer.

```ts
type QuestionRequest = {
  id: string;
  title?: string;                  // what the whole request is about
  questions: Question[];
};

type Question = {
  id: string;
  header?: string;                 // short label, e.g. a chip
  prompt: string;                  // the question itself
  multiSelect: boolean;
  options: QuestionOption[];
  freeform: false | { placeholder?: string };  // "Other", typed by the user
};

type QuestionOption = {
  id: string;
  label: string;
  description?: string;            // what choosing it means
  preview?: { format: "monospace" | "markdown"; text: string };  // e.g. ASCII drawing
};

type QuestionAnswer = {
  requestId: string;
  cancelled?: boolean;
  answers: Array<{
    questionId: string;
    optionIds: string[];           // one, or several when multiSelect
    freeform?: string;
    note?: string;                 // the user's note on their choice
  }>;
};
```

`preview` is what Claude Code's AskUserQuestion calls a preview: an ASCII mockup,
code snippet or diagram shown beside an option so options can be compared.
Monospace is the case to get right first.

`note` is the user's free comment on the answer they chose, separate from a
free-form answer that replaces the offered ones.

## Channel

A new pair of events beside `permission_request` / `permission_resolved`:
`question_request` and `question_resolved`, neither record nor paint, stated
flat like the permission pair. A question is not an approval, and keeping them
apart lets the card stay simple for approvals.

The client command answering it carries `QuestionAnswer`. Each adapter
translates it back into its harness's reply.

## Harness declaration

A manifest entry says what the harness's question tool can express, so the
client offers only that and the adapter never receives an answer it cannot
send back:

```js
questions: {
  multiQuestion: true,     // several questions per request
  multiSelect: true,
  freeform: true,
  optionDescriptions: true,
  previews: false,
  notes: false,
}
// or questions: null — the harness has no question tool
```

## Native question tools

To be confirmed against a recording of each, as was done for OpenCode's events.

| Harness | Native tool | Maps to |
| --- | --- | --- |
| Claude Code | AskUserQuestion: 1–4 questions, each with a header, 2–4 options (label, description, optional preview), multiSelect; an "Other" answer is always offered; answers can carry notes | All of the shape, including previews and notes |
| OpenCode 2 | Forms (`form.created` event, `/session/{id}/form`): `questions[]` with header, question and options (label, description); reply `answers: [[...]]` per question | multiQuestion, optionDescriptions; confirm multiSelect and custom answers |
| Codex | App-server user-input request; confirm the method and shape | To confirm |
| Pi | Extension UI `select` / `confirm` / `input` / `editor` | One question per request; keep on the permission card until moved |
| fx | ACP `session/request_permission` only; no question tool seen | `questions: null` |

## Steps

1. Record a real question request from each harness that has one (OpenCode
   form, Claude Code, Codex) and fill in the table.
2. Add the types and `question_request` / `question_resolved` to
   `chat-backend-contract.d.ts` and the client boundary in `live-events.ts`.
3. Build the question card: one question at a time or all at once, offered
   answers as buttons (checkboxes when multiSelect), a free-form field, an
   optional note, monospace previews shown beside the selected option.
4. Add the `questions` manifest declaration and move OpenCode forms onto it
   first, since its adapter currently loses every question after the first.
5. Then Claude Code and Codex; move Pi's `select` over only if it gains
   anything.
