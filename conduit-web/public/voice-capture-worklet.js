class ConduitVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.source = new Float32Array(0);
    this.position = 0;
    this.ratio = sampleRate / 16_000;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    let inputSum = 0;
    let peak = 0;
    for (const value of input) {
      inputSum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const combined = new Float32Array(this.source.length + input.length);
    combined.set(this.source);
    combined.set(input, this.source.length);
    const samples = [];
    while (this.position + this.ratio <= combined.length) {
      const start = Math.floor(this.position);
      const end = Math.max(start + 1, Math.min(combined.length, Math.floor(this.position + this.ratio)));
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += combined[index] || 0;
      const value = Math.max(-1, Math.min(1, sum / (end - start)));
      samples.push(value < 0 ? value * 0x8000 : value * 0x7fff);
      this.position += this.ratio;
    }
    const consumed = Math.floor(this.position);
    this.source = combined.slice(consumed);
    this.position -= consumed;
    if (samples.length) {
      const pcm = Int16Array.from(samples);
      this.port.postMessage({
        type: "pcm",
        buffer: pcm.buffer,
        rms: Math.sqrt(inputSum / input.length),
        peak,
      }, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("conduit-voice-capture", ConduitVoiceCaptureProcessor);
