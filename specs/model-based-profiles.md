# Model-based Pi runtime profiles

Status: implemented

## Purpose

Conduit currently has one profile layer. A chat template defines the agent's
role, system prompt, tools, extensions, skills, and model allowlist. The
Assistant and Coding templates load `pi-web-access`, but their static
`data/pi/web-search.json` routing is shared by every model. When OpenAI search
is available in that file, a non-OpenAI model can use it as well.

Add a second, server-owned layer that derives runtime settings from the active
model. Keep the chat profile and model runtime profile separate:

- Chat profiles answer: "What kind of agent is this?"
- Model profiles answer: "Which runtime settings apply to this model?"

The first runtime setting is static web-search routing. Keep `pi-web-access` as
the web tool. Do not add a model-aware third-party search plugin, a wrapper
around its tools, or a new user-selectable chat profile for each model family.

## Target behaviour

For isolated Conduit Pi sessions:

| Active model | Model profile | Static search routing |
| --- | --- | --- |
| `openai-codex/*` or `openai/*` | `openai-search` | OpenAI, then Brave when OpenAI is unavailable or has a transient, quota, or network failure |
| Any other model | `brave-search` | Brave |

The OpenAI profile must include both `openai-codex/*` and `openai/*`. The
`pi-web-access` OpenAI implementation already knows how to use the Codex
Responses endpoint for Codex credentials. The catch-all profile is mandatory;
an allowed model must never start without a resolved model profile.

The model selector remains the source of truth. The model profile is derived
from the selected model and is not a second selector in the UI.

Native host-Pi sessions are out of scope. The host installation owns its own
agent directory and web configuration. Code Mode remains excluded; an isolated
template must explicitly load `pi-web-access` and opt into `web-search` before
it receives the overlay.

## Configuration contract

Add `templates/model-profiles.json` as repository-owned configuration. It is
not a Pi prompt, skill, or extension. The initial shape is:

```json
{
  "version": "1",
  "profiles": [
    {
      "id": "openai-search",
      "label": "OpenAI search",
      "matches": ["openai-codex/*", "openai/*"],
      "searchRouting": {
        "providers": ["openai", "brave"],
        "fallbackOn": ["transient", "quota", "network"]
      }
    },
    {
      "id": "brave-search",
      "label": "Brave search",
      "matches": ["*"],
      "searchRouting": {
        "providers": ["brave"],
        "fallbackOn": ["transient", "quota", "network"]
      }
    }
  ]
}
```

The loader must validate the file at startup. It must reject duplicate IDs,
empty matches, unsupported search providers, duplicate providers, invalid
fallback kinds, and configurations without a catch-all match. Do not silently
repair invalid repository configuration.

Supported match syntax is deliberately small:

- `provider/model-id` — exact match;
- `provider/*` — every model from one provider;
- `*` — catch-all.

Matching is case-insensitive. Specificity is deterministic: exact match,
provider match, then catch-all. Two matches with the same specificity that
resolve to different profiles are a configuration error. Do not add regular
expressions or arbitrary glob syntax in this slice.

The model-profile loader must expose pure functions for loading, validating,
matching, and producing a redacted public view. Keep file I/O outside the
resolver so the matching rules have direct unit-test coverage.

## Template opt-in

Add an optional `runtimeOverlays` string array to the Pi template loader in
`scripts/pi-runtime.mjs`. The Assistant and Coding templates opt into
`web-search`. Code Mode, Runtime, and native-Pi launch paths do not opt in.

This explicit opt-in prevents a model profile from changing a template that
does not expose the static tool. It also leaves room for future overlays such
as model-specific context limits without changing the chat-profile contract.

The public template view may expose the overlay names for diagnostics, but the
UI must continue to present Assistant, Coding, and Code Mode as chat profiles.

## Runtime overlay

Add a first-party runtime materializer, separate from `pi-web-access`, that
prepares an isolated Pi agent directory for a resolved model profile.

Canonical state remains in the configured Conduit Pi directory, normally
`data/pi`:

- `auth.json` remains the one Pi credential authority;
- `models.json` and the model store remain canonical;
- session files remain canonical and are still passed with `--session`;
- the Search settings file remains the canonical source for provider keys.

Materialize derived state under:

```text
data/pi/model-profiles/<profile-id>/
  auth.json -> ../../auth.json
  models.json -> ../../models.json
  models-store.json -> ../../models-store.json
  settings.json -> ../../settings.json
  web-search.json
```

Use safe profile-ID path validation and relative links. Create links even when
an optional target does not exist yet, so a later canonical file becomes
visible. Never copy `auth.json`, model credentials, or session files. The
overlay directory and generated `web-search.json` must use owner-only
permissions. Generated files are caches, not user-editable configuration.

The generated `web-search.json` is a redacted-routing overlay made from the
canonical Search settings. It must preserve configured provider credentials
needed by `pi-web-access`, then replace legacy `provider` and `searchProvider`
fields and set the resolved profile's `searchRouting`. The canonical Search
settings file remains the only source of truth. Rebuild or invalidate the
derived file when the Search settings change. Never return its contents, key
values, or absolute overlay path through an API response or log message.

The materializer must be idempotent and safe under concurrent launches. A
temporary file plus atomic rename is required for `web-search.json`. It must
not mutate the canonical Search settings while preparing a profile.

## Launch integration

Resolve the model profile before an isolated Pi process starts:

1. For a new chat, use the requested model or the catalog default.
2. For a resumed chat, read the persisted session model before launch.
3. Validate that the model remains in the template's allowed model scope.
4. Resolve the model profile.
5. Materialize the overlay only when the selected template opts into
   `web-search`.
6. Launch Pi with `PI_CODING_AGENT_DIR` set to the overlay directory while
   keeping the explicit canonical session file and existing resource flags.

The launch record must store the model-profile ID and expose that ID in the
redacted live-session diagnostic view. Do not expose the overlay path or any
runtime secret. Launch failures must name the profile ID and the failed
overlay operation without printing configuration values.

The existing Pi resource arguments remain unchanged: Conduit still disables
ambient extensions, skills, prompts, themes, context files, and approvals, and
then loads only the template's explicit resources.

## Model changes in resident sessions

The current model-change route uses Pi's live `set_model` command. Make it
profile-aware:

- If the requested model resolves to the resident process's current profile,
  keep the live `set_model` path.
- If it resolves to a different profile and the process is idle, persist the
  requested model, stop the resident process, materialize the new overlay, and
  relaunch the same session file with the requested model.
- If it resolves to a different profile while the process is generating,
  return HTTP 409 with `model_profile_transition_busy`. Do not change the UI's
  selected model or silently run the next search with the old routing.

The restart must preserve chat ID, project, template, session file, and
transcript. A process ID may change. Existing clients must receive the normal
process replacement/removal event and reconnect through the existing live
session path.

Search settings changes keep the existing safe lifecycle rule: recycle idle
isolated processes so new processes receive the derived configuration; do not
rewrite a running process's module-level `pi-web-access` configuration.

## API and UI contract

Extend the existing model view with a redacted `modelProfile` object containing
only `id`, `label`, and the resolved search provider order. Add the same ID to
the live-session view. Do not add a model-profile selector.

When a cross-profile model change is rejected, the response must contain:

```json
{
  "error": "model_profile_transition_busy",
  "message": "Finish the current response before changing to a model with different runtime settings."
}
```

The client must keep the previous model selected after this 409 and show the
message through the existing error surface. No new settings tab is required
for model profiles in this slice. The Search settings tab remains the place to
configure Brave and inspect provider availability.

## Files and ownership

Expected implementation seams:

- `templates/model-profiles.json` — model-profile definitions;
- `scripts/pi-runtime.mjs` — template overlay parsing;
- `conduit-web/src/model-profiles.js` — validation and matching;
- `conduit-web/src/model-profile-runtime.js` — derived overlay materialization;
- `conduit-web/src/pi-launch.js` — profile-aware child environment;
- `conduit-web/src/pi-manager.js` — profile metadata and replacement support;
- `conduit-web/src/server.js` — load and wire the profile services;
- `conduit-web/src/server/live-session-launcher.js` — shared profile-aware launch path;
- `conduit-web/src/server/routes/live-sessions.js` — initial resolution;
- `conduit-web/src/server/routes/chats.js` — profile-aware model changes;
- existing model, launch, server, and browser tests — contract coverage.

Do not edit installed package files under `conduit-web/node_modules`. If
`pi-web-access` changes its config contract, update the pinned dependency and
the derived-overlay adapter instead.

## Acceptance criteria

- An Assistant chat using an OpenAI or Codex model reports `openai-search` and
  uses OpenAI search first.
- An Assistant chat using an Anthropic or other non-OpenAI model reports
  `brave-search` and never tries OpenAI search.
- OpenAI search can fall back to Brave when the configured fallback conditions
  apply.
- Two concurrent Assistant chats with different model profiles use separate
  static search-routing files without copying Pi auth or session files.
- Changing models within one profile does not restart the Pi process.
- Changing to another profile while idle restarts the process against the same
  session file and the new routing.
- Changing to another profile during generation returns the documented 409 and
  leaves the current model active.
- Native host-Pi and Code Mode behavior does not change. Assistant and Coding
  use the same resolved model-profile search routing.
- API responses and logs contain no search keys, auth contents, or overlay
  paths.
- Invalid model-profile configuration fails with a precise startup error.

## Verification

Run the focused Node tests for model matching, overlay materialization, launch
environment, model changes, and live-session replacement. Then run the
repository checks selected by `docs/operations/testing.md`, at minimum:

```text
npm run typecheck
npm run build
npm test
```

Use the managed server at `127.0.0.1:4310` for UI verification. Do not start a
second Vite or Conduit server for this feature.
