/**
 * The agent's reach into the person's chats (plan decision 5). Codex job B fills this in; see the brief.
 *
 * `ChatTools(runtime) → { tools: [chats, start_chat, steer_chat] }`, through `runtime.agent.chatHost`
 * (chat-host.js, `createChatHost(deps)`).
 */
export function ChatTools(runtime) { return { tools: [] }; }
