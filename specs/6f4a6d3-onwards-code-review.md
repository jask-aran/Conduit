## Must address before PR

### 1. Blocking — Destructive chat operations race live-process creation

**Locations:** [server.js:538–550](/home/jask/Conduit/conduit-web/src/server.js:538), [server.js:1120–1133](/home/jask/Conduit/conduit-web/src/server.js:1120), [server.js:1153–1261](/home/jask/Conduit/conduit-web/src/server.js:1153), [server.js:744–766](/home/jask/Conduit/conduit-web/src/server.js:744)

**Failure mode:** `DELETE /v0/sessions/:id` can snapshot and stop the current process set while a concurrent `POST /v0/live-sessions` launches another writer. Depending on ordering, deletion can remove the JSONL and registry row after launch succeeds, leaving Pi writing an unlinked file, or move/delete can operate on a session while a new process still owns the old path. Project deletion has the same stop-snapshot-then-mutate race.

**Why permitted:** `launchingChats` serializes only concurrent launch requests. Delete, move, project delete, launch association, and registry commit do not share a keyed lifecycle transaction or tombstone.

**Minimal remediation:** Add a per-chat lifecycle mutex covering context revalidation, launch, session mapping commit, stop, move, and delete; project deletion needs a project barrier that prevents launches for its chats. Mark destructive targets as deleting before inspecting processes and recheck that state inside launch. Add controlled route-level launch/delete and launch/move race tests. **Before PR.**

**Completion:** Implemented and verified in `30acf76` (`Serialize chat lifecycle transitions`).

### 2. Blocking — Cloned Workspace roots lose the symlink/identity safety boundary

**Locations:** [project-store.js:181–203](/home/jask/Conduit/conduit-web/src/project-store.js:181), [project-store.js:562–570](/home/jask/Conduit/conduit-web/src/project-store.js:562), [pi-launch.js:43–58](/home/jask/Conduit/conduit-web/src/pi-launch.js:43)

**Failure mode:** After cloning, replacing the registered target directory with a symlink makes `projects.validate()` return without checking it because the project is `origin: "cloned"`. A later launch passes that textual path as Pi’s `cwd`; the OS follows the symlink, potentially outside `CONDUIT_WORKSPACE_ALLOWLIST`. Workspace inspection and unregister cleanup also operate against the replacement tree.

**Why permitted:** External-path identity validation is special-cased to `linked`, although `cloned` has the same non-owned `externalPath` and `deletesFilesOnRemove: false` semantics.

**Minimal remediation:** Validate every external-path origin before use: `lstat` the registered root, reject symlinks, resolve the real path against the allowlist, and compare it with the stored canonical identity. Apply the same validation before launch, inspection, chat-directory access, and removal. **Before PR.**

**Completion:** Implemented and verified in `de784a0` (`Validate cloned workspace identity`).

### 3. Important — The append-aware session index is corrupted by concurrent readers

**Locations:** [session-store.js:24–35](/home/jask/Conduit/conduit-web/src/session-store.js:24), [session-store.js:102–129](/home/jask/Conduit/conduit-web/src/session-store.js:102), [session-store.test.js:105–147](/home/jask/Conduit/conduit-web/test/session-store.test.js:105)

**Failure mode:** Two requests observing the same append both read from the old `indexedThrough`, then mutate the same cached index. The later parser uses the first request’s newly advanced offset with its own buffer read from the old offset, producing duplicate records and offsets beyond EOF. I reproduced this with 20 concurrent `readSessionPage()` calls after one append: every response returned an empty transcript and cursor `"1705"` for a much smaller file.

**Why permitted:** The global cache contains mutable index objects, and no per-file single-flight or mutation queue covers stat→read→parse→commit. The test exercises append and replacement only serially.

**Minimal remediation:** Serialize index refreshes per resolved file, preferably constructing an immutable successor and publishing it once complete. Concurrent callers should share the same refresh promise. Add `Promise.all` append, partial-append, replacement, and truncation cases. **Before PR.**

**Completion:** Implemented and verified in `1ac5b28` (`Serialize session index refreshes`).

### 4. Important — Auth revision checking is not a cross-process compare-and-swap

**Locations:** [auth-store.js:160–199](/home/jask/Conduit/conduit-web/src/auth-store.js:160), [auth-store.test.js:243–263](/home/jask/Conduit/conduit-web/test/auth-store.test.js:243), [performance-code-review.md:119–128](/home/jask/Conduit/specs/performance-code-review.md:119)

**Failure mode:** Two `AuthStore` instances can both read revision R, both pass `diskRevision() === R`, and both rename their temporary files; the last rename silently loses the other transition. I reproduced two concurrent session creations on separate instances: both promises fulfilled, but only one session remained. More seriously, a login racing the CLI’s `set-password` can overwrite the new password and restore a session derived from the old state.

**Why permitted:** `_transition` is instance-local, while revision check and rename are separate filesystem operations. The external-revision test injects its write before the checked writer enters `_flush`; it does not race two writers through check→rename.

**Minimal remediation:** Use a shared advisory lock/atomic lockfile around reload→mutate→rename for the server and CLI, with owner metadata and stale-lock recovery. Keep the revision check inside that lock. Add two-instance login/login and login/password-reset barriers that hold both writers after revision validation. **Before PR.**

**Completion:** Implemented and verified in `4233371` (`Serialize auth store updates across processes`).

### 5. Important — Host Pi deletion removes the registry row but not its JSONL family

**Locations:** [server.js:1120–1132](/home/jask/Conduit/conduit-web/src/server.js:1120), [session-store.js:384–423](/home/jask/Conduit/conduit-web/src/session-store.js:384), [project-store.js:188–203](/home/jask/Conduit/conduit-web/src/project-store.js:188), [pi-installations.js:114–130](/home/jask/Conduit/conduit-web/src/pi-installations.js:114)

**Failure mode:** A Host Pi chat’s mapped JSONL is under the Host agent home, but `project.sessionsDir` always points under Isolated Pi’s `data/pi`. `sessionFamilyFiles()` therefore does not find the target and returns `[]`; deletion stops the chat process and removes Conduit’s registry/folder while leaving the Host JSONL and all forks behind. This contradicts the documented complete-family deletion and creates an invisible privacy/data-retention failure.

**Why permitted:** Session-family traversal receives only a project view, which contains no runtime-specific agent/session root. Tests construct only Isolated Pi families.

**Minimal remediation:** Resolve the family directory from the chat’s runtime installation, validate that the mapped target is a regular cwd-matching JSONL inside that directory, and enumerate the family there. Add Host Pi single-session and fork-family deletion tests. **Before PR.**

**Completion:** Implemented and verified in `5d19d37` (`Delete Host Pi transcript families`).

### 6. Important — Checkpoint reconciliation can erase the next generation

**Locations:** [server.js:404–416](/home/jask/Conduit/conduit-web/src/server.js:404), [pi-manager.js:423–430](/home/jask/Conduit/conduit-web/src/pi-manager.js:423), [active-chat.ts:289–306](/home/jask/Conduit/conduit-web/src/client/state/active-chat.ts:289), [app.spec.js:754–915](/home/jask/Conduit/conduit-web/test/browser/app.spec.js:754)

**Failure mode:** A terminal checkpoint starts an asynchronous transcript fetch guarded only by selected chat. If the user begins generation B before generation A’s fetch resolves, the old callback applies its detail and unconditionally calls `setActiveGeneration(null)`, discarding B. Subsequent B events other than `generation_started` are ignored because the reducer has no matching current generation. The server also schedules checkpoints for every `agent_end`, including retry gaps, creating unnecessary partial reconciliations.

**Why permitted:** Durable checkpoint confirmation still owns live-content reconstruction instead of being versioned metadata confirmation. Neither checkpoint nor its request carries a generation/revision guard. DeepWiki and the pinned Pi 0.80.6 package confirm `agent_settled` is the terminal event; `agent_end.willRetry` explicitly identifies nonterminal turns.

**Minimal remediation:** Schedule ordinary completion checkpoints on `agent_settled` or `agent_end && !willRetry`; include generation identity/revision. Commit the normalized terminal generation into transcript projection in place, then let persistence confirm it without fetching content. If the fetch remains temporarily, clear only when the fetched checkpoint still matches the same terminal generation. Add a delayed-checkpoint/rapid-next-prompt browser test. **Before PR.**

**Completion:** Implemented and verified in `ad4b5d4` (`Guard checkpoints by generation identity`).

### 7. Important — Resume State is not connected to an actual reconnect lifecycle

**Locations:** [active-chat.ts:171–183](/home/jask/Conduit/conduit-web/src/client/state/active-chat.ts:171), [pi-manager.js:609–611](/home/jask/Conduit/conduit-web/src/pi-manager.js:609), [server.js:1450–1463](/home/jask/Conduit/conduit-web/src/server.js:1450)

**Failure mode:** A per-chat WebSocket close merely sets `socket = null`; it never reconnects. Generation output freezes until navigation or another action calls `ensureLive`, and Stop silently sends to no socket. Even a manual reattachment after server-side settlement cannot converge because `currentGenerationResume()` suppresses terminal generations and attachment sends no transcript/checkpoint content.

**Why permitted:** Reducer-level resume idempotence and server attachment were implemented without a client socket state machine or terminal-state handoff. Existing reconnect tests exercise reducer prefixes and attachment payloads, not forced browser-socket loss through settlement.

**Minimal remediation:** Add selection-scoped backoff reconnect with explicit intentional-close cancellation. Reattach to the resident record, consume Resume State, and either retain/send the terminal generation until persistence acknowledgement or fetch the matching durable checkpoint when runtime state says it settled. Test disconnection during thinking, tool execution, answer, and the settlement/checkpoint gap. **Before PR.**

**Completion:** Implemented and verified in the following reconnect slice.

### 8. Important — Slow-client delivery still has an unbounded server-side queue

**Locations:** [pi-manager.js:805–942](/home/jask/Conduit/conduit-web/src/pi-manager.js:805), [pi-template.test.js:390–424](/home/jask/Conduit/conduit-web/test/pi-template.test.js:390), [conduit-web/README.md:304–313](/home/jask/Conduit/conduit-web/README.md:304)

**Failure mode:** Once paused, text deltas are dropped, but every non-delta event is pushed into `state.structural` without an item or byte bound. Repeated tool updates can include growing `partialResult` values, while runtime snapshots and sequenced boundaries accumulate for as long as the socket is stalled. Recovery sends current Resume State and then replays those retained events, most of which are already covered by the resume sequence.

**Why permitted:** Backpressure distinguishes only coalescible deltas from all other events; it has no bounded/coalesced representation for reconstructible boundaries and snapshots. The test stalls one start plus one delta and never measures retained memory.

**Minimal remediation:** Coalesce reconstructible state by identity, discard sequenced structured events covered by the Resume State, retain only a bounded set of genuinely non-reconstructible notifications, and close the socket if that bound is exceeded. Test thousands of tool updates/runtime states and assert queue bytes/items, not merely absence of deltas. **Before PR.**

**Completion:** Implemented and verified in the pending slow-client delivery slice.

### 9. Minor — Current specs simultaneously mark incomplete contracts complete and pending

**Locations:** [rendering-state-architecture.md:22–69](/home/jask/Conduit/specs/rendering-state-architecture.md:22), [rendering-state-architecture.md:269–366](/home/jask/Conduit/specs/rendering-state-architecture.md:269), [performance-code-review.md:200–218](/home/jask/Conduit/specs/performance-code-review.md:200)

**Failure mode:** The rendering spec says the migration is concluded and bounded Markdown deliberately deferred, then later requires incremental Markdown, checkpoint removal, bounded socket memory, and an implementation order that places compatibility removal after unfinished work. The performance spec calls reconnect/backpressure and auth serialization complete while its next lines still list bounded Markdown and compatibility removal as pending. Future changes cannot distinguish current invariants from superseded review instructions.

**Why permitted:** Historical review findings remain embedded as imperative current specification after the migration-status section was updated.

**Minimal remediation:** Rewrite these documents as current-state contracts: retain accepted invariants and explicitly tracked debt, remove or archive superseded implementation instructions, and correct the completion claims exposed above. **Before PR because repository policy requires stateless synchronized documentation.**

**Completion:** No current documents require rewrite. `b526b82` removed both superseded review documents; current rendering and live-session contracts are maintained in `README.md` and `conduit-web/README.md`. This preserves the repository’s stateless-documentation policy without recreating historical review instructions.

## Post-review follow-ups

GitHub issues are the task tracker for these items; this temporary review queue
only preserves their review context.

### 10. Important — Clone publication is not crash-consistent

**Locations:** [project-store.js:31–34](/home/jask/Conduit/conduit-web/src/project-store.js:31), [project-store.js:307–324](/home/jask/Conduit/conduit-web/src/project-store.js:307), [project-store.js:438–460](/home/jask/Conduit/conduit-web/src/project-store.js:438)

**Failure mode:** A crash after staging is renamed to the target but before the catalogue write leaves a complete, unregistered target. Startup removes the reservation marker but cannot complete or roll back the transaction; retry then fails because the target exists. A crash during the direct `writeFile` can also leave `conduit.json` malformed.

**Why permitted:** The reservation marker records no transaction phase or project row, and catalogue writes truncate the live file rather than atomically replacing it.

**Minimal remediation:** Atomically write the catalogue and marker, record phases such as `reserved`, `published`, and `catalogued`, and make recovery complete or report a published-but-unregistered target without deleting user data. **Post-review follow-up, provided the orphan case is documented rather than called atomic.**

**Tracked:** [#32](https://github.com/jask-aran/Conduit/issues/32)

### 11. Important — Delta updates still rebuild the visible transcript and reparse all accumulated Markdown

**Locations:** [active-chat.ts:109–118](/home/jask/Conduit/conduit-web/src/client/state/active-chat.ts:109), [timeline-store.ts:16–23](/home/jask/Conduit/conduit-web/src/client/state/timeline-store.ts:16), [transcript.tsx:50–57](/home/jask/Conduit/conduit-web/src/client/chat/transcript.tsx:50), [markdown.tsx:102–109](/home/jask/Conduit/conduit-web/src/client/chat/markdown.tsx:102)

**Failure mode:** Every coalesced block delta replaces the entire Active Generation, rebuilds all visible turn rows, schedules follow-scroll work, and reparses/sanitizes the complete growing answer. Long generations and long visible histories therefore retain approximately quadratic Markdown work plus transcript-wide reactive work.

**Why permitted:** The normalized reducer is one immutable object signal rather than block-granular Solid state; DOM reconciliation preserves nodes but does not reduce parser or projection work.

**Minimal remediation:** Move mutable block text behind per-block accessors/stores so timeline structure changes only on boundaries; separately evaluate the tracked incremental/cadenced renderer while preserving canonical final parsing and sanitization. **Post-review follow-up.**

**Tracked:** [#34](https://github.com/jask-aran/Conduit/issues/34)

### 12. Minor — Closing the Workspace panel does not cancel its outstanding requests

**Locations:** [workspace-panel.tsx:247–282](/home/jask/Conduit/conduit-web/src/client/workspace/workspace-panel.tsx:247), [server.js:704–717](/home/jask/Conduit/conduit-web/src/server.js:704), [performance-code-review.md:97–104](/home/jask/Conduit/specs/performance-code-review.md:97)

**Failure mode:** The persistent component remains mounted, and the `open === false` branch returns without `resetRequestScope()`. A hidden panel can continue directory/file/Git work and commit its cache. The diff route listens to request `aborted` but not response `close`, so a fetch abort after request delivery may not terminate Git promptly.

**Why permitted:** Cancellation is tied to unmount/project change, while visibility is only an inert CSS state.

**Minimal remediation:** Abort the current request scope on open→closed while retaining completed cache; mirror the clone route’s response-close cancellation on the diff route. **Post-review follow-up.**

**Tracked:** [#33](https://github.com/jask-aran/Conduit/issues/33)

### 13. Minor — Session paging still performs CPU work proportional to all preceding records

**Locations:** [session-store.js:219–247](/home/jask/Conduit/conduit-web/src/session-store.js:219)

**Failure mode:** Each page request scans records from zero to the requested end to rebuild `starts`, then repeatedly slices and reduces records per turn. Disk reads are bounded, but paging late in a very large JSONL remains O(total events) CPU and temporary memory per request.

**Why permitted:** The index stores individual records but not turn boundaries or prefix character totals.

**Minimal remediation:** Store turn-start record indices and cumulative character counts during indexing, then binary-search the cursor and walk only the selected turns. Add work-unit assertions independent of response size. **Post-review follow-up.**

**Tracked:** [#35](https://github.com/jask-aran/Conduit/issues/35)

### 14. Minor — The directory-entry cap is applied after reading the entire directory

**Locations:** [workspace-inspector.js:156–163](/home/jask/Conduit/conduit-web/src/workspace-inspector.js:156)

**Failure mode:** `fs.readdir()` materializes every entry before slicing to 500, so a generated/vendor directory can still cause unbounded allocation and latency. The response also does not indicate truncation.

**Why permitted:** The API bounds returned rows rather than enumeration work.

**Minimal remediation:** Iterate with `fs.opendir()`, stop after 501 accepted entries, and return a `truncated` flag. **Post-review follow-up.**

**Tracked:** [#36](https://github.com/jask-aran/Conduit/issues/36)

## Deliberate tradeoffs that look sound

- **Observation — In-memory Active Generation:** [pi-manager.js:578–611](/home/jask/Conduit/conduit-web/src/pi-manager.js:578), [active-generation.js:73–217](/home/jask/Conduit/conduit-web/src/active-generation.js:73). Ordinary browser reconnect uses a reduced current-state object rather than persisting another event log. A server crash may lose unpersisted tokens, but completed JSONL remains authoritative and ownership is not duplicated. No remediation beyond fixing the reconnect lifecycle above.

- **Observation — Runtime separation with shared policy:** [server.js:114–124](/home/jask/Conduit/conduit-web/src/server.js:114), [pi-launch.js:27–84](/home/jask/Conduit/conduit-web/src/pi-launch.js:27), [pi-manager.js:158–247](/home/jask/Conduit/conduit-web/src/pi-manager.js:158). Host and Isolated Pi retain separate executables, homes, model catalogues, and launch arguments while sharing writer/capacity enforcement. This avoids parallel process managers without crossing configuration scope. No change required.

- **Observation — Server-owned residency:** [pi-manager.js:221–247](/home/jask/Conduit/conduit-web/src/pi-manager.js:221), [pi-manager.js:748–786](/home/jask/Conduit/conduit-web/src/pi-manager.js:748), [pi-manager.js:805–819](/home/jask/Conduit/conduit-web/src/pi-manager.js:805). Detaching a browser does not stop Pi; warm-process and generating limits are distinct, and hung abort has a terminating fallback. This matches the authoritative server-process boundary. No change required.

- **Observation — Single auth choke point:** [server.js:301–321](/home/jask/Conduit/conduit-web/src/server.js:301), [server.js:1434–1449](/home/jask/Conduit/conduit-web/src/server.js:1434), [auth-middleware.js:67–82](/home/jask/Conduit/conduit-web/src/auth-middleware.js:67). HTTP routes/uploads remain behind one middleware and WebSocket upgrades validate before `handleUpgrade`; redirect filtering rejects protocol-relative and backslash forms. The store race above does not require redesigning this boundary.

- **Observation — Git inspection subprocess policy:** [workspace-inspector.js:25–125](/home/jask/Conduit/conduit-web/src/workspace-inspector.js:25), [workspace-inspector.js:185–223](/home/jask/Conduit/conduit-web/src/workspace-inspector.js:185). Argument arrays, global process caps, deadlines, output limits, process-group termination, and overview/patch separation bound the expensive child-process portion. The remaining close-cancellation issue is localized.

## Architectural verdict

The change set establishes coherent domain boundaries—Pi JSONL remains transcript authority, the registry remains identity metadata, and live generation is normalized server state—but several cross-boundary transitions are not transactional. The most serious risks occur where process ownership, filesystem publication, registry mutation, and browser projection are coordinated through snapshots or unversioned asynchronous work. Concurrency tests currently prove behavior within one object or one linear request, missing reproducible multi-request and multi-process races. The architecture is suitable for the next feature only after lifecycle serialization, persistence writer coordination, reconnect completion, and runtime-aware deletion are corrected.

## Highest-leverage next improvements

1. Introduce one keyed lifecycle transaction layer for launch, mapping commit, move, delete, and project teardown.
2. Make mutable persistence caches/stores explicitly single-writer: per-file index refreshes, a cross-process auth lock, atomic catalogue writes, and phased clone recovery.
3. Turn Resume State into a complete versioned reconnect/checkpoint handshake, then bound per-client delivery around that state.
4. Move live block text to fine-grained Solid ownership so structural projection and Markdown work no longer scale with every delta.

## Areas inspected with no finding

Auth middleware ordering, unauthenticated allowlist, WebSocket authentication, login redirect safety, Tailnet share-origin command construction, Isolated/Host launch-argument separation, model-scope separation, Pi 0.80.6 normalized block/RPC semantics, generation sequence idempotence, stop/late-output gating, process caps and idle residency, attachment atomic publication and path scoping, progressive startup/load-then-commit navigation, persistent timeline DOM identity through the covered checkpoint test, Markdown sanitization/external-link boundary, and Git argv/process-group/output controls.

Validation was read-only: `git diff --check`, TypeScript typecheck, and all 189 unit/server tests passed. The browser suite was inspected but not rerun. The two excluded demo paths remained untouched.
