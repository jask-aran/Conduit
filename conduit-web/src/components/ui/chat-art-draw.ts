// Apart from chat-art.ts so the shader loads with the first chat pane that has art, not with the app.
import { waveColours, type ChatArtLook } from "./chat-art";

const vertex = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// The dither is drawn on the screen's own pixels, never the image's: a dot is a whole number of device pixels at any
// window size. The image stays smooth under it; a dot is the colour beneath, its hue kept, moved to the next of a few lightness levels.
const fragment = `#version 300 es
precision highp float;
uniform sampler2D art;
uniform vec2 view, artSize, renderScale;
uniform vec3 waveTint;
uniform float grain, levels, strength, brightness, fade, waves, time;
out vec4 colour;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer8(vec2 a) { return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec2 pixel = gl_FragCoord.xy * renderScale;
  vec2 cell = floor(vec2(pixel.x, view.y - pixel.y) / grain);
  if (waves > 0.5) {
    // A slow field of crossing waves, cut to four tones by the same ordered pattern the pictures are dithered with.
    vec2 p = cell * grain / view.y, q = p * 2.2 + 0.45 * vec2(sin(p.y * 2.6 + time * 0.2), cos(p.x * 2.1 - time * 0.16));
    float field = sin(q.x * 1.9 + time * 0.12) + sin(q.y * 2.7 - time * 0.1) + sin((q.x + q.y) * 1.3 + time * 0.07) + sin(length(q - vec2(1.6, 0.9)) * 3.1 - time * 0.17);
    float tone = min(3.0, floor(clamp(field * 0.125 + 0.5, 0.0, 1.0) * 3.0 + bayer8(cell)));
    vec3 ink = tone < 0.5 ? vec3(0.02, 0.03, 0.07) : tone < 1.5 ? vec3(0.07, 0.13, 0.3) : tone < 2.5 ? vec3(0.2, 0.36, 0.66) : vec3(0.72, 0.84, 0.97);
    float light = dot(ink, vec3(0.299, 0.587, 0.114));
    colour = vec4(mix(ink, light * waveTint, step(0.0, waveTint.r)) * brightness, 1.0);
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
  c *= 1.0 - fade * smoothstep(0.25, 1.0, (view.y - pixel.y) / view.y);
  colour = vec4(c, 1.0);
}`;

type Slice = { window: HTMLDivElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; drawn: number };
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
  const locations = new Map<string, WebGLUniformLocation | null>();
  uniform = (name) => { if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name)); return locations.get(name) ?? null; };
  stage.addEventListener("webglcontextlost", () => { lost = true; paint(); });
}

// A scene drawn by an engine of its own (ASCII on a 2D canvas): the engine keeps a window-sized canvas nobody sees,
// and the panes are cut from that.
type Engine = { destroy(): void };
let host: HTMLCanvasElement | undefined, engine: Engine | undefined, frame = 0;
function cast(scene: ChatArtLook["scene"]) {
  engine?.destroy(); host?.remove(); engine = host = undefined;
  if (scene !== "sharks" && scene !== "spiders" && scene !== "stacked-dither") return;
  const art = look;
  if (!art) return;
  const canvas = host = document.createElement("canvas");
  canvas.className = "ui-chat-art-host";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  void (scene === "stacked-dither"
    ? import("../../../vendor/stacked-dither/index").then(({ DitherEngine }) => new DitherEngine(canvas, { palette: art.palette, speed: art.speed, cell: art.cell, well: art.well }))
    : scene === "sharks"
    ? import("../../../vendor/ascii-sharks/index").then(({ OceanEngine }) => new OceanEngine(canvas, Array.from({ length: art.sharks }, (_, index) => ({ kind: "classic", size: 1 - index / Math.max(art.sharks, 1) * 0.5 }))) as Engine)
    : import("../../../vendor/ascii-spiders/index").then(({ SpiderEngine }) => new SpiderEngine(canvas, undefined, { theme: "dark", pointer: false, clearCentre: true, webs: art.webs, flies: art.flies, jumper: art.jumper }) as Engine)
  ).then((made) => { if (host === canvas) engine = made; else made.destroy(); });
}

// The picture is fitted to the app window and stays put: a pane is drawn the part it stands over, device pixel for
// device pixel, so panes moving or a sidebar opening never move it.
let drawn: unknown[] = [], revision = 0;
const tints = [[-1, 0, 0], [1.35, 0.65, 1.8], [0.5, 1.35, 0.8], [1.8, 1.05, 0.3], [1.8, 0.65, 0.95], [1, 1, 1]];
function paint(sceneFrame = true) {
  if (!look || !slices.size || !(look.scene || picture)) return;
  const rects = [...slices].filter(([pane]) => !pane.closest('[aria-hidden="true"], .ui-tool-kept:not([data-shown])'))
    .map(([pane, slice]) => ({ slice, rect: pane.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width && rect.height && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight);
  if (!rects.length) return;
  const width = Math.round(innerWidth * devicePixelRatio), height = Math.round(innerHeight * devicePixelRatio);
  const now = [look, picture, width, height, lost];
  const fresh = Boolean(look.scene && sceneFrame) || now.some((value, index) => value !== drawn[index]);
  drawn = now;
  let from: HTMLCanvasElement = stage;
  if (host) { if (!engine || !host.width) return; from = host; }
  else if (!fresh) from = gl && !lost || flat ? stage : plain;
  else if (gl && !lost) {
    const grain = Math.max(1, Math.round(look.scene === "waves" ? look.cell : look.dot));
    const scale = look.scene === "waves" ? grain : 1;
    const wide = Math.ceil(width / scale), tall = Math.ceil(height / scale);
    if (stage.width !== wide || stage.height !== tall) { stage.width = wide; stage.height = tall; }
    gl.viewport(0, 0, wide, tall);
    gl.uniform2f(uniform("renderScale"), width / wide, height / tall);
    gl.uniform2f(uniform("view"), width, height);
    gl.uniform2f(uniform("artSize"), picture?.naturalWidth ?? 1, picture?.naturalHeight ?? 1);
    gl.uniform1f(uniform("grain"), grain);
    gl.uniform1f(uniform("levels"), look.dither ? look.levels : 0);
    gl.uniform1f(uniform("strength"), look.strength);
    gl.uniform1f(uniform("brightness"), look.brightness);
    gl.uniform1f(uniform("fade"), look.fade);
    gl.uniform1f(uniform("waves"), look.scene === "waves" ? 1 : 0);
    gl.uniform3fv(uniform("waveTint"), tints[waveColours.indexOf(look.waveColour)] ?? tints[0]!);
    gl.uniform1f(uniform("time"), performance.now() / 1000 * look.speed);
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
  if (fresh) revision++;
  for (const { slice, rect } of rects) {
    const { canvas, context } = slice;
    if (canvas.width !== from.width || canvas.height !== from.height) { canvas.width = from.width; canvas.height = from.height; slice.drawn = -1; }
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    canvas.style.transform = `translate3d(${-rect.left}px, ${-rect.top}px, 0)`;
    canvas.style.opacity = host ? String(look.brightness) : "";
    canvas.style.imageRendering = look.scene === "stacked-dither" || look.scene === "waves" ? "pixelated" : "auto";
    if (slice.drawn === revision) continue;
    context.drawImage(from, 0, 0);
    slice.drawn = revision;
  }
}
// Pictures reuse the rendered stage while panes move; only scenes redraw the shader each frame.
const motion = new Set<Animation>();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const run = () => {
  cancelAnimationFrame(frame);
  if (!look || !slices.size || document.hidden) return;
  const tick = () => {
    paint();
    for (const animation of motion) if (animation.playState !== "running" && !animation.pending) motion.delete(animation);
    if ((look?.scene && !reducedMotion.matches) || motion.size) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
};
reducedMotion.addEventListener("change", run);
document.addEventListener("visibilitychange", run);
const observer = new ResizeObserver(() => paint(false));
addEventListener("resize", () => paint(false));
const movingPane = (element: Element) => [...slices.keys()].some((pane) => element === pane || element.contains(pane));
for (const started of ["transitionrun", "animationstart"]) addEventListener(started, (event) => {
  if (!(event.target instanceof Element) || !movingPane(event.target)) return;
  for (const animation of event.target.getAnimations()) motion.add(animation);
  run();
});
for (const settled of ["transitionend", "transitioncancel", "animationend", "animationcancel"]) addEventListener(settled, (event) => {
  if (event.target instanceof Element && movingPane(event.target)) run();
});
// Dragging the mobile drawer changes its transform through shell attributes, without a resize or transition.
const drawerObserver = new MutationObserver(run);
let drawer: Element | null = null;

/** Draws `next` in every pane of `panes`, and takes it out of every other. */
export function syncArt(next: ChatArtLook | null, panes: Set<HTMLElement>) {
  for (const [pane, slice] of slices) if (!next || !panes.has(pane)) { observer.unobserve(pane); slice.window.remove(); pane.removeAttribute("data-art-window"); slices.delete(pane); }
  const settings = (art: ChatArtLook | null) => art ? JSON.stringify([art.scene, art.speed, art.cell, art.palette, art.well, art.sharks, art.webs, art.flies, art.jumper]) : "";
  const changed = next?.image !== look?.image, recast = settings(next) !== settings(look);
  look = next;
  if (recast) cast(next?.scene);
  const shell = document.querySelector(".ui-shell");
  if (shell !== drawer) { drawerObserver.disconnect(); drawer = shell; if (shell) drawerObserver.observe(shell, { attributes: true, attributeFilter: ["style", "data-drawer", "data-drawer-drag", "data-drawer-settle"] }); }
  if (!next) { run(); return; }
  for (const pane of panes) if (!slices.has(pane)) {
    const canvas = document.createElement("canvas");
    const window = document.createElement("div");
    window.className = "ui-sheet-backdrop ui-chat-art";
    canvas.setAttribute("aria-hidden", "true");
    window.append(canvas);
    slices.set(pane, { window, canvas, context: canvas.getContext("2d", { alpha: false })!, drawn: -1 });
    pane.prepend(window);
    pane.setAttribute("data-art-window", "");
    observer.observe(pane);
  }
  run();
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
