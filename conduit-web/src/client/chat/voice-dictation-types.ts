export interface VoiceDictationSettings {
  shortcut: string;
  activation: "push_to_talk" | "toggle";
  autoSend: boolean;
  inputDeviceId: string;
  /** The chosen microphone's name: Android hands out new ids, so the id alone is lost. */
  inputDeviceLabel?: string;
  preferSpeakerphone: boolean;
  speakerphoneId: string;
  otherAudio: "keep" | "lower" | "mute";
  otherAudioLevel: number;
  captureProfile: "raw" | "processed";
  warmMicrophone: boolean;
  /** Dictate through the Hex on this computer when it is running, so audio stays here. */
  useHex: boolean;
}
