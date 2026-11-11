# Hex's pipeline for all voice transcription

Hex (https://github.com/anomalyco/hex, MIT) is a local dictation app built on its own fork of transcribe.cpp. The
user wants its pipeline behind Conduit's transcription: on the hub (phase 1), and on a client that has Hex installed,
so audio never leaves that device (phase 2).

## Phase 1: the hub (state on 2026-11-11)

Built, beside the old engine: `conduit-web/src/server/voice-backends/hex.js`. The hub starts Hex's own program as a
child (`~/.local/bin/hex service --embedded`, or `CONDUIT_HEX_BIN`), reads its address and token from its first
line, and calls its HTTP API. A child that died is started again by the next call, and the model manager's idle
timer stops it. Hex keeps its own models in `~/.local/share/hex/models`; "Install" in Settings is Hex's
`POST /models/parakeet_unified_en/prepare`. The model is a second entry in Settings › Voice › Model.

Waiting on the user's go-ahead: make Hex the only local engine and delete `transcribe-cpp` 0.1.3, Moonshine,
`voice-packages.js`, `voice-model-manifests.js`, the download half of `voice-model-manager.js` and `backendFor`.

What was established, by running it on the hub (WSL2, Ryzen 5 5600X, CPU):

- Embedded mode needs no display, microphone or desktop session, and writes no discovery file or lock.
- It serves `/health`, `/models`, `/models/{id}/prepare` and `POST /transcriptions` (whole WAV in, text out). It
  answers `POST /streams` with `503 engine-unavailable`: live streams use the desktop app's dictation engine, which
  exists only once the app's microphone listener is on. Plain `hex service` runs without a display but its listener
  reports "Couldn't enable" without a microphone, so it refuses streams too.
- On a CPU, Hex's own `/streams` sends no partial text at all (Windows Hex set to CPU reports `partials: false`).
- So live dictation on the hub is ours: `createHexStream` cuts the audio at pauses (0.7 s of quiet, or 11 s), sends
  the open window to `/transcriptions` again as it grows for tentative text, and commits a window when it closes.
  The WebSocket protocol is unchanged. Calls wait in one line per Hex child, so any number of dictations can run;
  each added speaker slows the others' partial text. There is no one-stream limit on this path.
- Speed on the hub: about 0.6 s for every 12 s of audio given, never less than 0.6 s. First partial text 1.3 to
  3.5 s after recording starts, then roughly every 0.65 s. Final text 0 to 1.1 s after stop.
- Batch voice messages go to Hex whole (`wholeClips`); Hex filters silence and cuts long audio itself.
- Not reached through the embedded API: vocabulary biasing and output processing (it loads no settings and answers
  `processing-unavailable`). Hex's Windows build uses both from its own settings.
- The copied `.verified.json` receipts do not carry over (Hex verifies the files again on first prepare, ~1 s).
- The model's licence shown in Settings (CC-BY-4.0) is assumed from NVIDIA Parakeet, not read from Hex.

## Phase 2

**Release installs and the VPS.** The hub needs the `hex` binary (72 MB, glibc ≥ 2.36, AVX2; x64 and arm64 builds
exist) and the model (731 MB, which Hex downloads itself on prepare). Open: who downloads the binary (the installer,
or the first model install, as `voice-packages.js` did for the addon), pinning its version and checksum (GitHub
releases carry no checksum file), and whether the VPS has the memory: the child holds about 1.2 GB while loaded.
Hex's updater did not run in embedded mode in these tests; check before relying on that.

**The Windows client.** The user's Windows Hex (dev channel) serves the local API: `%APPDATA%\hex\local-api.json`
gives the port and token, and it answered from WSL over loopback. With its RTX 3070 it transcribed 3 to 26 s clips
in 0.1 to 0.3 s and its `/streams` sent partial text (first partial about 3.3 s after the audio started, measured
from WSL). Hex's `docs/windows.md` still says the API is missing on Windows; the running build disagrees. The
desktop app's Rust shell can read the discovery file and call `POST /transcriptions`, or `/streams` (one live
stream at a time, 10 s lease, Hex's own dictation goes first). A browser tab and the Android app cannot. The option
belongs under Settings › Voice › Input (this device). Decide then whether the client uses `/streams` or the same
windowed batch calls as the hub: on a GPU the batch calls are fast enough for both.

## Rules that apply

Change and test on conduit-local only; do not push. Never name an engine choice in Settings again: commit
`96038469` removed one. Commit each finished piece with explicit paths.
