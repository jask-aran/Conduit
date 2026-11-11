# Hex's pipeline for all voice transcription

Hex (https://github.com/anomalyco/hex, MIT) is a local dictation app built on its own fork of transcribe.cpp. The
user wants its pipeline behind Conduit's transcription: on the hub (phase 1), and on a client that has Hex installed,
so audio never leaves that device (phase 2).

## Phase 1: the hub (done 2026-11-11)

Hex is the hub's only local engine: `conduit-web/src/server/voice-backends/hex.js`. The first model install downloads
Hex's own program (the pinned `HEX_VERSION`, checked against GitHub's digest of the release file) into the hub's
`voice/` data folder, and a session downloads it again after a version change. The hub starts it as a child
(`service --embedded`, data in `voice/hex`, or `CONDUIT_HEX_BIN` for another program), reads its address and token
from its first line, and calls its HTTP API. A child that died is started again by the next call, and the model
manager's idle timer stops it. "Install" in Settings is Hex's `POST /models/<id>/prepare`, which downloads, verifies
and resumes by itself. Live dictation and batch voice messages both send the whole recording to `POST /transcriptions`
when recording stops, so text appears at stop, as Hex desktop does on a CPU.

The rule from the user: Conduit is a front end to Hex. It does not cut audio or send audio again to imitate
partial text; live text comes only from Hex's own `/streams`.

Established by running it on the hub (WSL2, Ryzen 5 5600X, CPU), with Hex 3.3.0 and dev-932:

- Embedded mode needs no display, microphone or desktop session. It answers `POST /streams` with
  `503 engine-unavailable` (live streams need the desktop app's microphone listener), and loads no settings, so
  vocabulary biasing and output processing are not reached.
- Every transcription takes a multiple of about 0.6 s inside Hex, whatever sends the request, so 3 to 26 s clips take
  0.6 to 1.9 s on every Parakeet-sized model. Calls wait in one line per Hex child.
- Models, eight of the user's dictations (117 s), CPU seconds per second of audio and memory held:
  Parakeet v2 0.47, 1.2 GB (the default: punctuated, false starts left out); SenseVoice Small 0.33, 0.4 GB (misses
  more unusual words); Whisper large-v3-turbo 3.9, 1.0 GB, 7 to 8 s a clip. Not offered: Parakeet Unified and Nemotron
  (streaming models; no closing punctuation), Qwen3-ASR (3 to 4 s, no better), Parakeet v3 (needs a language chosen:
  `language=auto` drops the connection).

## Phase 2

**Not done for the hub.** A hub with a GPU and the VPS are untested; Hex needs glibc ≥ 2.36 and AVX2. A language
setting would let Parakeet v3 in. Hex's updater did not run in embedded mode in these tests.

**The desktop client (built 2026-11-11).** Settings › Voice has a Hex group on the desktop app: whether Hex was found
(`hex_status`) and "Dictate with Hex" (per device, off by default). With it on, dictation opens Hex's own `/streams`
through the shell (`src-tauri/src/hex_local.rs` reads `local-api.json`; the token never reaches the page) and
`src/client/platform/hex-local.ts` turns Hex's events into the dictation socket's frames. When Hex is not running or
refuses the stream, that dictation goes to the hub. Hex's `docs/windows.md` says the API is missing on Windows; the
running build serves it. Measured on the user's RTX 3070: first partial text about 3.3 s after the audio starts, then
about once a second (that is the streaming model's own cadence), final text 0.05 to 0.3 s after stop. A browser tab
and the Android app cannot reach Hex. Not built: the same switch for voice messages recorded by Android Float.

## Rules that apply

Change and test on conduit-local first. Never name an engine choice in Settings again: commit
`96038469` removed one. Commit each finished piece with explicit paths.
