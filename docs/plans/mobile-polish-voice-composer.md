# Mobile polish and voice-first composer

Status: shaping, 2026-10-08, **nothing implemented**.
Scope: `conduit-web` phone layout and composer, Android client.
Related: [DESIGN.md](../../DESIGN.md),
[component plan](component-system-storybook-generative-ui.md) (its gallery
phone preset becomes the check seam once it exists), [testing](../TESTING.md).

## Why

The phone is where I use Conduit on the go, and typing long prompts there is
the slowest part. Make mobile a little nicer: fix visible bugs first, then
explore a composer where voice is the primary input.

## Stage 1: visual bugs

Screenshot-driven list, each fixed and verified on the Android emulator at
phone width.

- **Long unbroken words overflow the user bubble** and make the transcript
  scroll horizontally. Fixed: `overflow-wrap: anywhere` on `.bubble-user`.

## Stage 2: voice-first composer (phone)

### Shape

- **Idle: a row of buttons, no text line.** The composer keeps its one-row
  pill, but by default it holds only controls: attach, a **keyboard** button,
  the mic as the primary action, and send/stop.
- **Keyboard mode: two rows.** Tapping keyboard focuses a textarea and the
  composer grows into two rows, with the text on top and the same controls
  below. Dismissing the keyboard with an empty draft returns to the button row.
- **Listening: coloured frost.** While the mic is live, a soft multi-hue
  glow (Siri-like) sits behind the composer's frosted glass and moves with the
  input level, driven by an `AnalyserNode` on the mic stream. It is a
  compositor-only CSS transform/opacity animation, within the frame budget.
- **Candidate text.** With a live (streaming) transcription model, partial
  text shows above the controls as it arrives: words that are still
  provisional are dimmed and firm up when final. On stop it becomes the
  editable draft.

### Decisions

1. **Reuse the existing dictation stack unchanged.** Transcription, activation
   (toggle / push-to-talk), auto-send and device settings stay as they are
   (`chat/voice-dictation-client.ts`, `voice-dictation.ts`, voice settings).
   This stage only redesigns the presentation.
2. **The glow reads the existing level signal.** It is driven by the
   `AudioSignalLevel` that already feeds `voice-waveform.tsx`, not a new
   analyser; on phone the glow may replace the inline waveform.
3. **Candidate text is the existing dictated range**, restyled: the live
   range (`beginDictatedRange` / `replaceDictatedRange`) renders as
   provisional text until dictation completes.
4. **Phone only.** Desktop keeps today's always-open textarea composer.

5. **Two-row stays while a draft exists**, even after the keyboard closes,
   until the draft is sent or cleared.

### Variants to prototype

Build both behind a dev toggle and choose on the phone:

- **A. Single surface, mic-dominant.** One frosted pill holding a big centred
  mic (or a wide mic pill), with small + and keyboard at the edges and
  send/stop on the right.
- **B. Button bar.** Separate circular buttons or pills in one row with no
  shared surface. The keyboard opens a separate text composer above the bar.

Candidate text, also tried both ways:

- **Top row**: the text appears where you'd type it, with provisional words
  dimmed.
- **Floating** (Claude app reference): caption-style italic muted text with
  no surface, sitting just above the composer. Only the most recent ~3 lines
  show; older lines scroll up and out as you speak, so it never takes over
  the transcript. On stop it drops into the draft.

While listening, the composer itself becomes one row: cancel (✕), a full-width
live waveform, stop (keep the draft), and send (stop and send now).

### Open questions

- Behaviour while a turn streams (queues into the strip, per existing rules).

## Non-goals (for now)

Spoken replies (TTS), voice-only conversation mode, wake words.
