/**
 * A question travels the path an approval does, as a request of kind `question`, so reloading, waiting-for-you state
 * and answering come with it. An adapter states only what its harness can send on, so the card never collects
 * something that is then dropped.
 */
export const questionRequest = ({ id, title = "", notes = false, questions }) => ({
  id, kind: "question", title, message: "", notes: Boolean(notes), placeholder: "", prefill: "", timeoutMs: null,
  questions: questions.map((question) => ({
    header: "", multiSelect: false, secret: false, required: false, freeform: false, ...question,
    options: (question.options || []).map((option) => ({ description: "", ...option })),
  })),
});

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
