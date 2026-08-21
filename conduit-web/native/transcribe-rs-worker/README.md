# Conduit `transcribe-rs` worker

This package is the managed ONNX BatchPort worker for Parakeet TDT v2 and v3.
It runs as an unprivileged child process. It does not open a TCP or HTTP port.

Build and test it from this directory:

```sh
cargo test
cargo build --release --locked
```

The server starts `target/release/conduit-transcribe-rs-worker` unless
`CONDUIT_TRANSCRIBE_RS_WORKER` names another executable. The worker links the
ORT 1.24.2 binaries supplied by `ort` 2.0.0-rc.12 at build time. The initial
build is CPU-only and targets the host architecture. The current verified
target is `x86_64-unknown-linux-gnu`.

The standard input and output protocol is version 1. Each frame starts with
two little-endian `uint32` values: JSON header bytes and binary payload bytes.
The worker writes protocol frames only to stdout. Bounded diagnostics go to
stderr. The protocol accepts `hello`, `load`, `transcribe_range`, `cancel`,
`unload`, `health`, and `shutdown`.

`transcribe_range` accepts 16 kHz mono PCM16 and absolute sample positions. The
worker converts PCM16 to the crate's `f32` input once. It returns segment
timestamps only when the crate reports finite, ordered, in-range values.

The upstream records used by this package are:

- `transcribe-rs` 0.3.8, MIT, registry checksum
  `b231bc9bd1b20be89583a49c3885dfa7d7323299564ee78eddf83db04f2b337b`;
- `ort` 2.0.0-rc.12, MIT/Apache-2.0, registry checksum
  `d7de3af33d24a745ffb8fab904b13478438d1cd52868e6f17735ef6e1f8bf133`;
- bundled ONNX Runtime 1.24.2, CPU provider only in this build.

The model package remains the reviewed Conduit Parakeet ONNX package. Its
revisions, file sizes, SHA-256 values, and CC-BY-4.0 attribution live in
`src/server/voice-model-manifests.js` and the execution catalogue.
