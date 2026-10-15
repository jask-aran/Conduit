/*
 * The gallery never opens the real microphone. getUserMedia hands back a
 * synthetic voice -- a tone whose loudness wanders like speech -- so the mic
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
    const timer = setInterval(() => level.gain.setTargetAtTime(silentTake ? 0 : Math.random() < 0.25 ? 0.02 : 0.2 + Math.random() * 0.6, context.currentTime, 0.05), 120);
    const track = out.stream.getAudioTracks()[0]!;
    const stop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stop(); void context.close(); };
    return out.stream;
  };
  devices.enumerateDevices = async () => [{ deviceId: "gallery", groupId: "gallery", kind: "audioinput", label: "Gallery microphone (fake)", toJSON() { return this; } } as MediaDeviceInfo];
}
