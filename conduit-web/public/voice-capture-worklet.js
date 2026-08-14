const GAIN_TARGET_RMS = 0.1
const GAIN_MIN = 0.25
const GAIN_MAX = 12
const GAIN_ATTACK = 0.08
const GAIN_RELEASE = 0.025
const GAIN_HOLD_RMS = 0.0005
const SILENT_RUN_SECONDS = 0.5

class ConduitVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.source = new Float32Array(0);
    this.position = 0;
    this.ratio = sampleRate / 16_000;
    this.gain = 1;
    this.silentRun = 0;
    this.silentReported = false;
    this.silentThreshold = Math.round(SILENT_RUN_SECONDS * sampleRate);
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") this.flush();
    };
  }

  trackSignal(input) {
    for (const value of input) {
      if (value === 0) {
        this.silentRun += 1;
        if (!this.silentReported && this.silentRun >= this.silentThreshold) {
          this.silentReported = true;
          this.port.postMessage({ type: "mic_silent" });
        }
      } else {
        this.silentRun = 0;
        this.silentReported = false;
      }
    }
  }

  adaptGain(input) {
    let sum = 0;
    for (const value of input) sum += value * value;
    const rms = Math.sqrt(sum / input.length);
    if (rms < GAIN_HOLD_RMS) return;
    const desired = Math.max(GAIN_MIN, Math.min(GAIN_MAX, GAIN_TARGET_RMS / rms));
    this.gain += (desired - this.gain) * (desired > this.gain ? GAIN_ATTACK : GAIN_RELEASE);
  }

  decimate(combined) {
    const samples = [];
    let sum = 0;
    let peak = 0;
    while (this.position + this.ratio <= combined.length) {
      const start = Math.floor(this.position);
      const end = Math.max(start + 1, Math.min(combined.length, Math.floor(this.position + this.ratio)));
      let block = 0;
      for (let index = start; index < end; index += 1) block += combined[index] || 0;
      const value = Math.max(-1, Math.min(1, (block / (end - start)) * this.gain));
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
      samples.push(value < 0 ? value * 0x8000 : value * 0x7fff);
      this.position += this.ratio;
    }
    return { samples, rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak };
  }

  flush() {
    if (!this.source.length) {
      this.port.postMessage({ type: "flush_complete" });
      return;
    }
    const input = new Float32Array(this.source.length);
    input.set(this.source);
    this.adaptGain(input);
    const combined = new Float32Array(input.length + Math.ceil(this.ratio));
    combined.set(input);
    const { samples, rms, peak } = this.decimate(combined);
    this.source = new Float32Array(0);
    this.position = 0;
    if (samples.length) {
      const pcm = Int16Array.from(samples);
      this.port.postMessage({ type: "pcm", buffer: pcm.buffer, rms, peak }, [pcm.buffer]);
    }
    this.port.postMessage({ type: "flush_complete" });
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    this.trackSignal(input);
    this.adaptGain(input);
    const combined = new Float32Array(this.source.length + input.length);
    combined.set(this.source);
    combined.set(input, this.source.length);
    const { samples, rms, peak } = this.decimate(combined);
    const consumed = Math.floor(this.position);
    this.source = combined.slice(consumed);
    this.position -= consumed;
    if (samples.length) {
      const pcm = Int16Array.from(samples);
      this.port.postMessage({ type: "pcm", buffer: pcm.buffer, rms, peak }, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("conduit-voice-capture", ConduitVoiceCaptureProcessor);