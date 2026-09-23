# Question tool plan

**Status (2026-09-23): built for OpenCode and Codex.** The shape lives in
`conduit-web/src/harnesses/questions.js`, the card in
`src/client/chat/question-card.tsx`. OpenCode forms and Codex's
`request_user_input` are asked through it; Claude Code and Pi are still to move.
Two decisions differ from the plan below, and are marked where they apply:

- **One path, a new kind.** A question is a request of kind `question` on the
  approval's path (`permission_request`, the session's `hostUiRequests`, the
  `extension_ui_response` command) rather than a new pair of events. Reloading,
  "waiting for you" and answering all come with that path, and the card stays
  separate because the client picks `QuestionCard` by kind.
- **No manifest entry.** Each question says what it can take back --
  `freeform`, `multiSelect`, `secret`, `required` -- and the request says
  whether `notes` reach the model, so the client offers only what that one
  request can send on. A harness-wide flag would say less, and could disagree.

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

*Superseded: see "One path, a new kind" above.* A new pair of events beside `permission_request` / `permission_resolved`:
`question_request` and `question_resolved`, neither record nor paint, stated
flat like the permission pair. A question is not an approval, and keeping them
apart lets the card stay simple for approvals.

The client command answering it carries `QuestionAnswer`. Each adapter
translates it back into its harness's reply.

## Harness declaration

*Superseded: see "No manifest entry" above.* A manifest entry says what the harness's question tool can express, so the
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
| OpenCode 2 | Forms (`form.created`, `/session/{id}/form`): `fields[]`, each `string` (options with descriptions, `custom`), `multiselect` (`custom`, min/max items), `boolean`, `number`, `integer` or `external` (a URL), with `required`, `hidden` and `when`; reply `{ answer: { [key]: value } }` | Built: one question per field; `boolean` as Yes/No, numbers typed, `external` as a link with Done, `hidden` left to its default, a field its `when` rules out left unanswered |
| Codex | `item/tool/requestUserInput` (experimental): `questions[]` of `id`, `header`, `question`, `options[]` (label, description) or null, `isOther`, `isSecret`; reply `{ answers: { [id]: { answers: string[] } } }` | Built: labels chosen plus anything typed; a dismissal replies with no answers |
| Pi | Extension UI `select` / `confirm` / `input` / `editor` | One question per request; keep on the permission card until moved |
| fx | ACP `session/request_permission` only; no question tool seen | `questions: null` |

## Steps

1. ~~Record each harness's question request.~~ OpenCode's and Codex's
   schemas are in the table, read from OpenCode 2.0.14's binary and
   `codex app-server generate-json-schema` (0.156.1).
2. ~~Add the types.~~ `question` kind in `chat-backend-contract.d.ts`,
   `contracts.ts` and `live-events.ts`.
3. ~~Build the question card.~~ All questions at once; offered answers as rows
   (a circle for one, a square for several), a typed answer where allowed,
   notes when the request takes them, previews under the pointed-at option. A
   single question of offered answers alone is answered by the tap.
4. ~~Move OpenCode forms and Codex onto it.~~
5. Claude Code, when it is a harness: all of the shape, previews and notes
   included. Pi's `select` / `input` / `editor` map onto one question each;
   move them only if it gains anything.
