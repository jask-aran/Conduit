/**
 * A harness's question tool, asked in one shape whichever harness asked.
 *
 * A question request travels the path an approval does -- `permission_request`,
 * the session's pending list, the response command -- as a request of kind
 * `question`, so reloading, waiting-for-you state and answering all come with
 * it. What differs is the content: one or more questions, each with offered
 * answers and optionally a typed one, answered all at once.
 *
 * The request says what it can take back. An adapter states only what its
 * harness can send on -- no `freeform` where the harness has no custom answer,
 * `notes` only where a note reaches the model -- so the card never collects
 * something that is then dropped.
 *
 * ```
 * { id, kind: "question", title, notes,
 *   questions: [{ id, header, prompt, multiSelect, secret, required,
 *     options: [{ id, label, description, preview: { format, text } }],
 *     freeform: false | { placeholder, multiline, numeric } }] }
 * ```
 *
 * The answer comes back as
 * `{ id, cancelled?, answers: [{ questionId, optionIds, freeform, note }] }`,
 * and each adapter turns it into its harness's own reply with `answerTo`.
 */
export const questionRequest = ({ id, title = "", notes = false, questions }) => ({
  id, kind: "question", title, message: "", notes: Boolean(notes), placeholder: "", prefill: "", timeoutMs: null,
  questions: questions.map((question) => ({
    header: "", multiSelect: false, secret: false, required: false, freeform: false, ...question,
    options: (question.options || []).map((option) => ({ description: "", ...option })),
  })),
});

/** What the user gave one question: the offered answers they chose, and anything typed. */
export function answerTo(response, question) {
  const answer = (Array.isArray(response?.answers) ? response.answers : [])
    .find((item) => item?.questionId === question.id) || {};
  const chosen = new Set((Array.isArray(answer.optionIds) ? answer.optionIds : []).map(String));
  const options = question.options.filter((option) => chosen.has(option.id));
  return {
    options: question.multiSelect ? options : options.slice(0, 1),
    freeform: question.freeform && typeof answer.freeform === "string" ? answer.freeform.trim() : "",
    note: typeof answer.note === "string" ? answer.note.trim() : "",
  };
}

export const isDismissal = (response) =>
  Boolean(response?.cancelled || response?.dismissed || response?.confirmed === false);
