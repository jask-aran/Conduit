export type VoiceDictationSettingsV2 = {
  shortcut: string;
  activation: "push_to_talk" | "toggle";
  autoSend: boolean;
  inputDeviceId: string;
  captureProfile: "raw" | "processed";
  warmMicrophone: boolean;
};

export function normalizeVoiceDictationSettings(settings: Partial<VoiceDictationSettingsV2> | null | undefined): VoiceDictationSettingsV2 {
  return {
    shortcut: settings?.shortcut || "Ctrl+Shift+D",
    activation: settings?.activation === "toggle" ? "toggle" : "push_to_talk",
    autoSend: settings?.autoSend === true,
    inputDeviceId: settings?.inputDeviceId || "",
    captureProfile: settings?.captureProfile === "processed" ? "processed" : "raw",
    warmMicrophone: settings?.warmMicrophone === true,
  };
}
