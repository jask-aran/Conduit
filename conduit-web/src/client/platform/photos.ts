import { Capacitor, registerPlugin } from "@capacitor/core";

const nativePhotos = registerPlugin<{
  pick(options: { max: number }): Promise<{
    files: { path: string; name: string; mimeType: string; size: number }[];
  }>;
}>("ConduitPhotos");

/** Null when the caller must use a file input instead. */
export async function pickPhotos(max = 10): Promise<File[] | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("ConduitPhotos")) return null;
  const { files } = await nativePhotos.pick({ max });
  return Promise.all(files.map(async ({ path, name, mimeType }) => {
    const response = await fetch(Capacitor.convertFileSrc(path));
    if (!response.ok) throw new Error("Could not read selected photo");
    const blob = await response.blob();
    return new File([blob], name, { type: mimeType });
  }));
}
