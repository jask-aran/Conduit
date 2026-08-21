import type { AudioSignalLevel } from "./voice-audio";
import { loadVoiceDictationSettings } from "./voice-dictation";
import { normalizeVoiceDictationSettings } from "./voice-settings-compat";
import {
  createVoiceDictationClient as createCurrentVoiceDictationClient,
  isWarmMicrophoneActive,
  preloadVoiceCaptureWorklet,
  stopWarmMicrophone,
  type VoiceDictationCompletion,
  type VoiceDictationState as CurrentVoiceDictationState,
} from "./voice-dictation-client-main";

export type VoiceDictationState = "idle" | "connecting" | "active" | "stopping" | "completed" | "failed";
export type { VoiceDictationCompletion };
export { isWarmMicrophoneActive, preloadVoiceCaptureWorklet, stopWarmMicrophone };

interface VoiceDictationCallbacks {
  onState: (state: VoiceDictationState) => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onCompleted: (completion: VoiceDictationCompletion) => void;
  onInputLevel?: (level: AudioSignalLevel) => void;
  onError: (error: Error) => void;
}

interface VoiceDictationOptions {
  getInputDeviceId?: () => string;
}

const displayState = (state: CurrentVoiceDictationState): VoiceDictationState => {
  if (state === "starting") return "connecting";
  if (state === "listening") return "active";
  if (state === "finishing" || state === "waiting" || state === "transcribing") return "stopping";
  return state;
};

// Keep the rebuild's compact composer status contract while using the complete
// current-main capture/transcription implementation underneath it.
export function createVoiceDictationClient(callbacks: VoiceDictationCallbacks, options: VoiceDictationOptions = {}) {
  const current = createCurrentVoiceDictationClient({
    onState: (state) => callbacks.onState(displayState(state)),
    onPartial: callbacks.onPartial,
    onFinal: callbacks.onFinal,
    onCompleted: callbacks.onCompleted,
    onInputLevel: callbacks.onInputLevel,
    onError: callbacks.onError,
  }, {
    getInputDeviceId: options.getInputDeviceId,
    getCaptureProfile: () => normalizeVoiceDictationSettings(loadVoiceDictationSettings()).captureProfile,
    getWarmMicrophone: () => normalizeVoiceDictationSettings(loadVoiceDictationSettings()).warmMicrophone,
  });

  return {
    start: current.start,
    stop: current.stop,
    dispose: current.dispose,
    state: () => displayState(current.state()),
  };
}

// Current main preloads this from App.onMount. The performance shell deliberately
// does not need to know about Voice internals, so preload at this subsystem seam.
if (typeof window !== "undefined") queueMicrotask(() => { void preloadVoiceCaptureWorklet().catch(() => undefined); });
