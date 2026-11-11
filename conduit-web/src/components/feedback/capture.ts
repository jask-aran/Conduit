/*
 * The pixels on screen, not a second rendering of the document. A shell that can take the page's picture itself does
 * (the host's capturePage); elsewhere it is the webview's display capture, asked for when a screenshot is first wanted:
 * its stream is kept while the page lives, so from then on one is taken with nothing asked.
 */

let stream: MediaStream | null = null;
/** After the tool hides its own bar, the compositor's next frames reach the stream. */
const SETTLE_MS = 250;

const live = () => Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));
/** Whether display capture was already granted on this page, so a screenshot now asks nothing. */
export const captureHeld = live;
/** Every pixel of the window: a stream left to itself may come at less. */
const whole = () => ({ width: { ideal: Math.round(innerWidth * devicePixelRatio) }, height: { ideal: Math.round(innerHeight * devicePixelRatio) } });

export type Capture = { blob: Blob; width: number; height: number; surface: string };

const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

/** `settle`: wait for the tool's own drawing to leave the shell's picture; not needed when nothing of it was up. */
export async function captureScreen(capturePage?: () => Promise<Blob | null>, settle = true): Promise<Capture> {
  if (capturePage) {
    if (settle) await settled();
    const blob = await capturePage().catch(() => null);
    if (blob?.size) { const image = await createImageBitmap(blob); return { blob, width: image.width, height: image.height, surface: "webview" }; }
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This client cannot capture its display");
  if (!live()) {
    // preferCurrentTab: a browser offers this tab alone; a webview has no tab and offers its windows.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "window", ...whole() }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
  }
  const track = stream!.getVideoTracks()[0]!;
  // The window may have been resized since the stream was granted.
  await track.applyConstraints(whole()).catch(() => {});
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream!;
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
/** A capture is the page alone when it has the page's shape; only then is a box on the page a box in it. */
const pageOnly = (capture: Capture) => Math.abs(capture.width / capture.height - innerWidth / innerHeight) < 0.01;
const cut = (image: ImageBitmap, area: Area, scale: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const context = canvas.getContext("2d")!;
  context.drawImage(image, Math.round(area.left * scale), Math.round(area.top * scale), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
};
const png = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

/** Each area of the page (CSS px) cut from a capture, when the capture is the page alone; else none. */
export async function cropAreas(capture: Capture, areas: (Area | null)[]): Promise<(Blob | null)[]> {
  if (!pageOnly(capture)) return [];
  const scale = capture.width / innerWidth;
  const image = await createImageBitmap(capture.blob);
  return Promise.all(areas.map((area) => area ? png(cut(image, area, scale).canvas) : null));
}

type Point = readonly [x: number, y: number];
/** `width` and `opacity`: its line as the layer draws it, where that is not the layer's own. */
export type Drawn = { kind: "pen" | "highlight" | "line" | "arrow" | "box" | "text"; points: readonly Point[]; text?: string; colour?: string; width?: number; opacity?: number };
/** An arrow's head is this many line widths long, as the layer draws it. */
const HEAD = 6;

/** An area of a capture with what was marked on it drawn in: the picture a note shows of its own comment. `look` is the layer's own line and type. */
export async function previewOf(capture: Capture, area: Area, marks: { outline?: Area; drawings: readonly Drawn[] }, look: { stroke: string; width: number; font: string }): Promise<Blob | null> {
  if (!pageOnly(capture)) return null;
  const scale = capture.width / innerWidth;
  const { canvas, context } = cut(await createImageBitmap(capture.blob), area, scale);
  context.setTransform(scale, 0, 0, scale, -area.left * scale, -area.top * scale);
  context.strokeStyle = context.fillStyle = look.stroke;
  context.lineWidth = look.width;
  context.lineCap = context.lineJoin = "round";
  context.font = look.font;
  context.textBaseline = "top";
  if (marks.outline) context.strokeRect(marks.outline.left, marks.outline.top, marks.outline.width, marks.outline.height);
  for (const drawing of marks.drawings) {
    context.strokeStyle = context.fillStyle = drawing.colour ?? look.stroke;
    context.lineWidth = drawing.width ?? look.width;
    context.globalAlpha = drawing.opacity ?? 1;
    context.lineCap = drawing.kind === "highlight" ? "butt" : "round";
    const from = drawing.points[0]!, to = drawing.points[drawing.points.length - 1]!;
    if (drawing.kind === "text") context.fillText(drawing.text ?? "", from[0], from[1]);
    else if (drawing.kind === "box") context.strokeRect(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    else {
      context.beginPath();
      context.moveTo(from[0], from[1]);
      for (const point of drawing.kind === "arrow" || drawing.kind === "line" ? [to] : drawing.points.slice(1)) context.lineTo(point[0], point[1]);
      context.stroke();
      if (drawing.kind === "arrow") {
        const angle = Math.atan2(to[1] - from[1], to[0] - from[0]), length = HEAD * context.lineWidth;
        context.beginPath();
        context.moveTo(to[0], to[1]);
        for (const turn of [-0.46, 0.46]) context.lineTo(to[0] - length * Math.cos(angle + turn), to[1] - length * Math.sin(angle + turn));
        context.fill();
      }
    }
  }
  return png(canvas);
}
