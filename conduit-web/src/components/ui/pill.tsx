import { Frost } from "./frost";
import { reducedMotion } from "./motion";
import { createSignal, For, mergeProps, onCleanup, onMount, Show, type JSX } from "solid-js";
import { cn } from "@/lib/utils";
import { haptic, type Haptic } from "./haptics";
import { Segmented, TextArea } from "./controls";

/*
 * Pill: the phone's floating frost controls, one family on shared tokens
 * (--pill-*). The kind decides the shape, never a prop:
 *   PillButton  one action: a circle (stretch: across its row, as the mic)
 *   PillGroup   several actions in one capsule, a pill-shaped target each
 *   PillSwitch  a group where one slot is chosen, under a sliding thumb
 *   PillField   a capsule holding text (the phone composer's field)
 *   PillWave    the voice, as bars on the page (a PhoneComposer's track)
 */
type PillAction = { label: string; icon: JSX.Element };
/** A pill's button: its label and icon, and the caller's own button attributes (a handler, disabled, a title). */
type PillAttrs = JSX.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
const pillSlot = (item: PillAction, onPick?: (label: string) => void, attrs?: PillAttrs) => <button type="button" aria-label={item.label} title={item.label} {...attrs}
  {...(onPick ? { onClick: (event: MouseEvent) => { event.stopPropagation(); onPick(item.label); } } : {})}>{item.icon}</button>;

/**
 * folded: a circle that comes and goes in its row (Send, Scroll to latest) folds to nothing, its gap with it, so a
 * stretched neighbour gives and takes the room. voice: one of the voice controls, which stay while a PhoneComposer
 * listens (Stop and send). aura: the mic -- listening, its pill fills with an Aura under its icon; stretched, it
 * shrinks to a short pill at the row's end. open: its menu is open, so it stays lit while its row dims (PhoneComposer under).
 */
/** haptic: a press that acts at once (the mic, Send, Stop) is felt on a phone (see haptics.ts). */
export function PillButton(props: PillAction & { stretch?: boolean; folded?: boolean; voice?: boolean; aura?: boolean; open?: boolean; haptic?: Haptic; onPick?: (label: string) => void; button?: PillAttrs }) {
  const mic = !!props.aura;
  // The caller's attributes stay live on the one button (merged lazily, so a change never rebuilds it).
  const attrs = mergeProps(() => ({ tabIndex: props.folded ? -1 : undefined }), () => props.button ?? {}, () => props.haptic ? {
    onClick: (event: MouseEvent) => { haptic(props.haptic!); const click = props.button?.onClick; if (typeof click === "function") (click as (event: MouseEvent) => void)(event); },
  } : {}) as PillAttrs;
  const pill = <Frost class="ui-pill" data-solo="" data-stretch={props.stretch ? "" : undefined} data-folded={props.folded ? "" : undefined} data-voice={props.voice || mic ? "" : undefined} data-open={props.open ? "" : undefined}
    aria-hidden={props.folded ? "true" : undefined}>{mic
      ? pillSlot({ get label() { return props.label; }, icon: <><Aura />{props.icon}</> }, props.onPick, attrs)
      : pillSlot(props, props.onPick, attrs)}</Frost>;
  return mic && props.stretch ? <><span class="ui-pill-room" />{pill}</> : pill;
}
export function PillGroup(props: { actions: PillAction[]; onPick?: (label: string) => void }) {
  return <Frost class="ui-pill"><For each={props.actions}>{(item) => pillSlot(item, props.onPick)}</For></Frost>;
}
export function PillSwitch<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon: JSX.Element }>; onChange: (value: T) => void }) {
  return <Segmented pill icons label={props.label} value={props.value} options={props.options} onChange={props.onChange} />;
}
/** Its own textarea, or the caller's field as children (the composer's, with its behaviour). */
export function PillField(props: { placeholder?: string; value?: string; onInput?: (value: string) => void; class?: string; children?: JSX.Element }) {
  return <Frost class={cn("ui-pill ui-pill-field", props.class)}><Show when={props.children} fallback={<TextArea placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput?.(event.currentTarget.value)} />}>{props.children}</Show></Frost>;
}

/**
 * Aura: a field of colour behind a surface. Its blobs are numbers: the direction each comes in from, its colour
 * (OKLCh), its orbit (seconds a turn, negative turning back) and its swell (how its reach answers the level, negative
 * shrinking). Each circles near its edge and breathes twice a turn. Every point of the field is a blend of all of
 * them by distance (a mesh gradient, as Apple's glows are), its hue their weighted mean and its chroma held, so the
 * colours meet in colour, never grey, and none lies over another; a faint ground of the middle hue settles meetings. The level (--aura-level, eased by styles/pill.css)
 * turns them faster, brightens them and moves their balance; strength (0-1, --aura-strength) how strongly it shows, fainter
 * on a large surface. Drawn small and scaled up; it runs only while shown.
 */
const AURA_BLOBS = [
  { from: 180, l: .58, c: .2, h: 290, orbit: 7, swell: .5 },
  { from: 300, l: .64, c: .21, h: 22, orbit: -9, swell: -.35 },
  { from: 60, l: .64, c: .23, h: 345, orbit: 11, swell: .6 },
  { from: 0, l: .74, c: .17, h: 62, orbit: -13, swell: .45 },
  { from: 125, l: .6, c: .2, h: 315, orbit: 8, swell: -.3 },
];
/* A faint ground of the middle hue everywhere, so where two far hues meet head on they settle through it, not flip. */
const AURA_GROUND = { w: .18, l: .62, c: .2, a: Math.cos(345 * Math.PI / 180), b: Math.sin(345 * Math.PI / 180) };
const AURA_SIDE = 64;
function oklchToRgb(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + .3963377774 * a + .2158037573 * b, m_ = l - .1055613458 * a - .0638541728 * b, s_ = l - .0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  const gamma = (x: number) => 255 * (x <= .0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - .055);
  return [gamma(4.0767416621 * L - 3.3077115913 * M + .2309699292 * S), gamma(-1.2684380046 * L + 2.6097574011 * M - .3413193965 * S), gamma(-.0041960863 * L - .7034186147 * M + 1.707614701 * S)];
}
export function Aura(props: { on?: boolean; level?: number; strength?: number }) {
  let box!: HTMLSpanElement, canvas!: HTMLCanvasElement;
  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    let width = AURA_SIDE, height = AURA_SIDE, image = ctx.createImageData(width, height), frame = 0, last = 0, seen = true;
    const turns = AURA_BLOBS.map((_, i) => i * 1.3);
    // Sizing a canvas clears it, so it is resized only when its grid changes, and redrawn there at once: resized after
    // the frame's draw (as it is every frame its surface moves), it painted blank and the colour vanished mid-move.
    const fit = () => { const r = box.getBoundingClientRect(); if (!r.width || !r.height) return; const k = AURA_SIDE / Math.max(r.width, r.height);
      const w = Math.max(4, Math.round(r.width * k)), h = Math.max(4, Math.round(r.height * k));
      if (w === width && h === height && canvas.width === w) return;
      width = w; height = h; canvas.width = w; canvas.height = h; image = ctx.createImageData(w, h); render(0); };
    let level = 0;
    // It draws only while it shows: hidden it is faded out (opacity 0), and its loop stops there rather than asking for
    // every frame to read that it is still hidden. Its fade starting (after any delay) or a change to what shows it
    // starts the loop again, which runs at least a moment so a fade in that starts from 0 is not taken for hidden.
    let wake = 0;
    const draw = (now: number) => {
      frame = 0;
      // Out of the document (built but never placed, or taken out) it has no opacity to read: it stops there too, and
      // its view starts it again if it is placed.
      const style = getComputedStyle(box);
      if (!seen || !box.isConnected || (style.opacity === "0" && now > wake)) { last = 0; return; }
      frame = requestAnimationFrame(draw);
      level = Math.min(1, Math.max(0, parseFloat(style.getPropertyValue("--aura-level")) || 0));
      const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
      render(dt);
    };
    const render = (dt: number) => {
      const still = reducedMotion();
      const blobs = AURA_BLOBS.map((blob, i) => {
        if (!still) turns[i]! += dt * (2 * Math.PI / blob.orbit) * (1 + 1.5 * level);
        const t = turns[i]!, from = blob.from * Math.PI / 180, reach = .38 * (.9 + level * blob.swell + .25 * Math.sin(2 * t));
        return { x: .5 + .32 * Math.cos(from) + .14 * Math.cos(t), y: .5 + .36 * Math.sin(from) + .26 * Math.sin(t), r2: Math.max(.06, reach) ** 2,
          l: blob.l + .05 * level, c: blob.c, a: Math.cos(blob.h * Math.PI / 180), b: Math.sin(blob.h * Math.PI / 180) };
      });
      const data = image.data, aspect = width / height;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const u = (x + .5) / width, v = (y + .5) / height;
        let sw = AURA_GROUND.w, sl = AURA_GROUND.w * AURA_GROUND.l, sc = AURA_GROUND.w * AURA_GROUND.c, sa = AURA_GROUND.w * AURA_GROUND.a, sb = AURA_GROUND.w * AURA_GROUND.b;
        for (const blob of blobs) {
          const dx = (u - blob.x) * Math.min(1, aspect), dy = (v - blob.y) * Math.min(1, 1 / aspect);
          const w = Math.exp(-(dx * dx + dy * dy) / blob.r2);
          sw += w; sl += w * blob.l; sc += w * blob.c; sa += w * blob.a; sb += w * blob.b;
        }
        const n = Math.hypot(sa, sb) || 1, c = sc / sw, [r, g, bl] = oklchToRgb(sl / sw, c * sa / n, c * sb / n), o = 4 * (y * width + x);
        data[o] = r; data[o + 1] = g; data[o + 2] = bl; data[o + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    };
    const start = () => { wake = performance.now() + 500; if (!frame) frame = requestAnimationFrame(draw); };
    fit();
    const resize = new ResizeObserver(fit), view = new IntersectionObserver(([entry]) => { seen = !!entry?.isIntersecting; if (seen) start(); });
    // What shows it: its own data-on, or its pill's and composer's attributes (styles/pill.css, .ui-aura).
    const shows = new MutationObserver(start);
    shows.observe(box.closest(".ui-phone-composer") ?? box.parentElement ?? box, { attributes: true, subtree: true, attributeFilter: ["data-on", "data-show", "data-voice", "data-state", "data-mode"] });
    box.addEventListener("transitionstart", start);
    resize.observe(box); view.observe(box); start();
    onCleanup(() => { cancelAnimationFrame(frame); resize.disconnect(); view.disconnect(); shows.disconnect(); box.removeEventListener("transitionstart", start); });
  });
  return <span ref={box} class="ui-aura" data-on={props.on ? "" : undefined} aria-hidden="true" style={{ "--aura-level": props.level === undefined ? undefined : String(props.level), "--aura-strength": props.strength === undefined ? undefined : String(props.strength) }}><canvas ref={canvas} /></span>;
}

/**
 * PillWave: the voice as it comes, no surface: whole-pixel bars on a fixed pitch filling the width, the newest at the
 * right end, so it runs up to its neighbour's gap. levels: 0-1, oldest first (as many as fit are drawn, the rest
 * flat); silence is a dotted line. gain: how much a level is lifted before it is drawn (speech sits low).
 */
export function PillWave(props: { levels: number[]; gain?: number }) {
  let box!: HTMLDivElement;
  const [count, setCount] = createSignal(0);
  onMount(() => {
    const pitch = () => 2 * parseFloat(getComputedStyle(box).columnGap || "2");
    const fit = (width: number) => setCount(Math.max(1, Math.floor((width + pitch() / 2) / pitch())));
    fit(box.clientWidth);
    const watch = new ResizeObserver(([entry]) => entry && fit(entry.contentRect.width));
    watch.observe(box); onCleanup(() => watch.disconnect());
  });
  const bars = () => { const n = count(), last = props.levels.slice(-n); return [...Array<number>(Math.max(0, n - last.length)).fill(0), ...last]; };
  return <div ref={box} class="ui-pill-wave" aria-hidden="true"><For each={bars()}>{(level) => <i style={{ height: `${7 + Math.min(1, Math.max(0, level * (props.gain ?? 1))) * 93}%` }} />}</For></div>;
}
