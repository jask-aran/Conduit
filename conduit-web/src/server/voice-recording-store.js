import crypto from "node:crypto";
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

export const MAX_VOICE_DIAGNOSTIC_RECORDINGS = 20;
export const MAX_SHORT_VOICE_DIAGNOSTIC_RECORDINGS = 4;
export const MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES = 16_000 * 2;
export const VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_PENDING_ARCHIVE_RECORDS = 2;
const MAX_PENDING_ARCHIVE_BYTES = 32 * 1024 * 1024;

function wavBuffer(chunks, byteLength) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(byteLength, 40);
  return Buffer.concat([header, ...chunks], 44 + byteLength);
}

function recordingId(createdAt) {
  return `${createdAt.replace(/[.:]/g, "-")}-${crypto.randomUUID()}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export class VoiceRecordingStore {
  constructor({ root, maxRecords = MAX_VOICE_DIAGNOSTIC_RECORDINGS, maxShortRecords = MAX_SHORT_VOICE_DIAGNOSTIC_RECORDINGS, minAudioBytes = MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, maxPendingRecords = MAX_PENDING_ARCHIVE_RECORDS, maxPendingBytes = MAX_PENDING_ARCHIVE_BYTES } = {}) {
    if (!root) throw new Error("VoiceRecordingStore requires a root directory");
    this.root = path.resolve(root);
    this.maxRecords = Math.max(1, Math.trunc(Number(maxRecords) || MAX_VOICE_DIAGNOSTIC_RECORDINGS));
    this.maxShortRecords = Math.max(0, Math.trunc(Number(maxShortRecords) || 0));
    this.minAudioBytes = Math.max(1, Math.trunc(Number(minAudioBytes) || MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES));
    this.maxPendingRecords = Math.max(1, Math.trunc(Number(maxPendingRecords) || MAX_PENDING_ARCHIVE_RECORDS));
    this.maxPendingBytes = Math.max(1, Math.trunc(Number(maxPendingBytes) || MAX_PENDING_ARCHIVE_BYTES));
    this.archiveQueue = [];
    this.archiveActive = 0;
    this.archivePendingBytes = 0;
    this.archiveClosing = false;
  }

  enqueue(options = {}) {
    if (this.archiveClosing) {
      throw Object.assign(new Error("Voice diagnostic archive is shutting down"), { code: "voice_archive_shutdown" });
    }
    const chunks = (options.audioChunks || []).map((chunk) => Buffer.from(chunk));
    const bytes = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (this.archiveQueue.length + this.archiveActive >= this.maxPendingRecords || this.archivePendingBytes + bytes > this.maxPendingBytes) {
      throw Object.assign(new Error("Voice diagnostic archive capacity is full"), { code: "voice_archive_capacity" });
    }
    const enqueuedAt = performance.now();
    return new Promise((resolve, reject) => {
      this.archiveQueue.push({ options: { ...options, audioChunks: chunks }, bytes, enqueuedAt, resolve, reject });
      this.archivePendingBytes += bytes;
      this.pumpArchiveQueue();
    });
  }

  pumpArchiveQueue() {
    if (this.archiveActive || !this.archiveQueue.length) return;
    const job = this.archiveQueue.shift();
    this.archiveActive += 1;
    Promise.resolve()
      .then(() => this.save(job.options, { queueDelayMs: performance.now() - job.enqueuedAt }))
      .then(job.resolve, job.reject)
      .finally(() => {
        this.archiveActive -= 1;
        this.archivePendingBytes = Math.max(0, this.archivePendingBytes - job.bytes);
        this.pumpArchiveQueue();
      });
  }

  async save({ audioChunks = [], audioBytes = 0, transcript = "", metadata = {}, allowEmptyTranscript = false, allowShortAudio = false } = {}, { queueDelayMs = 0 } = {}) {
    const chunks = audioChunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const text = String(transcript || "").trim();
    if ((!allowShortAudio && byteLength < this.minAudioBytes) || (!text && !allowEmptyTranscript)) return null;
    if (Number.isFinite(audioBytes) && Number(audioBytes) !== byteLength) {
      throw new Error(`Voice diagnostic audio length mismatch (${audioBytes} reported, ${byteLength} buffered)`);
    }

    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const createdAt = new Date().toISOString();
    const id = recordingId(createdAt);
    const audioFile = `${id}.wav`;
    const metadataFile = `${id}.json`;
    const audioPath = path.join(this.root, audioFile);
    const metadataPath = path.join(this.root, metadataFile);
    const temporaryId = `.pending-${crypto.randomUUID()}`;
    const temporaryAudioPath = path.join(this.root, `${temporaryId}.wav`);
    const temporaryMetadataPath = path.join(this.root, `${temporaryId}.json`);
    const archive = {
      queueDelayMs: Math.max(0, Math.round(Number(queueDelayMs) || 0)),
      writeDurationMs: null,
      path: { audioFile, metadataFile },
      rotation: null,
      failure: null,
    };
    const record = {
      ...metadata,
      schemaVersion: 2,
      id,
      createdAt,
      audioFile,
      transcript: text,
      transcriptStatus: text ? "non_empty" : "empty",
      audioBytes: byteLength,
      audioDurationMs: Math.round(byteLength / 32),
      audioClass: byteLength < this.minAudioBytes ? "short" : "standard",
      archive,
    };
    let phase = "write";
    const writeStartedAt = performance.now();
    try {
      await fs.writeFile(temporaryAudioPath, wavBuffer(chunks, byteLength), { mode: 0o600 });
      await fs.writeFile(temporaryMetadataPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      phase = "publish_audio";
      await fs.rename(temporaryAudioPath, audioPath);
      phase = "publish_metadata";
      await fs.rename(temporaryMetadataPath, metadataPath);
      archive.writeDurationMs = Math.max(0, Math.round(performance.now() - writeStartedAt));
      phase = "rotation";
      const rotationStartedAt = performance.now();
      const rotation = await this.rotate();
      archive.rotation = {
        ...rotation,
        durationMs: Math.max(0, Math.round(performance.now() - rotationStartedAt)),
      };
      record.archive = archive;
      await this.updateMetadata(record, { archive });
      return record;
    } catch (error) {
      archive.failure = {
        code: error?.code || "voice_archive_failed",
        message: String(error?.message || "Voice diagnostic archive failed").slice(0, 240),
        phase,
      };
      await Promise.all([
        fs.rm(temporaryAudioPath, { force: true }),
        fs.rm(temporaryMetadataPath, { force: true }),
        fs.rm(audioPath, { force: true }),
        fs.rm(metadataPath, { force: true }),
      ]);
      const archiveError = error instanceof Error ? error : new Error(String(error || "Voice diagnostic archive failed"));
      archiveError.archive = archive;
      throw archiveError;
    }
  }

  async drain({ timeoutMs = VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS } = {}) {
    this.archiveClosing = true;
    const startedAt = performance.now();
    const deadline = startedAt + Math.max(0, Number(timeoutMs) || 0);
    while (this.archiveActive > 0 || this.archiveQueue.length > 0) {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        const dropped = this.archiveQueue.splice(0);
        const droppedBytes = dropped.reduce((total, job) => total + job.bytes, 0);
        this.archivePendingBytes = Math.max(0, this.archivePendingBytes - droppedBytes);
        const error = Object.assign(new Error("Voice diagnostic archive shutdown deadline reached"), { code: "voice_archive_shutdown_timeout" });
        for (const job of dropped) job.reject(error);
        return {
          drained: false,
          timedOut: true,
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
          activeRecords: this.archiveActive,
          droppedRecords: dropped.length,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
    }
    return {
      drained: true,
      timedOut: false,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      activeRecords: 0,
      droppedRecords: 0,
    };
  }

  async updateMetadata(record, updates = {}) {
    if (!record?.id) throw new Error("Voice diagnostic metadata requires a record id");
    const metadataPath = path.join(this.root, `${path.basename(String(record.id))}.json`);
    const current = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    const next = { ...current, ...updates, schemaVersion: 2 };
    const temporaryMetadataPath = path.join(this.root, `.pending-${crypto.randomUUID()}.json`);
    try {
      await fs.writeFile(temporaryMetadataPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryMetadataPath, metadataPath);
      return next;
    } finally {
      await fs.rm(temporaryMetadataPath, { force: true });
    }
  }

  async rotate() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const rotation = {
      removedPairs: 0,
      removedInvalidMetadata: 0,
      removedOrphanAudio: 0,
      removedPendingFiles: 0,
    };
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const metadataEntries = [];
    const referencedAudio = new Set();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".pending-")) continue;
      const metadataPath = path.join(this.root, entry.name);
      try {
        const record = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        const audioFile = path.basename(String(record.audioFile || ""));
        if (!audioFile || audioFile !== record.audioFile || !(await exists(path.join(this.root, audioFile)))) {
          await fs.rm(metadataPath, { force: true });
          rotation.removedInvalidMetadata += 1;
          continue;
        }
        referencedAudio.add(audioFile);
        metadataEntries.push({ metadataPath, audioPath: path.join(this.root, audioFile), record });
      } catch {
        await fs.rm(metadataPath, { force: true });
        rotation.removedInvalidMetadata += 1;
      }
    }
    metadataEntries.sort((left, right) => String(left.record.createdAt || "").localeCompare(String(right.record.createdAt || "")));
    const standard = metadataEntries.filter(({ record }) => Number(record.audioBytes) >= this.minAudioBytes);
    const short = metadataEntries.filter(({ record }) => Number(record.audioBytes) < this.minAudioBytes);
    const keep = new Set([
      ...standard.slice(-this.maxRecords),
      ...(this.maxShortRecords ? short.slice(-this.maxShortRecords) : []),
    ]);
    for (const entry of metadataEntries.filter((candidate) => !keep.has(candidate))) {
      await fs.rm(entry.metadataPath, { force: true });
      await fs.rm(entry.audioPath, { force: true });
      rotation.removedPairs += 1;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".wav") || entry.name.startsWith(".pending-")) continue;
      if (!referencedAudio.has(entry.name)) {
        await fs.rm(path.join(this.root, entry.name), { force: true });
        rotation.removedOrphanAudio += 1;
      }
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(".pending-")) {
        await fs.rm(path.join(this.root, entry.name), { force: true });
        rotation.removedPendingFiles += 1;
      }
    }
    return rotation;
  }
}
