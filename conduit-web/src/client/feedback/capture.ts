/*
 * The pixels on screen, not a second rendering of the document. The desktop shell takes it itself (capture_page);
 * elsewhere it is the webview's display capture, whose stream is kept until the tool closes.
 */
import { installedClientKind } from "../platform/installed-client";

let stream: MediaStream | null = null;
/** After the tool hides its own bar, the compositor's next frames reach the stream. */
const SETTLE_MS = 250;

export type Capture = { blob: Blob; width: number; height: number; surface: string };

const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

async function capturePage(): Promise<Capture | null> {
  if (installedClientKind !== "desktop") return null;
  await settled();
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer>("capture_page").catch(() => null);
  if (!bytes?.byteLength) return null;
  const blob = new Blob([bytes], { type: "image/png" });
  const image = await createImageBitmap(blob);
  return { blob, width: image.width, height: image.height, surface: "webview" };
}

export async function captureScreen(): Promise<Capture> {
  const page = await capturePage();
  if (page) return page;
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This client cannot capture its display");
  if (!stream?.getVideoTracks().some((track) => track.readyState === "live")) {
    // preferCurrentTab: a browser offers this tab alone; a webview has no tab and offers its windows.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "window" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
  }
  const track = stream.getVideoTracks()[0]!;
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  await settled();
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  video.srcObject = null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || !canvas.width) throw new Error("The capture came back empty");
  return { blob, width: canvas.width, height: canvas.height, surface: String(track.getSettings().displaySurface ?? "unknown") };
}

type Area = { left: number; top: number; width: number; height: number };
/** Each area of the page (CSS px) cut from a capture, when the capture is the page alone (it has the page's shape); else none. */
export async function cropAreas(capture: Capture, areas: Area[]): Promise<(Blob | null)[]> {
  if (Math.abs(capture.width / capture.height - innerWidth / innerHeight) >= 0.01) return [];
  const scale = capture.width / innerWidth;
  const image = await createImageBitmap(capture.blob);
  return Promise.all(areas.map((area) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(area.width * scale));
    canvas.height = Math.max(1, Math.round(area.height * scale));
    canvas.getContext("2d")!.drawImage(image, Math.round(area.left * scale), Math.round(area.top * scale), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }));
}

export function endCapture() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}
