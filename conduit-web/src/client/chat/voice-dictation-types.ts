export interface VoiceDictationSettings {
  shortcut: string;
  activation: "push_to_talk" | "toggle";
  autoSend: boolean;
  inputDeviceId: string;
  /** The chosen microphone's name: Android hands out new ids, so the id alone is lost. */
  inputDeviceLabel?: string;
  captureProfile: "raw" | "processed";
  warmMicrophone: boolean;
}
