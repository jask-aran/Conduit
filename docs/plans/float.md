# Float: from jbot's mic to the phone's way into Conduit

Float is Android's overlay at the screen's edge (`ConduitFloatService` and its parts). Today a tap records a voice
message for jbot. This plan makes it the phone's way to send anything to any chat, from over any app.

## Decisions (2026-11-04)

- **The hub does not know about Float.** The phone composes every send from the hub's general routes:
  `POST /v0/chats` (no `projectId` is a **loose chat**, in the built-in `chat` project), `PUT /v0/chats/:id/attachments/:id`,
  `POST /v0/chats/:id/prompt`, `POST /v0/agent/messages` and `voice-message` for jbot, `POST /v0/voice/transcribe`, and
  a recent-chats read with each chat's latest reply. Native code reaches them through `ConduitHubAuth` and
  `ConduitHubClient`.
- **Gathered context, then a target.** Context (screenshots, photos, the screen's text) is captured at the moment it is
  asked for and held on Float until a send; choosing a target never has to come first.
- **Targets:** jbot, New loose chat, Workspace… (a picker of projects and workspaces, then a new chat there), Recent…
  (recently finished chats with their latest reply; read it and answer in place).
- **Gestures on the handle:**
  - *Drag at once* moves Float, as now.
  - *Hold* (about 250 ms, still) starts recording to the **default target** (a setting: jbot or a new loose chat) and
    opens the radial around the finger. *Release in place* sends to the default. *Slide onto a target* locks the
    recording to that target, hands free (the same as tapping and choosing it). *Slide onto ✕* cancels.
  - *Tap* opens the radial: the four targets, and Screenshot and Camera as context.
- **Screen context:** an Accessibility service when it is on (screenshots with no prompt on API 30+, plus the screen's
  text and the app's name), MediaProjection when it is not (a consent dialog per capture: Android 14+ ends a projection
  with each consent). Float nudges toward Accessibility on the first screenshot and after a MediaProjection prompt.
- **Camera:** a transparent activity over Float takes the system camera's photo and hands it back.
- **Native panels, not a WebView.** Battery and memory first: no resident renderer at rest. The reply view shows text
  with basic Markdown and an Open in Conduit for anything richer.

## Phases

- [ ] 0a. Split the service into service, `FloatMachine`, `FloatRecorder`, `FloatSender`, `FloatWindow`, `FloatView`;
      no allocation per frame in drawing. No change in behaviour.
- [ ] 0b. `ConduitHubClient` over the general routes; `POST /v0/voice/transcribe`; recent chats with the latest reply.
- [ ] 1. Hold, the radial, locking, the default-target setting; errors that keep what was gathered and say what to do.
- [ ] 2. Context: Accessibility service, MediaProjection fallback, camera activity, the tray of thumbnails.
- [ ] 3. Native Workspace… and Recent… panels, and answering from the reply view.

## The radial (phase 1 sketch)

- A fan opening inward from Float's edge, centred on the handle. Outer arc (radius about 96dp, spread about ±70° from
  the inward normal): the four targets, jbot first nearest the top. Inner arc (about 56dp): Screenshot and Camera on a
  tap; ✕ alone at its middle during a hold (context waits until the recording is locked or sent).
- Each slot is a 48dp frost circle with its icon (the touch target); the slot under the finger lifts and shows its name in
  a small frost caption. Near the top or bottom of the screen the fan turns so every slot stays on screen.
- A tap outside closes it, keeping what was gathered (a count badge on the handle). Opening and closing reuse the
  morph's curve; slots arrive staggered by a few ms from the handle outward.
