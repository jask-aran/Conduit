# Idea: Hex's pipeline for all voice transcription (2026-11-11)

Nothing is started. This file is the whole brief.

## What the user wants

"Adding Hex's backend/pipeline to power all voice transcription. It would be a hex/transcribe.cpp running on the
hub, and also where the user has Hex installed on their client, clients could gain a local transcription option,
bypassing sending to the hub over the internet."

Two parts:

1. On the hub: Hex's transcription pipeline as the engine behind Conduit's transcription.
2. On a client that has Hex installed: a local transcription option, so audio never goes to the hub.

## What Hex is (read 2026-11-11 from the repository; the user confirmed the link)

https://github.com/anomalyco/hex : "Local voice dictation for mac, windows and linux". MIT. Rust. Hold a key,
speak, it pastes; it transcribes on the device, and after the first model download nothing leaves the machine.
Builds for macOS (Apple silicon), Windows x64/ARM64 and Linux x64/ARM64. It does not take pull requests.

Its engine is transcribe.cpp: `Cargo.toml` pins `transcribe-cpp = "=0.4.1"` (with the `vulkan` feature) and
patches it from Hex's own fork, https://github.com/anomalyco/transcribe.cpp, for Parakeet vocabulary rescoring
("hex/parakeet-vocabulary"). That fork is what the user means by "hex/transcribe.cpp". The repository also has
`crates/` (capture-core, capture, console, router), an `sdk/` (TypeScript, and a `service-darwin-arm64` package)
and docs worth reading first: `docs/cli.md`, `docs/transcript-cli.md`, `docs/streams.md`, `docs/windows.md`,
`docs/linux.md`. It depends on `rmcp` (an MCP server crate), so it may already speak MCP. None of those were read.

## What Conduit already has

The hub already runs transcribe.cpp: `conduit-web/src/server/voice-backends/transcribe-cpp.js`, built from "the
Handy transcribe.cpp port" with one model (Moonshine Streaming Tiny, English, live;
`handy-computer/moonshine-streaming-tiny-gguf`). So part 1 is not "add transcribe.cpp" but "use Hex's build and
pipeline of it": its fork and patches, its models (Parakeet), and whatever it does around the engine (capture,
segmentation, vocabulary, streaming). Compare the two before deciding whether to swap the build, add models to the
existing backend, or run Hex's own service beside the hub.

## Not established (find out first, and say what you found)

- What of Hex another program can call: the CLI, the SDK's service, a local port, or only the crates. This decides
  both parts.
- Whether the hub's machines (Linux in WSL at home, a Linux VPS for conduit-dev, no GPU assumed) run it well.
- How a client detects an installed Hex and hands it audio: the desktop app's Rust shell can; Android has no Hex
  build listed; a browser tab cannot reach a local program.

## What exists in Conduit (verify before relying on it)

- Hub: `conduit-web/src/server/voice-transcription.js`, `voice-runtime.js`, `voice-runtime-adapters.js`,
  `voice-backends/`, `voice-model-manager.js`, `voice-model-manifests.js`, `dictation-stream.js`.
- Settings › Voice has three groups by owner: Transcription (the hub), Input (this device), Dictation (every
  device). A local option belongs under Input (this device); the user asked earlier that it stay clear "what are
  server settings and what are client settings".
- A voice runtime selector was removed on 2026-11-10 as machinery for a choice that no longer existed; adding an
  engine brings a choice back, so check that commit (`96038469`) before rebuilding what it removed.

## Rules that apply

Read `AGENTS.md`, `CONTRIBUTING.md` and `docs/TESTING.md` first. Change and test on conduit-local only; do not
push. Live voice tests: see `docs/TESTING.md`. Commit each finished piece with explicit paths.
