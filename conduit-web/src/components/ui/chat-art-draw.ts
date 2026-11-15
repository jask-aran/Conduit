// Apart from chat-art.ts so the shader loads with the first chat pane that has art, not with the app.
import type { ChatArtLook } from "./chat-art";

const vertex = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// The dither is drawn on the screen's own pixels, never the image's: a dot is a whole number of device pixels at any
// window size. The image stays smooth under it; a dot is the colour beneath, its hue kept, moved to the next of a few lightness levels.
const fragment = `#version 300 es
precision highp float;
uniform sampler2D art;
uniform vec2 view, artSize;
uniform float grain, levels, strength, brightness, fade, waves, time;
out vec4 colour;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer8(vec2 a) { return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec2 cell = floor(vec2(gl_FragCoord.x, view.y - gl_FragCoord.y) / grain);
  if (waves > 0.5) {
    // A slow field of crossing waves, cut to four tones by the same ordered pattern the pictures are dithered with.
    vec2 p = cell * grain / view.y, q = p * 2.2 + 0.45 * vec2(sin(p.y * 2.6 + time * 0.2), cos(p.x * 2.1 - time * 0.16));
    float field = sin(q.x * 1.9 + time * 0.12) + sin(q.y * 2.7 - time * 0.1) + sin((q.x + q.y) * 1.3 + time * 0.07) + sin(length(q - vec2(1.6, 0.9)) * 3.1 - time * 0.17);
    float tone = min(3.0, floor(clamp(field * 0.125 + 0.5, 0.0, 1.0) * 3.0 + bayer8(cell)));
    vec3 ink = tone < 0.5 ? vec3(0.02, 0.03, 0.07) : tone < 1.5 ? vec3(0.07, 0.13, 0.3) : tone < 2.5 ? vec3(0.2, 0.36, 0.66) : vec3(0.72, 0.84, 0.97);
    colour = vec4(ink * brightness, 1.0);
    return;
  }
  vec2 at = (cell + 0.5) * grain;
  float cover = max(view.x / artSize.x, view.y / artSize.y);
  vec2 uv = ((at - view * 0.5) / cover + artSize * 0.5) / artSize;
  vec3 c = textureLod(art, uv, log2(max(1.0, grain / cover))).rgb;
  if (levels > 0.0) {
    float light = max(dot(c, vec3(0.299, 0.587, 0.114)), 0.004);
    // Under 3% lightness is black: lifting it to the first level would turn the file's own noise into coloured specks.
    float stepped = floor(max(0.0, light - 0.03) / 0.97 * levels + bayer8(cell)) / levels;
    c = mix(c, min(vec3(1.0), c * stepped / light), strength);
  }
  c *= brightness;
  c *= 1.0 - fade * smoothstep(0.25, 1.0, (view.y - gl_FragCoord.y) / view.y);
  colour = vec4(c, 1.0);
}`;

type Slice = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
const slices = new Map<HTMLElement, Slice>();
const stage = document.createElement("canvas");
const gl = stage.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true });
// Without WebGL 2, or once the browser takes it back, the stage is the image drawn plain.
const flat = gl ? null : stage.getContext("2d");
let look: ChatArtLook | null = null, picture: HTMLImageElement | undefined, lost = false, uniform = (_: string): WebGLUniformLocation | null => null;
const plain = document.createElement("canvas");

if (gl) {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, "corner");
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  uniform = (name) => gl.getUniformLocation(program, name);
  stage.addEventListener("webglcontextlost", () => { lost = true; paint(); });
}

// A scene drawn by an engine of its own (ASCII on a 2D canvas): the engine keeps a window-sized canvas nobody sees,
// and the panes are cut from that.
type Engine = { destroy(): void };
let host: HTMLCanvasElement | undefined, engine: Engine | undefined, frame = 0;
function cast(scene: ChatArtLook["scene"]) {
  engine?.destroy(); host?.remove(); engine = host = undefined;
  if (scene !== "sharks" && scene !== "spiders") return;
  const canvas = host = document.createElement("canvas");
  canvas.className = "ui-chat-art-host";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  void (scene === "sharks"
    ? import("../../../vendor/ascii-sharks/index").then(({ OceanEngine }) => new OceanEngine(canvas) as Engine)
    : import("../../../vendor/ascii-spiders/index").then(({ SpiderEngine }) => new SpiderEngine(canvas, undefined, { theme: "dark", pointer: false, clearCentre: true }) as Engine)
  ).then((made) => { if (host === canvas) engine = made; else made.destroy(); });
}

// The picture is fitted to the app window and stays put: a pane is drawn the part it stands over, device pixel for
// device pixel, so panes moving or a sidebar opening never move it.
let drawn: unknown[] = [];
function paint() {
  if (!look || !slices.size || !(look.scene || picture)) return;
  const rects = [...slices].map(([pane, slice]) => ({ slice, rect: pane.getBoundingClientRect() })).filter(({ rect }) => rect.width && rect.height);
  const width = Math.round(innerWidth * devicePixelRatio), height = Math.round(innerHeight * devicePixelRatio);
  const now = [look, picture, width, height, lost];
  const fresh = Boolean(look.scene) || now.some((value, index) => value !== drawn[index]);
  drawn = now;
  let from: HTMLCanvasElement = stage;
  if (host) { if (!engine || !host.width) return; from = host; }
  else if (!fresh) from = gl && !lost || flat ? stage : plain;
  else if (gl && !lost) {
    if (stage.width !== width || stage.height !== height) { stage.width = width; stage.height = height; }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uniform("view"), width, height);
    gl.uniform2f(uniform("artSize"), picture?.naturalWidth ?? 1, picture?.naturalHeight ?? 1);
    gl.uniform1f(uniform("grain"), Math.max(1, Math.round(look.dot)));
    gl.uniform1f(uniform("levels"), look.dither ? look.levels : 0);
    gl.uniform1f(uniform("strength"), look.strength);
    gl.uniform1f(uniform("brightness"), look.brightness);
    gl.uniform1f(uniform("fade"), look.fade);
    gl.uniform1f(uniform("waves"), look.scene === "waves" ? 1 : 0);
    gl.uniform1f(uniform("time"), performance.now() / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else if (picture) {
    from = flat ? stage : plain;
    const context = flat ?? plain.getContext("2d")!;
    from.width = width; from.height = height;
    const cover = Math.max(width / picture.naturalWidth, height / picture.naturalHeight);
    context.drawImage(picture, (width - picture.naturalWidth * cover) / 2, (height - picture.naturalHeight * cover) / 2, picture.naturalWidth * cover, picture.naturalHeight * cover);
    context.fillStyle = `rgb(0 0 0 / ${1 - look.brightness})`;
    context.fillRect(0, 0, width, height);
  } else return;
  // An engine sizes its own canvas (it stops at two device pixels a pixel), so the cut is scaled to whatever it made.
  const across = from.width / innerWidth, down = from.height / innerHeight;
  for (const { slice, rect } of rects) {
    const wide = Math.round(rect.width * devicePixelRatio), tall = Math.round(rect.height * devicePixelRatio);
    if (slice.canvas.width !== wide || slice.canvas.height !== tall) { slice.canvas.width = wide; slice.canvas.height = tall; }
    slice.canvas.style.opacity = host ? String(look.brightness) : "";
    slice.context.drawImage(from, Math.round(rect.left * across), Math.round(rect.top * down), Math.round(rect.width * across), Math.round(rect.height * down), 0, 0, wide, tall);
  }
}
// A scene is drawn again every frame; a picture only when something changes.
const run = () => { cancelAnimationFrame(frame); if (look?.scene) { const tick = () => { paint(); frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick); } };

// Drawn in the observer's own task, so a pane easing to a new width never shows a stretched frame.
const observer = new ResizeObserver(paint);
addEventListener("resize", paint);
// A pane that slid into place has moved without changing size.
for (const settled of ["transitionend", "animationend"]) addEventListener(settled, (event) => { if (event.target instanceof Element && [...slices.keys()].some((pane) => event.target === pane || (event.target as Element).contains(pane))) paint(); });

/** Draws `next` in every pane of `panes`, and takes it out of every other. */
export function syncArt(next: ChatArtLook | null, panes: Set<HTMLElement>) {
  for (const [pane, slice] of slices) if (!next || !panes.has(pane)) { observer.unobserve(pane); slice.canvas.remove(); pane.removeAttribute("data-art-window"); slices.delete(pane); }
  const changed = next?.image !== look?.image, recast = next?.scene !== look?.scene;
  look = next;
  if (recast) cast(next?.scene);
  run();
  if (!next) return;
  for (const pane of panes) if (!slices.has(pane)) {
    const canvas = document.createElement("canvas");
    canvas.className = "ui-chat-art";
    canvas.setAttribute("aria-hidden", "true");
    slices.set(pane, { canvas, context: canvas.getContext("2d", { alpha: false })! });
    pane.prepend(canvas);
    pane.setAttribute("data-art-window", "");
    observer.observe(pane);
  }
  if (!changed || next.scene) return paint();
  const image = new Image();
  image.src = next.image;
  void image.decode().then(() => {
    if (look?.image !== next.image) return;
    picture = image;
    if (gl && !lost) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); gl.generateMipmap(gl.TEXTURE_2D); }
    paint();
  }).catch(() => {});
}
