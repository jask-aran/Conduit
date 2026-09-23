# Chat backend contract

`conduit-web/src/chat-backend-contract.d.ts` is the normative type definition.
This document is the architecture it describes: what a harness adapter owns,
what Conduit owns, and the two channels every turn travels on.

Six harnesses are behind this contract — Pi (`conduit_pi`), Codex
(app-server), ChatGPT Web (sidecar), fx (ACP over stdio), OpenCode 2 (its
background service), and the in-process Test stream. The
browser cannot tell which one it is talking to except by the capabilities it
was given.

## One translation

A harness's own words appear in its adapter and nowhere else. Past that line
everything is Conduit's vocabulary: server, wire, and browser use the same
names, and an event with no case at both ends is not sent at all.

For Pi the line is `toNeutralPiEvent`. Pi's interior may go on speaking Pi —
its internal event bus, its own delivery bookkeeping — but nothing Pi-shaped
crosses that function, including into the chat log. A stored log entry is a
neutral event, and translating one again is a no-op, which is what lets replay
send log entries back through the same path as live ones.

### Six adapters, one shape

The adapters are parallel, not layered. Nothing routes through Pi, and no
adapter knows another exists — each one takes its own harness's transport and
puts Conduit's vocabulary on the other side, where a single delivery,
numbering and socket path serves all six.

```text
 conduit_pi    codex         chatgpt-web   fx            opencode2     test-stream
 resident      app-server    python        `fx acp`      background    in-process
 Pi JSONL      JSON-RPC      sidecar       ACP, stdio    service, SSE  own journal
     │             │             │             │             │             │
     ▼             ▼             ▼             ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  PiRpc   │  │ CodexApp │  │ ChatGpt  │  │  FxAcp   │  │ OpenCode │  │TestStream│
│ Adapter  │  │  Server  │  │   Web    │  │ Adapter  │  │ Adapter  │  │ Adapter  │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
     │             │             │             │             │             │
═════╪═════════════╪═════════════╪═════════════╪═════════════╪═════════════╪═════
     │           the translation line — no harness word crosses it         │
═════╪═════════════╪═════════════╪═════════════╪═════════════╪═════════════╪═════
     │             │             │             │             │             │
     └──────┬──────┴─────────────┴─────────────┴─────────────┴─────────────┘
            ▼
        ┌──────────────────────┐   the record is numbered here, per chat.
        │  ChatLog.stamp       │   A client that finds a gap in log.seq
        │  record only         │   asks for what it missed by resume_log.
        └──────────────────────┘
                  │
       ┌──────────┴───────────┐
       ▼                      ▼
 ┌────────────┐     ┌───────────────────┐   record: sent whatever the backlog
 │ PiManager  │     │  SessionRecords   │   paint:  merged per block, paced
 │  delivery  │     │  + SocketDelivery │           to the reader's frame,
 └────────────┘     └───────────────────┘           given up over high water
       │                      │
       └──────────┬───────────┘
                  ▼
        live-session-stream  ── one WebSocket per chat ──▶  browser
```

Two delivery implementations, one set of promises. Pi has its own because it
pauses a slow socket and recovers it by restating the running generation,
which it can do because it holds one; a harness that holds no such thing
cannot, and `SocketDelivery` needs neither. They share `deliveryKey`, `isPaint`
and the frame clamp, so what may be merged and what may be dropped has one
answer.

## Two channels, not three

```text
                         ┌──────────────────────────────────┐
  ┌──────────────────┐   │            THE RECORD            │
  │ Pi: toolCall,    │ ─┐│  transcript_op   message.open    │
  │     thinking     │  ││                  message.close   │
  ├──────────────────┤  ││                  message.drop    │
  │ Codex: item/…    │ ─┤│                  tool.open/close │
  ├──────────────────┤  ├┤  status          started         │
  │ ChatGPT: frames  │ ─┤│                  stopping        │──┐
  ├──────────────────┤  ││                  stopped         │  │
  │ fx: ACP updates  │ ─┤│                  settled         │  │
  ├──────────────────┤  ││  error           (runtime)       │  │
  │ OpenCode: events │ ─┤│  transcript_sync                 │  │
  ├──────────────────┤  ││  session_checkpoint              │  │
  │ Test: synthetic  │ ─┘│                                  │  │   ┌──────────┐
  └──────────────────┘   │  ordered · exactly once ·        │  ├──▶│  client  │
       adapter           │  numbered in the chat's log      │  │   │  folds   │
   translates ONCE       └──────────────────────────────────┘  │   │  as-is   │
   (harness words stop   ┌──────────────────────────────────┐  │   └──────────┘
    at this line)        │              PAINT               │  │
                         │  assistant_content  start        │  │
                         │                     delta        │──┘
                         │                     final        │
                         │  tool_activity      start        │
                         │                     update       │
                         │                     end          │
                         │                                  │
                         │  merged per block · droppable ·  │
                         │  paced to the reader's frame ·   │
                         │  never authoritative ·           │
                         │  never in the chat's log         │
                         └──────────────────────────────────┘
```

The record is what the browser cannot work out for itself: what the transcript
holds, and the transitions a turn makes. Paint is the typewriter, and exists
only because `message.close` cannot be sent until the answer is finished and a
reader should not have to wait for that.

|        | ordered | delivered | authoritative | in the chat's log |
| ------ | ------- | --------------------------------------- | --- | --- |
| record | yes     | exactly once                            | yes | yes |
| paint  | yes     | may be merged or dropped, in any phase  | no  | no  |

A turn's transitions are record, not paint: a missed `settled` is a hole a
client must be caught up on, not a repaint it can do without. A request-scope
error is neither — it belongs to the command that failed, not to a turn, and
numbering one would replay a bad request as a failed turn on the next
reconnect.

Dropping paint is safe because `message.close` restates the message in full.
Who wrote it, with what, when, and what went wrong travel on the close when
the adapter has them: Pi copies them off the reduced generation; Codex,
ChatGPT Web, fx and Test stream state the turn's `model` from the live record;
OpenCode closes each step from its saved message, which carries the provider,
model, write-time and error. They do not invent a provider or a write-time
they were never given.

Two adapters close from something other than what they streamed. fx sends its
own notices and the answer as the same ACP update, so its streamed text goes to
the trace and the answer is closed from fx's saved reply once the turn ends.
OpenCode streams from its event stream, but a step's close restates the
message OpenCode saved, so the record is OpenCode's own and not the adapter's
reading of the stream.

A socket that reconnects is restated from a server-side fold of the generation
on harnesses that declare `replay` (Pi, Test stream). Codex, ChatGPT Web, fx
and OpenCode do not; a reconnecting browser is caught up from the record
buffer and the chat's log. When a record's buffer is full, paint is evicted before the record.

### Vocabulary

| Event | Channel | Contract |
| --- | --- | --- |
| `transcript_op` | record | `message.open` places a row and says what it answers; `message.close` states the finished message in full; `message.drop` cuts the history or takes one row back; `tool.open` / `tool.close` do the same for a tool row. |
| `status` | record | A transition: `started`, `stopping`, `stopped`, `settled`. `running` is also sent but not numbered — `started` has already said the turn began. |
| `error` | record when `scope: "runtime"` | `scope: "request"` is Conduit refusing a command and belongs to that command. Codes: `generation_limit`, `live_process_limit`, `rpc_timeout`, `rate_limited` (with `retryAfterMs`), `auth_expired`, `backend_unavailable`, `invalid_request`. |
| `transcript_sync` | record | A window of the transcript, or with `replace: true` the whole of it. |
| `session_checkpoint` | record | The chat's durable identity and title. |
| `assistant_content` | paint | `start` names the message; `delta` carries an addition with generation, message, block kind and content index; `final` carries the complete ordered blocks. |
| `tool_activity` | paint | `start`, `update` and `end` under one `toolCallId`. Unknown tool names are valid. |
| `generation_replay` | neither | The whole reduced generation, sent once on attach. |
| `runtime_state` | neither | Adapter capabilities, queue, usage and what the session is busy with. Session state, not a turn transition. |
| `permission_request` / `permission_resolved` | neither | A blocking host request and its resolution, stated flat. |
| `usage`, `queue_state`, `compaction`, `retry` | neither | Optional capability state. |

### The chat's log

Record events are numbered per chat, in `ChatLog`. The number is a fact about
the chat rather than the process answering it, so a restarted, recycled or
forked backend goes on numbering where the last one stopped.

A client that sees a gap in `log.seq` asks `resume_log`. It is either sent
exactly what it missed, or told `log_reset` and given a replacing
`transcript_sync`. A cut spends exactly one number: `message.drop` is the
numbered statement, and `history_truncated` is the older spelling of the same
fact, sent live but never numbered.

Reload over HTTP reads the harness's own file and brings it up to what the log
says, so a page load and a live stream agree.

## One fold, two implementations

Server and browser reduce the same stream with the same case names —
`src/active-generation.js` as plain data, `src/client/state/active-generation-store.js`
fine-grained in Solid. On harnesses that declare `replay`, the server's copy is
what a reconnecting socket is restated from. Transcript ops are folded
identically at both ends and on reload by `src/transcript-fold.js`.

The client boundary (`src/client/api/live-events.ts`) checks; it does not
rebuild generation events or ops. It verifies an event's name, phase and the
fields both folds dereference, then applies the server's object as stated.
`permission_request` is given a `request` object for the dialog; the rest of
the frame travels with it. Anything else arrives as `unknown` rather than
taking a place in the turn.

## Delivery and pacing

Paint is merged per block and paced; the record is sent the moment it is
published, whatever the backlog.

- **Leading edge.** The first paint frame after a quiet moment goes out
  immediately — there is nothing yet to merge it with, and holding it only
  makes the reader later. Only a stream arriving faster than the window waits.
- **The window** is a rate limit, not a delay. Frames arriving inside it are
  merged into one: text deltas concatenate, a tool's progress is replaced by
  its latest restatement. The trailing flush fires a frame after the *last
  send*, so a burst holds one cadence rather than drifting by the gap that
  preceded it.
- **The window is the reader's frame.** The server cannot see a display, so
  the browser measures its own refresh with `requestAnimationFrame` and sends
  `frame_interval` on connect; that paces that socket and no other. Until it
  says, a socket gets `DELIVERY_FLUSH_MS` (8ms). A claim is clamped to
  4–50ms — below a 240Hz panel is work the reader's own compositor discards,
  and the ceiling stops a throttled tab pacing the stream to a crawl.
- **High water.** A socket over 256 KiB of buffered data stops receiving
  paint; the record still goes. Pi additionally pauses such a socket and
  recovers it by restating the running generation, which it can do because it
  holds one.

The two implementations are named under "Six adapters, one shape" above.

## Capabilities

Behaviour is driven by declaration. An adapter advertises every
`CHAT_CAPABILITY_KEYS` flag at create and attach: `steer`, `followUpQueue`,
`cancel`, `compaction`, `thinkingLevels`, `modelSwitch`, `toolUse`,
`approvals`, `permissionModes`, `usage`, `replay`, `attachments`, `fork`,
`regenerate`, `interruptKeepsPartial` — plus a `history` mode of `none`,
`linear` or `tree`.

The client hides or disables what is not declared and the server refuses it;
`unsupported(capabilities, { label })` derives the refusal stubs from the flags
themselves. A missing optional capability must never stop prompt, stream,
settle, cancel where supported, reconnect or close.

`interruptKeepsPartial` is a fact about the harness, not a preference: it says
whether text the reader watched arrive survives into the next request. Where it
is false, the close marks the message `discarded` — it stays in the
transcript, because taking away something the reader saw is worse, but nothing
treats it as part of the conversation the model can answer to. Which harness
says what, and why, is in the table below.

`suppliesMessageIds` decides whether Conduit mints message ids for that harness
or adopts the ones it is given.

### What each harness declares

● declared, ○ not. Every adapter states every flag; there is no "unset".

| | Pi | Codex | ChatGPT Web | fx | OpenCode | Test stream |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| `history` | tree | linear | linear | linear | linear | tree |
| `fork` | ● | ● | ○ | ○ | ○ | ● |
| `regenerate` | ● | ● | ○ | ○ | ○ | ● |
| `steer` | ● | ● | ○ | ○ | ○ | ● |
| `followUpQueue` | ● | ● | ○ | ○ | ○ | ● |
| `cancel` | ● | ● | ● | ● | ● | ● |
| `compaction` | ● | ● | ○ | ○ | ● | ● |
| `thinkingLevels` | ● | ● | ● | ● | ● | ● |
| `modelSwitch` | ● | ● | ● | ● | ● | ● |
| `toolUse` | ● | ● | ○ | ● | ● | ● |
| `approvals` | ● | ● | ○ | ● | ● | ● |
| `permissionModes` | ○ | ● | ○ | ● | ○ | ○ |
| `usage` | ● | ○ | ○ | ○ | ● | ● |
| `replay` | ● | ○ | ○ | ○ | ○ | ● |
| `attachments` | ● | ● | ○ | ○ | ○ | ● |
| `interruptKeepsPartial` | ○ | ○ | ○ | ○ | ○ | ● |

And from the manifest, which decides how a chat on it is made ready:

| | Pi | Codex | ChatGPT Web | fx | OpenCode | Test stream |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| `protocol` | `pi_rpc` | `native_api` | `native_api` | `acp` | `native_api` | `native_api` |
| `warm` | process | process | none | process | process | none |
| `discovery` | none | machine | none | machine | machine | none |
| `suppliesMessageIds` | ○ | ● | ● | ● | ● | ● |
| `nameGeneration` | conduit | conduit | backend | backend | backend | conduit |

Reading down a column is the whole of what that profile can do, and reading
across a row is the whole of what differs. Four entries are worth naming.

`permissionModes` is Codex and fx: Codex offers profiles to answer an approval
*under*, and fx offers its ACP session modes the same way, where the others
answer an approval and nothing more. `replay` is false for Codex, fx and
OpenCode because their `replay` returns runtime state from the record buffer
rather than a generation in progress, so a browser reconnecting mid-turn is
caught up from the record and the log instead; `usage` is false for Codex
too.

OpenCode's service is not Conduit's to run. The adapter joins it as another
client, the way OpenCode's own TUI does — one loopback event stream for every
session, the service's password from its config — and never stops it on
shutdown, because the TUI may be using it.

`interruptKeepsPartial` is true only for the Test stream, and that is not a
gap in the others. Every real harness drops an interrupted partial, because
what it writes down and what it sends the model next turn are different
things — measured for Pi, not assumed. This backend's journal *is* its
transcript and there is no model to disagree with it, so a stopped answer
really does stand; it is also Conduit's only coverage of the `discarded: false`
close.

ChatGPT Web declares least because the conversation lives in somebody else's
account and Conduit follows it by cursor. The client hides what is not there,
so that profile simply has no fork, no steer and no tool rows.

## Lifecycle

```text
create  -> creating  -> idle
restore -> restoring -> idle
                         |
                         | prompt accepted
                         v
                       working <---- retry / approval / tool activity
                      /   |   \
             settle /     |     \ failure
                    v     |      v
                  idle    |    failed
                          | cancel
                          v
                       stopping -> idle

creating | restoring | idle | working | stopping | failed -> closed
```

A prompt moves `idle` to `working` only once the backend accepts it. Streaming
is not another state. Retry, an approval wait, compaction and tool use change
what the session is busy with while the lifecycle stays `working`. Cancel moves
`working` to `stopping`; the adapter then states a stopped or settled boundary
and returns to `idle`. Late events for a closed generation are discarded.

A browser disconnect changes no lifecycle state and stops no process.
Reconnect attaches to the same live process, replays the record buffer, sends
`generation_replay` and `runtime_state`, and states where the chat's order
stands. A fork changes backend history while idle; a normal prompt then starts
a new generation. Close is terminal and releases the live process. Deleting a
durable transcript remains a separate, confirmed operation.

## Adapter surface

An adapter owns transport, launch and attach, backend session restore, event
mapping, backend configuration, capability reporting and model listing.
Conduit owns chat and project identity, process lifecycle, message identity,
the chat's order, reconnect, delivery and backpressure, and capability
enforcement.

`assertChatBackendAdapter` requires every method in
`REQUIRED_CHAT_BACKEND_METHODS` and checks the declared capabilities against
what the registry expects. `setFrameInterval` is optional; a backend that does
not implement it is simply never paced by its reader.

Client commands are documented in `conduit-web/README.md`.
