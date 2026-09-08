# Chat backend contract

This contract defines the neutral vocabulary and lifecycle for future chat
adapters. `conduit-web/src/chat-backend-contract.d.ts` is the normative type
definition. Slice 1 does not route Pi through this contract and does not change
the v0 WebSocket protocol.

Pi JSONL stays the transcript authority. The server stays the lifecycle owner.
An adapter owns transport, launch and attach details, backend session restore,
event mapping, backend configuration, capability reporting, and model listing.
Conduit owns chat and project identity, process lifecycle, reconnect, delivery
and backpressure, browser events, and capability enforcement.

## Event vocabulary

Adapters must emit `ChatBackendEvent` values. Backend-native events do not pass
this boundary. The browser must not receive Pi RPC, ACP, or native API shapes
after an adapter moves behind this contract.

| Event | Contract |
| --- | --- |
| `assistant_content` | `start` assigns message identity. `delta` preserves generation, message, block, index, and sequence identity. `final` contains the complete ordered blocks. |
| `tool_activity` | `start`, `update`, and `end` use one `toolCallId`. Unknown tool names remain valid. |
| `permission_request` / `permission_resolved` | A blocking host request and its resolution. Adapters without `permissions` do not emit these events. |
| `status` | Reports `working`, `stopping`, `idle`, or `failed`, plus the coarse Conduit activity. |
| `error` | Uses one of `generation_limit`, `live_process_limit`, `rpc_timeout`, `rate_limited`, `auth_expired`, or `backend_unavailable`. `rate_limited` includes `retryAfterMs`. |
| `usage` | Optional token, cache, and cost values. Adapters without `usage` omit it. |
| `session_checkpoint` | Marks the latest durable generation sequence for reconnect. |
| `runtime_state` | Sends lifecycle, status, activity, and the adapter capability set on attach or recovery. |

Pi maps its current structured events without loss. In particular,
`content_block_delta` coalescing keeps the same generation, message, block type,
and content index key. Final assistant blocks retain thinking and native tool
calls. Tool execution remains separate and joins by `toolCallId`. Optional Pi
events can remain Pi-namespaced until a neutral event is required.

## Capabilities

Each adapter advertises all `ChatCapabilities` flags at create and attach.
Clients must hide or disable unsupported actions. A missing optional capability
must not stop prompt, stream, settle, cancel when supported, reconnect, or close.
`conduit-pi` advertises the full set: `steer`, `followUpQueue`, `cancel`,
`compaction`, `thinkingLevels`, `modelSwitch`, `toolUse`, `permissions`, `usage`,
and `replay`.

## Lifecycle state machine

```text
create  -> creating  -> idle
restore -> restoring -> idle
                         |
                         | prompt accepted
                         v
                       working <---- retry / permission / tool activity
                      /   |   \
             settle /    |     \ failure
                    v     |      v
                  idle    |    failed
                          | cancel
                          v
                       stopping -> idle

creating | restoring | idle | working | stopping | failed -> closed
```

Create and restore can end in `failed`. A successful prompt moves `idle` to
`working` only after the backend accepts it. Streaming does not create another
lifecycle state. Retry, permission wait, compaction, and tool use change coarse
activity while the lifecycle stays `working`. Settle returns to `idle`. Cancel
moves `working` to `stopping`; the adapter then emits a stopped or settled
boundary and returns to `idle`. Late events for the closed generation are
discarded.

A browser disconnect does not change lifecycle state and does not stop the
backend process. Reconnect attaches to the same live process, sends the latest
`runtime_state`, restores the current generation from the last checkpoint, and
continues after its sequence. A fork changes backend history while idle, then a
normal prompt starts a new generation. Close is terminal and releases the live
process. Durable transcript deletion remains a separate, confirmed operation.

## Current Pi mapping

| Current Pi or Conduit event | Neutral event |
| --- | --- |
| `content_block_delta`, `assistant_message_completed` | `assistant_content` |
| `tool_execution_started`, `tool_execution_updated`, `tool_execution_completed` | `tool_activity` |
| `extension_ui_request`, `extension_ui_resolved` | `permission_request`, `permission_resolved` |
| `runtime_state` and `activity.js` derivation | `status`, `runtime_state` |
| `runtime_error`, process/generation limit errors, RPC timeout | `error` |
| `context_usage` and session/cache statistics | `usage` |
| `session_checkpoint`, `generation_resume` | `session_checkpoint`, `runtime_state` |

The current client commands stay documented in `conduit-web/README.md`.
`PiRpcAdapter` and `CodexAppServerAdapter` own backend event mapping. The
browser receives only the neutral projection. Pi delivery mechanics and its
private native payload remain unchanged inside the server adapter.
