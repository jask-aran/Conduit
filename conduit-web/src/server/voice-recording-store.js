import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MAX_VOICE_DIAGNOSTIC_RECORDINGS = 20;
export const MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES = 16_000 * 2;

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
  constructor({ root, maxRecords = MAX_VOICE_DIAGNOSTIC_RECORDINGS, minAudioBytes = MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES } = {}) {
    if (!root) throw new Error("VoiceRecordingStore requires a root directory");
    this.root = path.resolve(root);
    this.maxRecords = Math.max(1, Math.trunc(Number(maxRecords) || MAX_VOICE_DIAGNOSTIC_RECORDINGS));
    this.minAudioBytes = Math.max(1, Math.trunc(Number(minAudioBytes) || MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES));
  }

  async save({ audioChunks = [], audioBytes = 0, transcript = "", metadata = {} } = {}) {
    const chunks = audioChunks.map((chunk) => Buffer.from(chunk));
    const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const text = String(transcript || "").trim();
    if (byteLength < this.minAudioBytes || !text) return null;
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
    const record = {
      ...metadata,
      schemaVersion: 1,
      id,
      createdAt,
      audioFile,
      transcript: text,
      audioBytes: byteLength,
      audioDurationMs: Math.round(byteLength / 32),
    };
    try {
      await fs.writeFile(temporaryAudioPath, wavBuffer(chunks, byteLength), { mode: 0o600 });
      await fs.writeFile(temporaryMetadataPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryAudioPath, audioPath);
      await fs.rename(temporaryMetadataPath, metadataPath);
      await this.rotate();
      return record;
    } catch (error) {
      await Promise.all([
        fs.rm(temporaryAudioPath, { force: true }),
        fs.rm(temporaryMetadataPath, { force: true }),
        fs.rm(audioPath, { force: true }),
        fs.rm(metadataPath, { force: true }),
      ]);
      throw error;
    }
  }

  async rotate() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
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
          continue;
        }
        referencedAudio.add(audioFile);
        metadataEntries.push({ metadataPath, audioPath: path.join(this.root, audioFile), record });
      } catch {
        await fs.rm(metadataPath, { force: true });
      }
    }
    metadataEntries.sort((left, right) => String(left.record.createdAt || "").localeCompare(String(right.record.createdAt || "")));
    for (const entry of metadataEntries.slice(0, -this.maxRecords)) {
      await fs.rm(entry.metadataPath, { force: true });
      await fs.rm(entry.audioPath, { force: true });
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".wav") || entry.name.startsWith(".pending-")) continue;
      if (!referencedAudio.has(entry.name)) await fs.rm(path.join(this.root, entry.name), { force: true });
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(".pending-")) await fs.rm(path.join(this.root, entry.name), { force: true });
    }
  }
}
