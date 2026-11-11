# Hex's pipeline for all voice transcription

Hex (https://github.com/anomalyco/hex, MIT) is a local dictation app built on its own fork of transcribe.cpp. The
user wants its pipeline behind Conduit's transcription: on the hub (phase 1), and on a client that has Hex installed,
so audio never leaves that device (phase 2).

## Phase 1: the hub (done 2026-11-11)

Hex is the hub's only local engine: `conduit-web/src/server/voice-backends/hex.js`. The hub starts Hex's own program
as a child (`~/.local/bin/hex service --embedded`, or `CONDUIT_HEX_BIN`), reads its address and token from its first
line, and calls its HTTP API. A child that died is started again by the next call (checked by killing it), and the
model manager's idle timer stops it. Hex keeps its own models in `~/.local/share/hex/models`; "Install" in Settings
is Hex's `POST /models/parakeet_unified_en/prepare`. Live dictation and batch voice messages both send the whole
recording to `POST /transcriptions` when recording stops, so text appears at stop, as Hex desktop does on a CPU.

The rule from the user: Conduit is a front end to Hex. It does not cut audio or send audio again to imitate
partial text; live text comes only from Hex's own `/streams`.

Established by running it on the hub (WSL2, Ryzen 5 5600X, CPU), with Hex 3.3.0 and dev-932:

- Embedded mode needs no display, microphone or desktop session, and writes no discovery file or lock.
- It answers `POST /streams` with `503 engine-unavailable`: live streams use the desktop app's dictation engine,
  which exists only once the app's microphone listener is on. Plain `hex service` runs without a display but its
  listener reports "Couldn't enable" without a microphone, so it refuses streams too.
- On a CPU, Hex's own `/streams` sends no partial text anyway (Windows Hex set to CPU reports `partials: false`).
- Speed on the hub: about 0.6 s for every 12 s of audio, never less than 0.6 s; about 0.2 s of that is CPU work
  and the rest is a wait inside the Linux build. Windows Hex on the same CPU has no such floor.
- Calls wait in one line per Hex child, so several people can dictate; each waits for the ones ahead.
- Not reached through the embedded API: vocabulary biasing and output processing (it loads no settings).
- The model's licence shown in Settings (CC-BY-4.0) is assumed from NVIDIA Parakeet, not read from Hex.

## Phase 2

**Release installs and the VPS.** The hub needs the `hex` binary (72 MB, glibc ≥ 2.36, AVX2; x64 and arm64 builds
exist) and the model (731 MB, which Hex downloads itself on prepare). Open: who downloads the binary (the installer,
or the first model install, as `voice-packages.js` did for the addon), pinning its version and checksum (GitHub
releases carry no checksum file), and whether the VPS has the memory: the child holds about 1.2 GB while loaded.
Hex's updater did not run in embedded mode in these tests; check before relying on that.

**The desktop client (built 2026-11-11).** Settings › Voice › Input has "Use Hex when available" (per device, off
by default, shown only when the desktop shell finds a running Hex). With it on, dictation opens Hex's own `/streams`
through the shell (`src-tauri/src/hex_local.rs` reads `local-api.json`; the token never reaches the page) and
`src/client/platform/hex-local.ts` turns Hex's events into the dictation socket's frames. When Hex is not running or
refuses the stream, that dictation goes to the hub. Hex's `docs/windows.md` says the API is missing on Windows; the
running build serves it. Measured on the user's RTX 3070: first partial text about 3.3 s after the audio starts, then
about once a second (that is the streaming model's own cadence), final text 0.05 to 0.3 s after stop. A browser tab
and the Android app cannot reach Hex. Not built: the same switch for voice messages recorded by Android Float.

## Rules that apply

Change and test on conduit-local only; do not push. Never name an engine choice in Settings again: commit
`96038469` removed one. Commit each finished piece with explicit paths.
