const TARGET_SAMPLE_RATE = 16_000
const RESAMPLER_RADIUS = 8
const RESAMPLER_PHASE_COUNT = 256
const RESAMPLER_INITIAL_CAPACITY = 4096
const PACKET_SAMPLES = 320
const PACKET_BYTES = PACKET_SAMPLES * 2
const MAX_RETURNED_BUFFERS = 4
const SILENT_RUN_SECONDS = 0.5

function emptySignalStats() {
  return { sumSquares: 0, sampleCount: 0, peak: 0, clippedSamples: 0 }
}

function serializeSignalStats(stats) {
  return {
    rms: stats.sampleCount ? Math.sqrt(stats.sumSquares / stats.sampleCount) : 0,
    peak: stats.peak,
    clippedSamples: stats.clippedSamples,
  }
}

function buildPhaseKernels(ratio) {
  const cutoff = Math.min(0.5, 0.5 / Math.max(1, ratio))
  const kernels = new Array(RESAMPLER_PHASE_COUNT)
  for (let phase = 0; phase < RESAMPLER_PHASE_COUNT; phase += 1) {
    const fraction = phase / (RESAMPLER_PHASE_COUNT - 1)
    const kernel = new Float32Array(RESAMPLER_RADIUS * 2 + 1)
    for (let offset = -RESAMPLER_RADIUS; offset <= RESAMPLER_RADIUS; offset += 1) {
      const distance = fraction - offset
      const normalized = 2 * cutoff * distance
      const sinc = Math.abs(normalized) < 1e-8 ? 1 : Math.sin(Math.PI * normalized) / (Math.PI * normalized)
      const window = 0.5 + 0.5 * Math.cos(Math.PI * distance / (RESAMPLER_RADIUS + 1))
      kernel[offset + RESAMPLER_RADIUS] = 2 * cutoff * sinc * window
    }
    kernels[phase] = kernel
  }
  return kernels
}

class ConduitVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.source = new Float32Array(RESAMPLER_INITIAL_CAPACITY)
    this.sourceLength = 0
    this.position = 0
    this.inputSampleCount = 0
    this.outputSampleCount = 0
    this.ratio = sampleRate / TARGET_SAMPLE_RATE
    this.phaseKernels = buildPhaseKernels(this.ratio)
    this.silentRun = 0
    this.silentReported = false
    this.silentThreshold = Math.round(SILENT_RUN_SECONDS * sampleRate)
    this.packetBuffer = new Int16Array(PACKET_SAMPLES)
    this.packetOffset = 0
    this.packetRaw = emptySignalStats()
    this.packetProcessed = emptySignalStats()
    this.returnedBuffers = []
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") this.flush()
      if (event.data?.type === "return_buffer") this.returnBuffer(event.data.buffer)
    }
  }

  trackSignal(input) {
    for (const value of input) {
      if (value === 0) {
        this.silentRun += 1
        if (!this.silentReported && this.silentRun >= this.silentThreshold) {
          this.silentReported = true
          this.port.postMessage({ type: "digital_silence", diagnostic: "device_stall" })
        }
      } else {
        this.silentRun = 0
        this.silentReported = false
      }
    }
  }

  signalStats(input) {
    const stats = emptySignalStats()
    for (const value of input) {
      stats.sumSquares += value * value
      stats.sampleCount += 1
      stats.peak = Math.max(stats.peak, Math.abs(value))
      if (Math.abs(value) >= 1) stats.clippedSamples += 1
    }
    return stats
  }

  compactSource() {
    const consumed = Math.max(0, Math.floor(this.position) - RESAMPLER_RADIUS)
    if (!consumed) return
    this.source.copyWithin(0, consumed, this.sourceLength)
    this.sourceLength -= consumed
    this.position -= consumed
  }

  appendInput(input) {
    this.compactSource()
    const required = this.sourceLength + input.length
    if (required > this.source.length) {
      const next = new Float32Array(Math.max(required, this.source.length * 2))
      next.set(this.source.subarray(0, this.sourceLength))
      this.source = next
    }
    this.source.set(input, this.sourceLength)
    this.sourceLength = required
    this.inputSampleCount += input.length
  }

  resample(flush = false) {
    const availableSamples = this.sourceLength
    const limit = flush ? availableSamples : Math.max(0, availableSamples - RESAMPLER_RADIUS)
    const targetSamples = Math.round(this.inputSampleCount / this.ratio)
    while (this.position < limit && (!flush || this.outputSampleCount < targetSamples)) {
      const center = Math.floor(this.position)
      const phase = Math.min(RESAMPLER_PHASE_COUNT - 1, Math.round((this.position - center) * (RESAMPLER_PHASE_COUNT - 1)))
      const kernel = this.phaseKernels[phase]
      let value = 0
      let weights = 0
      for (let offset = -RESAMPLER_RADIUS; offset <= RESAMPLER_RADIUS; offset += 1) {
        const index = center + offset
        if (index < 0 || index >= availableSamples) continue
        const weight = kernel[offset + RESAMPLER_RADIUS]
        value += this.source[index] * weight
        weights += weight
      }
      if (weights) value /= weights
      const bounded = Math.max(-1, Math.min(1, value))
      this.appendProcessedSample(bounded, Math.abs(value) >= 1)
      this.position += this.ratio
    }
    if (flush) {
      this.sourceLength = 0
      this.position = 0
      this.inputSampleCount = 0
      this.outputSampleCount = 0
    }
  }

  resampleIdentity(input) {
    this.inputSampleCount += input.length
    for (const value of input) this.appendProcessedSample(Math.max(-1, Math.min(1, value)), Math.abs(value) >= 1)
  }

  takePacketBuffer() {
    const buffer = this.returnedBuffers.pop()
    return buffer && buffer.byteLength === PACKET_BYTES ? new Int16Array(buffer) : new Int16Array(PACKET_SAMPLES)
  }

  returnBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== PACKET_BYTES) return
    if (this.returnedBuffers.length < MAX_RETURNED_BUFFERS) this.returnedBuffers.push(buffer)
  }

  appendProcessedSample(value, clipped) {
    this.packetBuffer[this.packetOffset] = value < 0 ? value * 0x8000 : value * 0x7fff
    this.packetOffset += 1
    this.packetProcessed.sumSquares += value * value
    this.packetProcessed.sampleCount += 1
    this.packetProcessed.peak = Math.max(this.packetProcessed.peak, Math.abs(value))
    if (clipped) this.packetProcessed.clippedSamples += 1
    this.outputSampleCount += 1
    if (this.packetOffset === PACKET_SAMPLES) this.postPcm()
  }

  postPcm() {
    if (!this.packetOffset) return
    const sampleCount = this.packetOffset
    const raw = serializeSignalStats(this.packetRaw)
    const processed = serializeSignalStats(this.packetProcessed)
    const fullPacket = sampleCount === PACKET_SAMPLES
    const buffer = fullPacket ? this.packetBuffer.buffer : this.packetBuffer.slice(0, sampleCount).buffer
    this.port.postMessage({
      type: "pcm",
      buffer,
      rms: processed.rms,
      peak: processed.peak,
      sampleCount,
      rawRms: raw.rms,
      rawPeak: raw.peak,
      rawSampleCount: this.packetRaw.sampleCount,
      rawClipped: this.packetRaw.clippedSamples > 0,
      rawClippedSamples: this.packetRaw.clippedSamples,
      clipped: this.packetProcessed.clippedSamples > 0,
      clippedSamples: this.packetProcessed.clippedSamples,
      gain: 1,
      resampler: {
        method: this.ratio === 1 ? "native-16khz" : "windowed-sinc-fir",
        inputSampleRate: sampleRate,
        outputSampleRate: TARGET_SAMPLE_RATE,
      },
    }, [buffer])
    if (fullPacket) this.packetBuffer = this.takePacketBuffer()
    this.packetOffset = 0
    this.packetRaw = emptySignalStats()
    this.packetProcessed = emptySignalStats()
  }

  flush() {
    if (this.sourceLength) this.resample(true)
    else {
      this.inputSampleCount = 0
      this.outputSampleCount = 0
    }
    this.postPcm()
    this.port.postMessage({ type: "flush_complete" })
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input?.length) return true
    this.trackSignal(input)
    const raw = this.signalStats(input)
    this.packetRaw.sumSquares += raw.sumSquares
    this.packetRaw.sampleCount += raw.sampleCount
    this.packetRaw.peak = Math.max(this.packetRaw.peak, raw.peak)
    this.packetRaw.clippedSamples += raw.clippedSamples
    if (this.ratio === 1) this.resampleIdentity(input)
    else {
      this.appendInput(input)
      this.resample()
    }
    return true
  }
}

registerProcessor("conduit-voice-capture", ConduitVoiceCaptureProcessor)
