/*
 * The gallery never opens the real microphone. getUserMedia hands back a
 * synthetic voice -- a tone whose loudness comes and goes like speech -- so the mic
 * button's listening state, waveform and glow all run with nothing recorded.
 * Every second take is silence -- a flat line, and no words (fake-socket.ts
 * reads silentTake) -- so a stop with nothing said is seen too.
 */
let takes = 0;
export let silentTake = false;
export function fakeMicrophone() {
  const devices = navigator.mediaDevices;
  if (!devices) return;
  devices.getUserMedia = async () => {
    silentTake = takes++ % 2 === 1;
    const context = new AudioContext();
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.frequency.value = 180;
    level.gain.value = 0;
    tone.connect(level);
    const out = context.createMediaStreamDestination();
    level.connect(out);
    tone.start();
    // Speech-sized: words of a few syllables, mostly soft with the odd stress, and pauses between them (the
    // waveform's gain draws a level of 0.05 at full height, so louder only clips every bar).
    let left = 0;
    const timer = setInterval(() => {
      const pause = left-- <= 0 && Math.random() < 0.45;
      if (left < 0) left = 2 + Math.floor(Math.random() * 5);
      const loud = silentTake || pause ? 0.0004 : 0.004 + Math.random() * (Math.random() < 0.15 ? 0.03 : 0.016);
      level.gain.setTargetAtTime(silentTake ? 0 : loud, context.currentTime, 0.04);
    }, 110);
    const track = out.stream.getAudioTracks()[0]!;
    const stop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stop(); void context.close(); };
    return out.stream;
  };
  devices.enumerateDevices = async () => [{ deviceId: "gallery", groupId: "gallery", kind: "audioinput", label: "Gallery microphone (fake)", toJSON() { return this; } } as MediaDeviceInfo];
}
