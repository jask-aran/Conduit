const usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistant = (content = [], overrides = {}) => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "fixture-model",
  usage,
  stopReason: "stop",
  timestamp: 1_753_200_000_000,
  ...overrides,
});

const start = () => ({ type: "message_start", message: assistant() });
const update = (type, contentIndex, partialContent, extra = {}) => ({
  type: "message_update",
  message: assistant(partialContent),
  assistantMessageEvent: {
    type,
    contentIndex,
    partial: assistant(partialContent),
    ...extra,
  },
});
const end = (content, stopReason = "stop", extra = {}) => ({
  type: "message_end",
  message: assistant(content, { stopReason, ...extra }),
});
const text = (value) => ({ type: "text", text: value });
const thinking = (value, extra = {}) => ({ type: "thinking", thinking: value, ...extra });
const toolCall = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const lifecycle = (events) => [
  { type: "generation_started" },
  { type: "agent_start" },
  ...events,
  { type: "agent_end", willRetry: false },
  { type: "agent_settled" },
];

const noThinkingAnswer = lifecycle([
  start(),
  update("text_start", 0, [text("")]),
  update("text_delta", 0, [text("Hello")], { delta: "Hello" }),
  update("text_delta", 0, [text("Hello world")], { delta: " world" }),
  update("text_end", 0, [text("Hello world")], { content: "Hello world" }),
  end([text("Hello world")]),
]);

const thinkingThenAnswer = lifecycle([
  start(),
  update("thinking_start", 0, [thinking("")]),
  update("thinking_delta", 0, [thinking("Inspect")], { delta: "Inspect" }),
  update("thinking_end", 0, [thinking("Inspect")], { content: "Inspect" }),
  update("text_start", 1, [thinking("Inspect"), text("")]),
  update("text_delta", 1, [thinking("Inspect"), text("Done")], { delta: "Done" }),
  update("text_end", 1, [thinking("Inspect"), text("Done")], { content: "Done" }),
  end([thinking("Inspect"), text("Done")]),
]);

const firstTool = toolCall("call_read", "read", { path: "README.md" });
const secondTool = toolCall("call_shell", "bash", { command: "git status --short" });
const multipleToolTurns = lifecycle([
  start(),
  update("thinking_start", 0, [thinking("")]),
  update("thinking_delta", 0, [thinking("Read first")], { delta: "Read first" }),
  update("thinking_end", 0, [thinking("Read first")], { content: "Read first" }),
  update("toolcall_start", 1, [thinking("Read first"), toolCall("", "", {})]),
  update("toolcall_delta", 1, [thinking("Read first"), toolCall("", "", {})], { delta: "{\"path\":\"README.md\"}" }),
  update("toolcall_end", 1, [thinking("Read first"), firstTool], { toolCall: firstTool }),
  end([thinking("Read first"), firstTool], "toolUse"),
  { type: "tool_execution_start", toolCallId: "call_read", toolName: "read", args: { path: "README.md" } },
  { type: "tool_execution_update", toolCallId: "call_read", toolName: "read", args: { path: "README.md" }, partialResult: "Conduit" },
  { type: "tool_execution_end", toolCallId: "call_read", toolName: "read", result: "Conduit README", isError: false },
  start(),
  update("toolcall_start", 0, [toolCall("", "", {})]),
  update("toolcall_end", 0, [secondTool], { toolCall: secondTool }),
  end([secondTool], "toolUse"),
  { type: "tool_execution_start", toolCallId: "call_shell", toolName: "bash", args: { command: "git status --short" } },
  { type: "tool_execution_end", toolCallId: "call_shell", toolName: "bash", result: "", isError: false },
  start(),
  update("text_start", 0, [text("")]),
  update("text_delta", 0, [text("Repository is clean.")], { delta: "Repository is clean." }),
  update("text_end", 0, [text("Repository is clean.")], { content: "Repository is clean." }),
  end([text("Repository is clean.")]),
]);

const parallelOne = toolCall("call_one", "read", { path: "one" });
const parallelTwo = toolCall("call_two", "read", { path: "two" });
const parallelTools = lifecycle([
  start(),
  update("toolcall_start", 0, [toolCall("", "", {})]),
  update("toolcall_end", 0, [parallelOne], { toolCall: parallelOne }),
  update("toolcall_start", 1, [parallelOne, toolCall("", "", {})]),
  update("toolcall_end", 1, [parallelOne, parallelTwo], { toolCall: parallelTwo }),
  end([parallelOne, parallelTwo], "toolUse"),
  { type: "tool_execution_start", toolCallId: "call_one", toolName: "read", args: { path: "one" } },
  { type: "tool_execution_start", toolCallId: "call_two", toolName: "read", args: { path: "two" } },
  { type: "tool_execution_end", toolCallId: "call_two", toolName: "read", result: "two", isError: false },
  { type: "tool_execution_end", toolCallId: "call_one", toolName: "read", result: "one", isError: false },
  start(),
  update("text_start", 0, [text("")]),
  update("text_end", 0, [text("Both read.")], { content: "Both read." }),
  end([text("Both read.")]),
]);

const narratedTool = toolCall("call_list", "bash", { command: "ls" });
const textBeforeToolUse = lifecycle([
  start(),
  update("text_start", 0, [text("")]),
  update("text_delta", 0, [text("I will inspect.")], { delta: "I will inspect." }),
  update("text_end", 0, [text("I will inspect.")], { content: "I will inspect." }),
  update("toolcall_start", 1, [text("I will inspect."), toolCall("", "", {})]),
  update("toolcall_end", 1, [text("I will inspect."), narratedTool], { toolCall: narratedTool }),
  end([text("I will inspect."), narratedTool], "toolUse"),
  { type: "tool_execution_start", toolCallId: "call_list", toolName: "bash", args: { command: "ls" } },
  { type: "tool_execution_end", toolCallId: "call_list", toolName: "bash", result: "README.md", isError: false },
  start(),
  update("text_start", 0, [text("")]),
  update("text_end", 0, [text("Inspection complete.")], { content: "Inspection complete." }),
  end([text("Inspection complete.")]),
]);

const multipleTextThinkingBlocks = lifecycle([
  start(),
  update("thinking_start", 0, [thinking("")]),
  update("thinking_end", 0, [thinking("First thought")], { content: "First thought" }),
  update("text_start", 1, [thinking("First thought"), text("")]),
  update("text_end", 1, [thinking("First thought"), text("First text")], { content: "First text" }),
  update("thinking_start", 2, [thinking("First thought"), text("First text"), thinking("")]),
  update("thinking_end", 2, [thinking("First thought"), text("First text"), thinking("Second thought")], { content: "Second thought" }),
  update("text_start", 3, [thinking("First thought"), text("First text"), thinking("Second thought"), text("")]),
  update("text_end", 3, [thinking("First thought"), text("First text"), thinking("Second thought"), text("Second text")], { content: "Second text" }),
  end([thinking("First thought"), text("First text"), thinking("Second thought"), text("Second text")]),
]);

const retry = [
  { type: "generation_started" },
  { type: "agent_start" },
  start(),
  end([], "error", { errorMessage: "Temporary provider failure" }),
  { type: "agent_end", willRetry: true },
  { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 50, errorMessage: "Temporary provider failure" },
  { type: "auto_retry_end" },
  { type: "agent_start" },
  start(),
  update("text_start", 0, [text("")]),
  update("text_end", 0, [text("Recovered")], { content: "Recovered" }),
  end([text("Recovered")]),
  { type: "agent_end", willRetry: false },
  { type: "agent_settled" },
];

const stopped = [
  { type: "generation_started" },
  { type: "agent_start" },
  start(),
  update("text_start", 0, [text("")]),
  update("text_delta", 0, [text("Partial")], { delta: "Partial" }),
  { type: "generation_stopped" },
  update("text_delta", 0, [text("Partial late")], { delta: " late" }),
  { type: "agent_settled" },
];

const providerError = [
  { type: "generation_started" },
  { type: "agent_start" },
  start(),
  end([], "error", { errorMessage: "Provider rejected the request" }),
  { type: "agent_end", willRetry: false },
  { type: "agent_settled" },
];

export const piRpcGenerationFixtures = {
  noThinkingAnswer: { events: noThinkingAnswer, resumeAfter: 4 },
  thinkingThenAnswer: { events: thinkingThenAnswer, resumeAfter: 4 },
  multipleToolTurns: { events: multipleToolTurns },
  parallelTools: { events: parallelTools },
  textBeforeToolUse: { events: textBeforeToolUse },
  multipleTextThinkingBlocks: { events: multipleTextThinkingBlocks },
  retry: { events: retry },
  stopped: { events: stopped },
  providerError: { events: providerError },
};

export const persistedTextBeforeToolUse = [
  assistant([text("I will inspect."), narratedTool], { stopReason: "toolUse" }),
  assistant([text("Inspection complete.")]),
];
