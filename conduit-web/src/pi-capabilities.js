import { toolSubject } from "./harnesses/transcript-ops.js";

/**
 * What Pi can do, apart from the adapter that speaks for it.
 *
 * The manager needs these too -- an interrupted message is stated as discarded
 * or not depending on `interruptKeepsPartial` -- and the manager is what the
 * adapter is built around, so the answer lives here rather than in either.
 */
export const PI_CAPABILITIES = Object.freeze({
  history: "tree", fork: true, regenerate: true,
  steer: true, followUpQueue: true, cancel: true, compaction: true,
  // Pi writes an interrupted assistant message to the session file and then
  // does not use it: the entry carries `stopReason: "aborted"`,
  // `errorMessage: "Request was aborted"` and zeroed usage, and the next
  // request is built without it. Measured, not assumed -- across an interrupt
  // the context grew by 560 tokens where the partial alone was ~670, so it was
  // not sent. An aborted *tool* execution does stay in context; it is assistant
  // text that is dropped.
  thinkingLevels: true, modelSwitch: true, toolUse: true,
  // Pi answers approval requests but has no profiles to pick between.
  approvals: true, permissionModes: false,
  usage: true, replay: true,
  attachments: true,
  interruptKeepsPartial: false,
});

/**
 * Pi's tools, by what they do. The file tools that only look -- `grep`, `find`,
 * `ls` -- are reads, `write` is an edit, and the web-research extension's
 * paging through a stored result is a fetch like the fetch that stored it.
 */
export const PI_TOOL_KINDS = Object.freeze({
  bash: "command",
  read: "read", grep: "read", find: "read", ls: "read",
  edit: "edit", write: "edit",
  web_search: "search",
  fetch_content: "fetch", get_search_content: "fetch",
});

/** And the field of each that says what it acted on. */
const PI_TOOL_SUBJECTS = Object.freeze({
  bash: "command", read: "path", edit: "path", write: "path", ls: "path",
  grep: "pattern", find: "pattern",
  web_search: ["queries", "query"], fetch_content: ["urls", "url"],
});
export const piToolSubject = (name, input) => {
  if (!Object.hasOwn(PI_TOOL_SUBJECTS, name) || !input || typeof input !== "object") return null;
  const fields = [PI_TOOL_SUBJECTS[name]].flat();
  return toolSubject(fields.map((field) => input[field]).find((value) => value != null));
};
