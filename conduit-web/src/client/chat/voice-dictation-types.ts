export interface VoiceDictationSettings {
  shortcut: string;
  activation: "push_to_talk" | "toggle";
  autoSend: boolean;
  inputDeviceId: string;
  captureProfile: "raw" | "processed";
  warmMicrophone: boolean;
}
