# Conduit distillations

Add an entry only through an explicit `$conduit-tacit-knowledge` invocation and user approval.

## Entry template

### Short rule title

- **Rule:** Imperative, specific constraint.
- **Scope:** Code path or condition where it applies.
- **Evidence:** Focused test, trace, or failure mode that established it.

### Classify visual flicker with paired, narrow captures

- **Rule:** Before adding a cache or changing lifecycle code, capture one interaction with a scoped DOM mutation observer and a Network filter for the implicated API. Use the DOM record to distinguish removal/remount from a state update, then correlate only the matching requests.
- **Scope:** Expensive or intermittent visual regressions, especially workspace navigation. Do not begin with a giant Performance trace or infer the cause from a screenshot.
- **Evidence:** Slice 1's RHS trace proved that the panel node was removed between chat navigations; the filtered `diff` requests established repeated fetches rather than a paint-only artifact.

### Read the route contract before interpreting network status

- **Rule:** Resolve the client initiator and server route before classifying a network request as process creation, reconnection, or duplication. HTTP status alone is insufficient.
- **Scope:** Conduit lifecycle endpoints, particularly `POST /v0/live-sessions`.
- **Evidence:** The Slice 1 trace showed repeated `201` responses; `server.js` showed that a resident chat process also returns `201`, ruling out the proposed duplicate-Pi diagnosis.

### Preserve persistent Solid surfaces with boolean gates and accessors

- **Rule:** Gate a surface meant to survive identity changes with a boolean condition, and pass changing chat/project identities as Solid accessors. Do not use an identity-bearing value as the mounting condition or capture it as a static component prop.
- **Scope:** Long-lived client surfaces such as `WorkspacePanel` during chat navigation.
- **Evidence:** Slice 1's mutation trace showed the RHS component unmounting across selected chat IDs. Browser regressions now assert panel-node identity and cached Git status across same-project and return navigation.

### Cache workspace projection by project, not Pi residency

- **Rule:** Scope files, Git status, and diff projection to the canonical workspace project. Keep that cache independent from the live Pi-process registry and its warm-pool policy.
- **Scope:** Client workspace navigation and preloading. Pi processes own execution and transcripts; the UI cache owns only recent presentation data.
- **Evidence:** Slice 1 restored recent workspace status without coupling it to process lifetime, avoiding both remount flash and a second source of session ownership.

### Bound Git inspection and make patch text opt-in

- **Rule:** Globally cap and cancel Git child processes, share the active per-project overview, and request a working-tree patch only when its disclosure is opened.
- **Scope:** `readWorkspaceDiff` and the Source Control panel. Treat patch generation as detail work, never as a prerequisite for branch/status rendering.
- **Evidence:** Slice 1 added a four-process cap, timeout/cancellation, overview→patch reuse, and focused tests for shared inspection and cancellation.
