/*
 * A picture of this window as it is drawn (the feedback tool's screenshot): the webview's own display capture, so
 * fonts, formulas and frost are the pixels on screen, not a second rendering of the document. The system asks which
 * window the first time; the stream is kept until the page goes, so later captures ask nothing.
 */
let stream: MediaStream | null = null;
/** After the tool hides its own bar, the compositor's next frames reach the stream. */
const SETTLE_MS = 250;

export type Capture = { blob: Blob; width: number; height: number; surface: string };

export async function captureScreen(): Promise<Capture> {
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
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  video.srcObject = null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || !canvas.width) throw new Error("The capture came back empty");
  return { blob, width: canvas.width, height: canvas.height, surface: String(track.getSettings().displaySurface ?? "unknown") };
}

export function endCapture() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}
