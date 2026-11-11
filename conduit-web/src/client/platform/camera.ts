import { Capacitor, registerPlugin } from "@capacitor/core";
import { hapticSteps } from "@/components/ui/haptics";

type Picked = { path: string; name: string; mimeType: string; size: number };
const nativeCamera = registerPlugin<{
  open(options: { press: { steps: unknown[]; weight: string } | null }): Promise<{ file?: Picked; full?: boolean; failed?: boolean }>;
}>("ConduitCamera");

/**
 * Drawn natively so the picture is the camera pipeline's, not the WebView's. "full" means hand over to the platform's
 * camera app; null means use the page's Viewfinder.
 */
export async function openNativeCamera(): Promise<File | "full" | "failed" | "closed" | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("ConduitCamera")) return null;
  const answer = await nativeCamera.open({ press: hapticSteps("press") });
  if (answer.full) return "full";
  if (answer.failed) return "failed";
  if (!answer.file) return "closed";
  const response = await fetch(Capacitor.convertFileSrc(answer.file.path));
  if (!response.ok) return "failed";
  return new File([await response.blob()], answer.file.name, { type: answer.file.mimeType });
}
