import { children, createComputed, createEffect, createSignal, createUniqueId, For, mergeProps, on, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { CheckIcon, ChevronDownIcon, CopyIcon, ChevronLeftIcon, ChevronRightIcon, CircleCheckIcon, CircleXIcon, InfoIcon, SearchIcon, SquareIcon, TriangleAlertIcon, XIcon } from "lucide-solid";
export { ChevronDownIcon };
import { cn } from "@/lib/utils";
export { Orb, settledOrbRate, type ModeFrame, type ModeOpts, type OrbState } from "./orb";
export { PLAIN_SPHERE, SPUTTERING_SPHERE, ORBITS_TRAILED } from "./orb-frames";

/*
 * Components v2 (conduit-components-v2): the unified library (library.css).
 * UI that is "components v2" is built from these pieces and their tokens alone,
 * so a change to a base token reaches every use. Shapes only: no behaviour, so the same
 * pieces can later sit inside Kobalte menus, popovers and dialogs.
 */

export type Lift = "rest" | "raised";

export function Frost(props: { lift?: Lift; core?: boolean; class?: string; style?: JSX.CSSProperties; children?: JSX.Element }) {
  return <div class={cn("ui-frost", props.class)} data-surface="frost" data-lift={props.lift ?? "rest"} data-core={props.core ? "" : undefined} style={props.style}>{props.children}</div>;
}

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
export function PillButton(props: PillAction & { stretch?: boolean; folded?: boolean; voice?: boolean; aura?: boolean; open?: boolean; onPick?: (label: string) => void; button?: PillAttrs }) {
  const mic = !!props.aura;
  // The caller's attributes stay live on the one button (merged lazily, so a change never rebuilds it).
  const attrs = mergeProps(() => ({ tabIndex: props.folded ? -1 : undefined }), () => props.button ?? {}) as PillAttrs;
  const pill = <div class="ui-frost ui-pill" data-solo="" data-stretch={props.stretch ? "" : undefined} data-folded={props.folded ? "" : undefined} data-voice={props.voice || mic ? "" : undefined} data-open={props.open ? "" : undefined}
    aria-hidden={props.folded ? "true" : undefined}>{mic
      ? pillSlot({ get label() { return props.label; }, icon: <><Aura />{props.icon}</> }, props.onPick, attrs)
      : pillSlot(props, props.onPick, attrs)}</div>;
  return mic && props.stretch ? <><span class="ui-pill-room" />{pill}</> : pill;
}
export function PillGroup(props: { actions: PillAction[]; onPick?: (label: string) => void }) {
  return <div class="ui-frost ui-pill"><For each={props.actions}>{(item) => pillSlot(item, props.onPick)}</For></div>;
}
export function PillSwitch<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon: JSX.Element }>; onChange: (value: T) => void }) {
  return <Segmented pill icons label={props.label} value={props.value} options={props.options} onChange={props.onChange} />;
}
/** Its own textarea, or the caller's field as children (the composer's, with its behaviour). */
export function PillField(props: { placeholder?: string; value?: string; onInput?: (value: string) => void; class?: string; children?: JSX.Element }) {
  return <div class={cn("ui-frost ui-pill ui-pill-field", props.class)}><Show when={props.children} fallback={<TextArea placeholder={props.placeholder} value={props.value} onInput={props.onInput} />}>{props.children}</Show></div>;
}

/**
 * Aura: a field of colour behind a surface. Its blobs are numbers: the direction each comes in from, its colour
 * (OKLCh), its orbit (seconds a turn, negative turning back) and its swell (how its reach answers the level, negative
 * shrinking). Each circles near its edge and breathes twice a turn. Every point of the field is a blend of all of
 * them by distance (a mesh gradient, as Apple's glows are), its hue their weighted mean and its chroma held, so the
 * colours meet in colour, never grey, and none lies over another; a faint ground of the middle hue settles meetings. The level (--aura-level, eased by library.css)
 * turns them faster, brightens them and moves their balance. Drawn small and scaled up; it runs only while shown.
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
export function Aura(props: { on?: boolean; level?: number }) {
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
      const style = getComputedStyle(box);
      if (!seen || (style.opacity === "0" && now > wake)) { last = 0; return; }
      frame = requestAnimationFrame(draw);
      level = Math.min(1, Math.max(0, parseFloat(style.getPropertyValue("--aura-level")) || 0));
      const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
      render(dt);
    };
    const render = (dt: number) => {
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    // What shows it: its own data-on, or its pill's and composer's attributes (library.css, .ui-aura).
    const shows = new MutationObserver(start);
    shows.observe(box.closest(".ui-phone-composer") ?? box.parentElement ?? box, { attributes: true, subtree: true, attributeFilter: ["data-on", "data-show", "data-voice", "data-state", "data-mode"] });
    box.addEventListener("transitionstart", start);
    resize.observe(box); view.observe(box); start();
    onCleanup(() => { cancelAnimationFrame(frame); resize.disconnect(); view.disconnect(); shows.disconnect(); box.removeEventListener("transitionstart", start); });
  });
  return <span ref={box} class="ui-aura" data-on={props.on ? "" : undefined} aria-hidden="true" style={props.level === undefined ? undefined : { "--aura-level": String(props.level) }}><canvas ref={canvas} /></span>;
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

/**
 * PhoneComposer: the phone's composer, Pills on the page: a PillField over a row of PillButtons. mode says which
 * shows, and nothing reflows between them: idle (the row), typing (the field fades in above it), listening (the
 * row's other pills fade where they stand, the stretched mic shrinks to a short pill at the row's end, filling with colour, the voice
 * track sweeps out of it to the row's start, captions open above). edit: pills over the field while its cursor is
 * moved by hand, fading in when editing. onTrack: a tap on the track while listening (the app stops). level: the voice level (0-1) while listening; the mic's Aura answers it.
 * under: a menu opened from one of the row's pills (PillButton open) is over it; the rest dims at once, as a menu under its submenu.
 * layout: bar (the default: each pill its own frost, the mic stretched) or surface (the row one frost capsule, its pills slots in it,
 * the mic at its end; listening, an Aura fills the capsule under the track).
 */
export type VoiceMode = "idle" | "typing" | "listening";
/** PhoneComposer's parts, as its state table names them: the field, the row's pills (not the mic or Send, which are
 * always in the row), the edit pills, the voice track, the captions, and orb (the mic as an orb pill at the row's end). */
export type PhonePart = "field" | "pills" | "edit" | "track" | "captions" | "orb";
/** PhoneComposer's state table: what each state shows. Every move between two states follows from it and the three
 * moves in library.css (in, out, in place) -- none depends on the state it came from. */
export const PHONE_COMPOSER_STATES = {
  idle: ["pills"],
  typing: ["field", "pills"],
  editing: ["field", "pills", "edit"],
  listening: ["track", "captions", "orb"],
} as const satisfies Record<string, readonly PhonePart[]>;
export type PhoneState = keyof typeof PHONE_COMPOSER_STATES;
export function PhoneComposer(props: { mode: VoiceMode; layout?: "bar" | "surface"; field: JSX.Element; track?: JSX.Element; onTrack?: () => void; captions?: JSX.Element; edit?: JSX.Element; editing?: boolean; under?: boolean; level?: number; children: JSX.Element }) {
  const edit = children(() => props.edit);
  const state = (): PhoneState => props.mode === "typing" && props.editing ? "editing" : props.mode;
  const shows = (part: PhonePart) => (PHONE_COMPOSER_STATES[state()] as readonly PhonePart[]).includes(part);
  // The captions stay mounted while they go, until their ground has faded.
  const [captions, setCaptions] = createSignal(shows("captions"));
  createComputed(() => { if (shows("captions")) setCaptions(true); });
  let root!: HTMLDivElement, fieldBox!: HTMLDivElement;
  // The field's height, kept on the root: the captions' words going are clipped above it (it grows as the transcript lands).
  onMount(() => { const observer = new ResizeObserver(() => root.style.setProperty("--under-field", `${fieldBox.offsetHeight}px`)); observer.observe(fieldBox); onCleanup(() => observer.disconnect()); });
  const surface = () => props.layout === "surface";
  return <div ref={root} class="ui-phone-composer" data-state={state()} data-show={PHONE_COMPOSER_STATES[state()].join(" ")} data-layout={surface() ? "surface" : undefined} data-under={props.under ? "" : undefined} style={{ "--voice-level": shows("orb") && props.level !== undefined ? String(props.level) : undefined }}>
    <Show when={edit()}><div class="ui-phone-edit" aria-hidden={shows("edit") ? undefined : "true"}>{edit()}</div></Show>
    <Show when={captions()}><div class="ui-voice-captions" aria-live="polite" data-leaving={shows("captions") ? undefined : ""} onAnimationEnd={(event) => { if (event.target === event.currentTarget && !shows("captions")) setCaptions(false); }}>{props.captions}</div></Show>
    <div ref={fieldBox} class="ui-phone-field">{props.field}</div>
    <div class={surface() ? "ui-frost ui-phone-row" : "ui-phone-row"}>{props.children}<div class="ui-voice-track" aria-hidden={shows("track") ? undefined : "true"} onClick={() => shows("track") && props.onTrack?.()}><Show when={surface()}><Aura /></Show>{props.track}</div></div>
  </div>;
}

/**
 * desktop or phone: the rules a shell's sections and items are built at. The
 * layout sets it once (the phone layout's media rule in library.css, or
 * data-density on an ancestor); a shell inherits it and its sections follow.
 * The prop is an override, for drawing one layout inside another.
 */
export type Density = "desktop" | "phone";

/**
 * The one cursor (DESIGN Interaction): the pointer moves it, as the keyboard
 * does, so only one row of a list is ever washed. A list's container passes
 * this to onPointerOver; a row is a ui-row (data-highlighted) or a ui-choice (data-active).
 */
export function moveCursor(event: PointerEvent & { currentTarget: Element }) {
  const row = (event.target as Element).closest(".ui-row, .ui-choice");
  if (!row || !event.currentTarget.contains(row) || row.hasAttribute("data-disabled")) return;
  const attr = row.classList.contains("ui-choice") ? "data-active" : "data-highlighted";
  if (row.getAttribute(attr) === (attr === "data-active" ? "true" : "")) return;
  event.currentTarget.querySelectorAll(`[${attr}]`).forEach((other) => other.removeAttribute(attr));
  row.setAttribute(attr, attr === "data-active" ? "true" : "");
}

/** A piece's move, drawn by the piece from Foundations · Motion: entering, leaving (back the way it came), removing (fades in place). */
export type Motion = "entering" | "leaving" | "removing";
const motionOf = (motion?: Motion) => ({ "data-entering": motion === "entering" ? "" : undefined, "data-leaving": motion === "leaving" ? "" : motion === "removing" ? "remove" : undefined });

/** under: a phone's submenu is open as a panel over it, so it dims and takes no taps. */
export function Menu(props: { class?: string; density?: Density; motion?: Motion; under?: boolean; children: JSX.Element }) {
  return <div role="menu" class={cn("ui-frost ui-menu", props.class)} onPointerOver={moveCursor} data-density={props.density} data-surface="frost" data-lift="raised" data-under={props.under ? "" : undefined} {...motionOf(props.motion)}>{props.children}</div>;
}

/** A menu's section: a list of items (the default) or a slider, with an optional title and a note beside it. */
export function Section(props: { title?: string; note?: JSX.Element; kind?: "list" | "slider"; children: JSX.Element }) {
  return <div role="group" aria-label={props.title} class="ui-section" data-kind={props.kind ?? "list"}>
    <Show when={props.title}><div class="ui-title"><span>{props.title}</span><Show when={props.note}><small>{props.note}</small></Show></div></Show>
    {props.children}
  </div>;
}

/** A search section: the field alone. It filters the list section after it, or opens a full search; keys shows its shortcut, which a phone variant never shows. */
export function SearchSection(props: { placeholder: string; value?: string; keys?: string[]; onInput?: (value: string) => void }) {
  return <div role="search" class="ui-section ui-search-section" data-kind="search">
    <SearchIcon /><input class="ui-search" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    <Show when={props.keys}><Keys keys={props.keys!} /></Show>
  </div>;
}

/** A heading section: what the popover is about -- a title and a line under it (the chat menu's top). */
export function HeadingSection(props: { title: string; detail?: JSX.Element; children?: JSX.Element }) {
  return <div class="ui-section ui-heading" data-kind="heading">
    <div class="ui-heading-title">{props.title}</div><Show when={props.detail}><div class="ui-heading-detail">{props.detail}</div></Show>
    {props.children}
  </div>;
}

/** An item in a list section. Icon, meta, keys and opens are its parts; checked, disabled and destructive its states. */
export function Item(props: {
  icon?: JSX.Element; meta?: JSX.Element; detail?: JSX.Element; keys?: string[]; opens?: boolean; active?: boolean;
  /** field: the label is a field name (title type) and meta its value, as in "CONTEXT  Unavailable ›". */
  field?: boolean; onClick?: () => void;
  /** keysFirst: the keycaps lead the row (the leader menu, where the key is what you read first). */
  keysFirst?: boolean;
  checked?: boolean; disabled?: boolean; destructive?: boolean; children: JSX.Element;
  /** end: a control at the row's end, after its meta (a remove ×). */
  end?: JSX.Element;
}) {
  return <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class="ui-row" aria-checked={props.checked} data-field={props.field ? "" : undefined} onClick={props.onClick}
    data-highlighted={props.active ? "" : undefined} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined}>
    <Show when={props.keysFirst && props.keys}><Keys keys={props.keys!} first /></Show>
    <Show when={props.icon}><span class="ui-icon">{props.icon}</span></Show><span class="ui-label" data-stacked={props.detail ? "" : undefined}><Show when={props.detail} fallback={props.children}><span>{props.children}</span><small class="ui-detail">{props.detail}</small></Show></span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={!props.keysFirst && props.keys}><Keys keys={props.keys!} /></Show>
    <Show when={props.opens}><ChevronRightIcon class="ui-chevron" /></Show>
    <Show when={props.end}><span class="ui-row-end">{props.end}</span></Show>
  </div>;
}

/** Typing lights the match: the matched letters white and heavier, the rest of the label muted. A keyword-only match stays plain. */
export function Match(props: { text: string; query: string }) {
  const at = () => props.query ? props.text.toLowerCase().indexOf(props.query.toLowerCase()) : -1;
  return <Show when={at() >= 0} fallback={props.text}><span class="ui-match">{props.text.slice(0, at())}<b>{props.text.slice(at(), at() + props.query.length)}</b>{props.text.slice(at() + props.query.length)}</span></Show>;
}

/** A key or a chord. onClick: it can be pressed (to record another); onRemove: a × beside it clears it (Settings · Shortcuts). */
export function Keycap(props: { children: JSX.Element; label?: string; class?: string; onClick?: () => void; onRemove?: () => void }) {
  if (!props.onClick && !props.onRemove) return <kbd class={cn("ui-keycap", props.class)}>{props.children}</kbd>;
  return <span class="ui-keycap" data-editable="">
    <button type="button" aria-label={props.label ? `Change ${props.label}` : undefined} onClick={() => props.onClick?.()}>{props.children}</button>
    <Show when={props.onRemove}><button type="button" class="ui-keycap-remove" aria-label={props.label ? `Remove ${props.label}` : "Remove"} onClick={() => props.onRemove?.()}><XIcon /></button></Show>
  </span>;
}

/** A run of keys, a keycap each; first: they lead the row (the leader). */
const Keys = (props: { keys: string[]; first?: boolean }) => <span class="ui-keys" data-first={props.first ? "" : undefined}><For each={props.keys}>{(key) => <Keycap>{key}</Keycap>}</For></span>;

/** size wide: a card that holds content (a list, an excerpt, an editor). close: a × in its corner, for a card with no Cancel. */
export function Card(props: { title: string; detail?: JSX.Element; class?: string; density?: Density; size?: "wide"; close?: boolean | (() => void); actions?: JSX.Element; motion?: Motion; children?: JSX.Element }) {
  return <div role="dialog" aria-label={props.title} class={cn("ui-frost ui-card", props.class)} data-density={props.density} data-size={props.size} data-close={props.close ? "" : undefined} data-surface="frost" data-lift="raised" {...motionOf(props.motion)}>
    <h3>{props.title}</h3><Show when={props.detail}><p>{props.detail}</p></Show>
    <Show when={props.close}><Button variant="ghost" size="icon-sm" class="ui-card-close" aria-label="Close" onClick={() => typeof props.close === "function" && props.close()}><XIcon /></Button></Show>
    {props.children}
    <Show when={props.actions}><div class="ui-card-actions">{props.actions}</div></Show>
  </div>;
}

/*
 * DesktopComposer: resting frost holding a Field above a Toolbar, desktop only
 * (a phone's composer is Pills). Its field is a TextArea (a control), which it pads. Geometry is
 * tokens (--cmp-*), measured from the app and scaled by density; its width is
 * the pane's to declare (--composer-width).
 */
/** takeover: a card Rider (the question) that takes the composer's place: the composer drops out of the pane but
 *  keeps its room, and the card rises into the slot. */
export function DesktopComposer(props: { riders?: JSX.Element; takeover?: JSX.Element; class?: string; children: JSX.Element }) {
  const takeover = children(() => props.takeover);
  return <div class="ui-composer-slot ui-composer-width" data-taken={takeover() ? "" : undefined}>
    <div class="ui-composer-stack">{props.riders}<div class={cn("ui-frost ui-desktop-composer", props.class)} data-surface="frost" data-lift="rest">{props.children}</div></div>{takeover()}</div>;
}
/** The composer's field slot: where its TextArea (or the app's, with its behaviour) sits, padded by the composer. */
export const ComposerField = (props: { children: JSX.Element }) => <div class="ui-composer-field">{props.children}</div>;
/** A row of controls: start (leading) and end (trailing) groups. primary: the end's one slot (Send, or Stop while
 *  the agent works), each action scaling in where the last was; aside: what steps in beside it (Stop, when a draft
 *  is typed during a turn) -- it folds as a Pill does: its room opens, then it fades in; going, it fades, then gives
 *  the room back (it keeps what it last held while it goes), so its neighbours move rather than jump. */
export function Toolbar(props: { start?: JSX.Element; end?: JSX.Element; aside?: JSX.Element; primary?: JSX.Element; class?: string }) {
  const aside = children(() => props.aside);
  const [held, setHeld] = createSignal<JSX.Element>();
  createEffect(() => { const now = aside(); if (now) setHeld(() => now); });
  return <div class={cn("ui-toolbar", props.class)}><div class="ui-toolbar-start">{props.start}</div><div class="ui-toolbar-end">{props.end}
    <span ref={(el) => createEffect(() => { el.inert = !aside(); })} class="ui-toolbar-aside" data-folded={aside() ? undefined : ""} aria-hidden={aside() ? undefined : "true"}><span>{held()}</span></span>
    <Show when={props.primary !== undefined}><span class="ui-toolbar-primary">{props.primary}</span></Show></div></div>;
}

/*
 * Rider: frost on a composer's top edge, either composer's. A row (title,
 * body, actions), a strip (chips, actions) or a card (the question).
 */
export function Rider(props: { label?: string; layout?: "row" | "strip" | "card"; class?: string; motion?: Motion; children: JSX.Element }) {
  return <div class={cn("ui-frost ui-rider", props.class)} data-surface="frost" data-lift="rest" data-layout={props.layout ?? "row"} role="group" aria-label={props.label} {...motionOf(props.motion)}>{props.children}</div>;
}
export const RiderTitle = (props: { children: JSX.Element }) => <span class="ui-title-text">{props.children}</span>;
/** A button riding over the transcript just above the composer: scroll to latest (an icon alone), cancel an edit
 *  (an icon and its words). Resting frost at the surface radius. */
export function RiderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: JSX.Element; label: string; show?: "icon" | "label"; motion?: Motion }) {
  const [local, rest] = splitProps(props, ["icon", "label", "show", "class", "motion"]);
  return <button type="button" {...rest} {...motionOf(local.motion)} class={cn("ui-frost ui-rider-button", local.class)} data-surface="frost" data-lift="rest" data-labelled={local.show === "label" ? "" : undefined}
    aria-label={local.show === "label" ? undefined : local.label} title={local.show === "label" ? undefined : local.label}>{local.icon}<Show when={local.show === "label"}><span>{local.label}</span></Show></button>;
}
export const RiderActions = (props: { stack?: boolean; children: JSX.Element }) => <div class="ui-rider-actions" data-stack={props.stack ? "" : undefined}>{props.children}</div>;
/** A line of waiting text, one line until opened. */
export function Line(props: { text: string; clipped?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return <li class="ui-line" data-expanded={open() ? "true" : "false"}><p class="ui-line-body">{props.text}</p>
    <Show when={props.clipped}><button type="button" class="ui-line-more" aria-label={open() ? "Show less" : "Show more"} onClick={() => setOpen(!open())}><ChevronDownIcon /></button></Show></li>;
}
/** An attached thing: an image's thumbnail, or a file's mark, name and size. */
export function Chip(props: { name: string; detail?: string; image?: string; icon?: JSX.Element; status?: "uploading" | "error" | "done"; progress?: number; motion?: Motion }) {
  const ring = 2 * Math.PI * 9;
  return <div class="ui-chip" data-kind={props.image ? "image" : "file"} data-status={props.status ?? "done"} {...motionOf(props.motion)}>
    <button type="button" class="ui-chip-body" aria-label={`Show ${props.name}`}>
      <span class="ui-chip-media"><Show when={props.image} fallback={props.icon}><img src={props.image} alt="" /></Show>
        <Show when={props.status === "uploading"}><svg class="ui-chip-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="9" stroke-dasharray={`${ring}`} stroke-dashoffset={ring * (1 - (props.progress ?? 40) / 100)} /></svg></Show></span>
      <Show when={!props.image}><span class="ui-chip-copy"><strong>{props.name}</strong><small>{props.detail}</small></span></Show>
    </button>
    <button type="button" class="ui-chip-remove" aria-label={`Remove ${props.name}`}><XIcon /></button>
  </div>;
}
/** A numbered answer: label, description, and a check (a box when several may be chosen). */
/** A list of Choices: one answer, or several (pick any). */
export const Choices = (props: { multi?: boolean; children: JSX.Element }) =>
  <div class="ui-choices" role="listbox" aria-multiselectable={props.multi ? "true" : undefined} onPointerOver={moveCursor}>{props.children}</div>;

export function Choice(props: { n: number; label: string; detail?: string; chosen?: boolean; active?: boolean; multi?: boolean }) {
  return <div role="option" class="ui-choice" aria-selected={props.chosen} data-active={props.active ? "true" : undefined}>
    <span class="ui-choice-key">{props.n}</span><span class="ui-choice-label">{props.label}</span>
    <Show when={props.detail}><span class="ui-choice-detail">{props.detail}</span></Show>
    <span class="ui-choice-check" data-multi={props.multi ? "true" : undefined}><Show when={props.chosen}><CheckIcon /></Show></span>
  </div>;
}

/*
 * Overlay: raised frost over a dimmed page -- the app's large surfaces (the
 * command palette, chat search, settings). Its sections run edge to edge,
 * divided by rules: a Bar (the field), a body -- a List, a List beside an
 * aside (OverlaySplit), or a Rail beside a Page -- and Hints. Its rows are
 * the popover's Items at the overlay's scale; the Rail is the sidebar's
 * NavGroups. Its width is the caller's (--overlay-width).
 */
export function Scrim(props: { placement?: "top" | "center"; class?: string; motion?: Motion; children: JSX.Element }) {
  return <div class={cn("ui-scrim", props.class)} data-placement={props.placement ?? "top"} {...motionOf(props.motion)}>{props.children}</div>;
}

/** core: frost on a solid backing, kept for the phone's full-screen overlays should the page behind them be too busy -- off for now. */
export function Overlay(props: { label: string; layout?: "stack" | "rail"; core?: boolean; density?: Density; class?: string; style?: JSX.CSSProperties; motion?: Motion; children: JSX.Element }) {
  return <div role="dialog" aria-label={props.label} class={cn("ui-frost ui-overlay", props.class)} style={props.style} data-layout={props.layout ?? "stack"}
    data-surface="frost" data-lift="raised" data-core={props.core ? "" : undefined} data-density={props.density} {...motionOf(props.motion)}>{props.children}</div>;
}

/** The field across the top: a lead (a prompt glyph, a search icon, a back button), the input, then end controls and close. */
export function OverlayBar(props: { lead?: JSX.Element; placeholder: string; value?: string; onInput?: (value: string) => void; end?: JSX.Element; onClose?: () => void }) {
  return <div class="ui-overlay-bar">
    <Show when={props.lead}><span class="ui-overlay-lead">{props.lead}</span></Show>
    <input class="ui-overlay-input" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    {props.end}
    <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show>
  </div>;
}

/** The scrolling body: Sections of Items, titled as groups. */
export const OverlayList = (props: { children: JSX.Element }) => <div class="ui-overlay-list" role="listbox" onPointerOver={moveCursor}>{props.children}</div>;

/** A list beside an aside (a preview of what the list has selected). */
/** aside: optional, so a preview that can be hidden (chat search's Ctrl+P) leaves the list the whole width. */
export const OverlaySplit = (props: { aside?: JSX.Element; children: JSX.Element }) =>
  <div class="ui-overlay-split" data-aside={props.aside ? "" : undefined}>{props.children}<Show when={props.aside}><aside class="ui-overlay-aside">{props.aside}</aside></Show></div>;

/** The keys along the foot: [keys, what they do], at the start and the end. */
export type Hint = [string[], string];
export function OverlayHints(props: { start: Hint[]; end?: Hint[] }) {
  const hint = ([keys, label]: Hint) => <span><For each={keys}>{(key) => <Keycap>{key}</Keycap>}</For>{label}</span>;
  return <div class="ui-overlay-hints" aria-hidden="true"><For each={props.start}>{hint}</For>
    <Show when={props.end}><span class="ui-overlay-hints-end"><For each={props.end}>{hint}</For></span></Show></div>;
}

/** A rail of sections down the side: a title, NavGroups, and a foot. */
export function OverlayRail(props: { title: string; foot?: JSX.Element; children: JSX.Element }) {
  return <nav class="ui-overlay-rail"><h2 class="ui-overlay-title">{props.title}</h2>{props.children}
    <Show when={props.foot}><div class="ui-overlay-rail-foot">{props.foot}</div></Show></nav>;
}

/** The page beside a rail: its title, its save status (Saving, Saved, Not saved: settings save as they change), close, and SettingGroups. */
export function OverlayPage(props: { title: string; status?: string; failed?: boolean; onBack?: () => void; onClose?: () => void; children: JSX.Element }) {
  return <main class="ui-overlay-page">
    <div class="ui-overlay-page-head"><Show when={props.onBack}><Button variant="ghost" size="icon-sm" aria-label="All settings" onClick={() => props.onBack?.()}><ChevronLeftIcon /></Button></Show><h2 class="ui-overlay-title">{props.title}</h2>
      <Show when={props.status}><span class="ui-overlay-status" data-failed={props.failed ? "" : undefined}>{props.status}</span></Show>
      <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show></div>
    {props.children}
  </main>;
}

/*
 * Toast: one sentence about what just happened, raised frost at the window's edge. Its kind is a glyph in
 * the state's colour (never a fill): success --live, warning --warn, error --destructive, info muted.
 * An action, when there is one thing to do about it; a × to dismiss. An error is an alert, the rest status.
 */
export type ToastKind = "success" | "info" | "warning" | "error";
const TOAST_ICONS: Record<ToastKind, () => JSX.Element> = { success: () => <CircleCheckIcon />, info: () => <InfoIcon />, warning: () => <TriangleAlertIcon />, error: () => <CircleXIcon /> };
export function Toast(props: { kind?: ToastKind; children: JSX.Element; action?: { label: string; onClick?: () => void }; onDismiss?: () => void; density?: Density; motion?: Motion }) {
  const kind = () => props.kind ?? "info";
  return <div role={kind() === "error" ? "alert" : "status"} class="ui-frost ui-toast" data-kind={kind()} data-density={props.density} data-surface="frost" data-lift="raised" {...motionOf(props.motion)}>
    <span class="ui-toast-icon">{TOAST_ICONS[kind()]()}</span>
    <p class="ui-toast-text">{props.children}</p>
    <Show when={props.action}>{(action) => <Button variant="ghost" outline size="sm" onClick={() => action().onClick?.()}>{action().label}</Button>}</Show>
    <Button variant="ghost" size="icon-xs" class="ui-toast-close" aria-label="Dismiss" onClick={() => props.onDismiss?.()}><XIcon /></Button>
  </div>;
}
/** Where toasts gather: newest nearest the edge, the rest stacked away from it. */
export const Toaster = (props: { children: JSX.Element }) => <section class="ui-toaster" aria-label="Notifications">{props.children}</section>;

/** Recording a shortcut: a second line under the setting, the same height, in place of a panel. A red dot and
 *  "Press a shortcut" until keys arrive, then the chord as one keycap, as the list shows it; the keys that steer it, and Save once there is something to save. */
export const SettingRecorder = (props: { keys?: string[]; onSave?: () => void; onCancel?: () => void }) =>
  <div class="ui-setting-recorder" role="status" aria-live="polite">
    <span class="ui-recorder-dot" aria-hidden="true" />
    <Show when={props.keys?.length} fallback={<span class="ui-recorder-prompt">Press a shortcut</span>}>
      <Keycap class="ui-recorder-keys">{props.keys!.join(" ")}</Keycap>
    </Show>
    <span class="ui-recorder-hints"><Keycap>Esc</Keycap>cancel<Keycap>Backspace</Keycap>clear</span>
    <Button size="sm" outline disabled={!props.keys?.length} onClick={() => props.onSave?.()}>Save</Button>
  </div>;

/** A titled group of SettingLines; groups after the first are ruled off. */
export const SettingGroup = (props: { title: string; children: JSX.Element }) =>
  <section class="ui-setting-group" aria-label={props.title}><div class="ui-nav-label">{props.title}</div>{props.children}</section>;

/** A setting: its name (state that matters muted after it), then its control in the one control column.
 *  plain: what it holds is buttons, a value or a link, not one field, so the line is not that field's label. */
export const SettingLine = (props: { label: string; state?: string; plain?: boolean; children: JSX.Element }) => {
  const inner = () => <><span>{props.label}<Show when={props.state}><small>{props.state}</small></Show></span><span class="ui-setting-control">{props.children}</span></>;
  return props.plain ? <div class="ui-setting-line">{inner()}</div> : <label class="ui-setting-line">{inner()}</label>;
};
/** A setting's value that is read, not set; mono for ids, addresses and versions. */
export const SettingValue = (props: { mono?: boolean; children: JSX.Element }) => <span class="ui-setting-value" data-mono={props.mono ? "" : undefined}>{props.children}</span>;
/** A link out, as a setting's control: Docs, Open sign-in. */
export const SettingLink = (props: { href: string; children: JSX.Element }) => <a class="ui-setting-link" href={props.href} target="_blank" rel="noreferrer">{props.children}</a>;
/** A line under a setting: what went wrong (error), or a quiet note. */
export const SettingNote = (props: { tone?: "quiet" | "error"; children: JSX.Element }) => <p class="ui-setting-note" data-tone={props.tone ?? "quiet"} role={props.tone === "error" ? "alert" : undefined}>{props.children}</p>;
/** More about a setting, folded under it until asked for. */
export const SettingDetails = (props: { summary: string; children: JSX.Element }) => <details class="ui-setting-details"><summary>{props.summary}</summary>{props.children}</details>;
/** Something a setting needs the page's width for: a prompt's text, a download's progress. */
export const SettingWide = (props: { children: JSX.Element }) => <div class="ui-setting-wide">{props.children}</div>;
/** Progress that is measured: a track and its fill, the slider's. */
export const Progress = (props: { value: number; max: number; label: string }) => <progress class="ui-progress" aria-label={props.label} value={props.value} max={props.max} />;
/** Waiting on what a page shows. */
export const SettingLoading = (props: { children: JSX.Element }) => <div class="ui-setting-loading"><span class="ui-spinner" aria-hidden="true" />{props.children}</div>;

/*
 * Glance: what chat search's cursor rests on, told apart without opening it -- a chat's title and
 * facts, its last prompt, how that turn ended and the start of its answer; or a folder and its
 * latest chats. The app reads the chat; these only draw what it read.
 */
export const Glance = (props: { label: string; children: JSX.Element }) => <div class="ui-glance" aria-label={props.label} aria-live="polite">{props.children}</div>;
export const GlanceHead = (props: { mark?: JSX.Element; title: string; facts: string[] }) => <>
  <div class="ui-glance-title">{props.mark}<span>{props.title}</span></div>
  <For each={props.facts}>{(fact) => <div class="ui-glance-facts" title={fact}>{fact}</div>}</For>
</>;
/** The last prompt, as the user's message is drawn, clamped to four lines. */
export const GlancePrompt = (props: { children: JSX.Element }) => <p class="ui-frost ui-bubble ui-glance-prompt">{props.children}</p>;
/** How the turn ended: an orb (the app's), the outcome, how long and what it did. */
export const GlanceTurn = (props: { orb?: JSX.Element; outcome: string; detail?: string }) =>
  <div class="ui-glance-turn"><Show when={props.orb}><span class="ui-glance-orb">{props.orb}</span></Show><span><b>{props.outcome}</b>{props.detail ? ` · ${props.detail}` : ""}</span></div>;
/** The start of the answer, clamped; html: the app's rendered math, faded where it is cut. */
export const GlanceAnswer = (props: { html?: string; children?: JSX.Element }) => props.html !== undefined
  ? <div class="ui-glance-answer" data-math="" innerHTML={props.html} />
  : <p class="ui-glance-answer">{props.children}</p>;
export const GlanceEmpty = (props: { children: JSX.Element }) => <p class="ui-glance-empty">{props.children}</p>;

/** An overlay's head without a field: what it is about (the leader's key and path). */
export const OverlayHead = (props: { children: JSX.Element }) => <div class="ui-overlay-bar" data-head>{props.children}</div>;

/**
 * A breadcrumb of places: the one uppercase label (DESIGN Typography). The
 * current place is white with no fill; the cursor washes the others.
 */
export function Crumbs(props: { label: string; items: { label: string; current?: boolean; disabled?: boolean; onClick?: () => void }[] }) {
  return <nav class="ui-crumbs" aria-label={props.label}><For each={props.items}>{(item, index) => <>
    <Show when={index() > 0}><span class="ui-crumbs-sep" aria-hidden="true">›</span></Show>
    <button type="button" aria-current={item.current ? "true" : undefined} disabled={item.disabled} onClick={() => item.onClick?.()}>{item.label}</button>
  </>}</For></nav>;
}

/**
 * The leader menu (Ctrl+G): a small raised frost card that floats without
 * covering the page, above the composer. Its head is the leader's key and the
 * region path; its rows lead with their keys; its rail holds the go-to chords
 * and Esc. The page dims round it all but the current region (Spotlight).
 */
export function Leader(props: { path: JSX.Element; hints: JSX.Element; motion?: Motion; children: JSX.Element }) {
  return <Overlay label="Leader" class="ui-leader" motion={props.motion}><OverlayHead>{props.path}</OverlayHead>
    <OverlayList>{props.children}</OverlayList>{props.hints}</Overlay>;
}

/** The dim over the page with one region left lit, cut out with its own corners; no region lights nothing. */
export function Spotlight(props: { lit?: { top: string; left: string; width: string; height: string; radius?: string }; class?: string; children?: JSX.Element }) {
  return <div class={cn("ui-spotlight", props.class)} aria-hidden="true">
    <div class="ui-spotlight-lit" data-whole={props.lit ? undefined : ""} style={props.lit ? { top: props.lit.top, left: props.lit.left, width: props.lit.width, height: props.lit.height, "border-radius": props.lit.radius } : {}} />
    {props.children}
  </div>;
}

export const Bubble = (props: { children: JSX.Element }) => <div class="ui-frost ui-bubble">{props.children}</div>;

/*
 * Transcript (DESIGN Transcript): what is read, at the transcript's scale. A Turn is its trace header, the
 * answer and the answer's foot; the user's Message is a Bubble and its foot. Shapes only: the orb, the
 * markdown and every action are the caller's.
 */
/** The answer: Markdown with no bubble, the Body role, one gap between blocks. html for rendered Markdown. */
export const Answer = (props: { html?: string; children?: JSX.Element }) =>
  <Show when={props.html !== undefined} fallback={<div class="ui-answer">{props.children}</div>}><div class="ui-answer" innerHTML={props.html} /></Show>;
/** A fenced block: its language and Copy over the lines, numbered. */
/**
 * Copy, and what it says once it has: the icon turns to a check for a moment (the caller holds `copied` about
 * 1.2s). Whatever was copied marks itself `data-copied` and takes the copied wash: a --tint that fades out.
 */
export function CopyButton(props: { copied?: boolean; label?: string; onCopy?: () => void }) {
  return <Button variant="ghost" size="icon-xs" class="ui-copy" data-copied={props.copied ? "" : undefined} aria-label={props.copied ? "Copied" : props.label ?? "Copy"} onClick={() => props.onCopy?.()}>
    <Show when={props.copied} fallback={<CopyIcon />}><CheckIcon /></Show>
  </Button>;
}
/**
 * A fenced block: a box, its language and Copy over numbered lines that scroll sideways. A long one folds to
 * `fold` lines, fading at the cut, "Show N more lines" under it and a chevron beside Copy (the caption pins as
 * the block scrolls by, so it is the way out part-way down); opened, the foot says Show less. `streaming`
 * pulses the foot of a folded block still being written.
 */
export function CodeBlock(props: { lang?: string; code: string; onCopy?: () => void; copied?: boolean; fold?: number; open?: boolean; onToggle?: () => void; streaming?: boolean }) {
  const lines = () => props.code.split("\n");
  const folds = () => props.fold != null && lines().length > props.fold;
  const folded = () => folds() && !props.open;
  const hidden = () => lines().length - (props.fold ?? 0);
  return <figure class="ui-code" data-folded={folded() ? "" : undefined} data-copied={props.copied ? "" : undefined} data-streaming={props.streaming ? "" : undefined}
    style={{ "--code-digits": String(lines().length).length, ...(folds() ? { "--code-fold": props.fold } : {}) }}>
    <figcaption><span class="ui-code-lang">{props.lang ?? "text"}</span>
      <CopyButton copied={props.copied} label="Copy code" onCopy={props.onCopy} />
      <Show when={folds()}><Button variant="ghost" size="icon-xs" aria-label={folded() ? "Expand code" : "Collapse code"} aria-expanded={!folded()} onClick={() => props.onToggle?.()}><ChevronDownIcon class="ui-disclosure-chevron" /></Button></Show>
    </figcaption>
    <pre><For each={lines()}>{(line, index) => <span class="ui-code-line"><span class="ui-code-n">{index() + 1}</span><code>{line || " "}</code></span>}</For></pre>
    <Show when={folds()}><button type="button" class="ui-code-more" onClick={() => props.onToggle?.()}>{folded() ? `Show ${hidden()} more ${hidden() === 1 ? "line" : "lines"}` : "Show less"}</button></Show>
  </figure>;
}
/**
 * A turn's head: the orb, then Status · time · work, and under it the trail's latest line (text, or the app's inline
 * Markdown). opens: a trail to open. live: the latest line's room is held while the turn runs, so the first step to
 * arrive moves nothing below.
 */
export function TraceHeader(props: { orb?: JSX.Element; status: string; time?: string; work?: string; latest?: JSX.Element; live?: boolean; tone?: "failed"; opens?: boolean; open?: boolean; onToggle?: () => void }) {
  return <button type="button" class="ui-trace" data-tone={props.tone} aria-expanded={props.opens ? Boolean(props.open) : undefined} disabled={!props.opens} onClick={() => props.onToggle?.()}>
    <span class="ui-trace-orb">{props.orb}</span>
    <span class="ui-trace-line"><b>{props.status}</b><Show when={props.time}><span class="ui-trace-time">{"\u00a0· "}{props.time}</span></Show><Show when={props.work}><span>{"\u00a0· "}{props.work}</span></Show></span>
    <Show when={props.opens}><ChevronDownIcon class="ui-disclosure-chevron" /></Show>
    <Show when={props.latest || props.live}><span class="ui-trace-latest">{props.latest || "\u00a0"}</span></Show>
  </button>;
}
/**
 * Trace: a turn's work, folded under its head. The head is a TraceHeader (pass its props); the trail (children, a
 * Trail of Steps) unfolds under it as a Disclosure's body does. With no children there is nothing to open. A turn
 * not yet started is a Trace with status "Starting", a connecting Orb and live.
 */
export function Trace(props: Omit<Parameters<typeof TraceHeader>[0], "opens"> & { children?: JSX.Element }) {
  const [head, local] = splitProps(props, ["orb", "status", "time", "work", "latest", "live", "tone", "open", "onToggle"]);
  const body = children(() => local.children);
  const opens = () => body.toArray().length > 0;
  return <div class="ui-disclosure ui-trace-fold" data-open={head.open && opens() ? "true" : "false"}>
    <TraceHeader {...head} opens={opens()} />
    <div class="ui-disclosure-body" aria-hidden={!head.open}>{body()}</div>
  </div>;
}
/** Anything that folds: a header, one turning chevron, a body. Shape only: the caller opens it (and animates it). */
export function Disclosure(props: { header: JSX.Element; open?: boolean; onToggle?: () => void; disabled?: boolean; children?: JSX.Element }) {
  return <div class="ui-disclosure" data-open={props.open ? "true" : "false"}>
    <button type="button" class="ui-disclosure-header" aria-expanded={Boolean(props.open)} disabled={props.disabled} onClick={() => props.onToggle?.()}>{props.header}<ChevronDownIcon class="ui-disclosure-chevron" /></button>
    <div class="ui-disclosure-body" aria-hidden={!props.open}>{props.children}</div>
  </div>;
}
/** The opened trail: one light line per step. nested: a group's steps on a rail of their own under its icon;
 * calls: a code-mode script's calls, quieter, inside its step. */
export const Trail = (props: { nested?: "group" | "calls"; children: JSX.Element }) => <ol class="ui-trail" data-nested={props.nested}>{props.children}</ol>;
const NOT_KEPT = "Not kept";
export type StepState = "running" | "failed" | "stopped" | "planned" | "earlier";
/**
 * A step: its kind's icon (a spinner while running), a verb, its subject in muted mono, flags, its duration at the
 * end. summary: a line of text instead of verb and subject (thinking, narration). note: not a step, nothing to open
 * (reasoning the provider kept). discarded: text a stop threw away, struck, flagged Not kept. flags: words beside the
 * time (repeats). With children it opens in place to them -- its output, its prose, a group's or a script's steps.
 */
export function Step(props: { label?: string; icon?: JSX.Element; verb?: string; subject?: string; summary?: JSX.Element; time?: string; state?: StepState; flags?: string[]; note?: boolean; discarded?: boolean; open?: boolean; onToggle?: () => void; motion?: Motion; children?: JSX.Element }) {
  const body = children(() => props.children);
  const opens = () => body.toArray().length > 0 && !props.note;
  const flags = () => [...(props.flags ?? []), ...(props.discarded ? [NOT_KEPT] : []), ...(props.state === "failed" ? ["Failed"] : props.state === "stopped" ? ["Stopped"] : [])];
  const row = () => <>
    <span class="ui-step-icon"><Show when={props.state === "running"} fallback={props.icon}><span class="ui-spinner" aria-hidden="true" /></Show></span>
    <Show when={props.summary} fallback={<><Show when={props.verb}><span class="ui-step-verb">{props.verb}</span></Show><Show when={props.subject}><code class="ui-step-subject">{props.subject}</code></Show></>}><span class="ui-step-summary">{props.summary}</span></Show>
    <span class="ui-step-meta"><For each={flags()}>{(flag) => <span class="ui-step-flag" title={flag === NOT_KEPT ? "Interrupted — the agent has no record of this" : undefined}>{flag}</span>}</For><Show when={props.time}><span class="ui-step-time">{props.time}</span></Show></span>
  </>;
  return <li class="ui-disclosure ui-step-item" data-open={props.open && opens() ? "true" : "false"} data-state={props.state} data-note={props.note ? "" : undefined} data-discarded={props.discarded ? "" : undefined} {...motionOf(props.motion)}>
    <Show when={opens()} fallback={<div class="ui-step">{row()}</div>}>
      <button type="button" class="ui-step" aria-label={props.label} aria-expanded={Boolean(props.open)} onClick={() => props.onToggle?.()}>{row()}<ChevronDownIcon class="ui-disclosure-chevron" /></button>
      <div class="ui-disclosure-body ui-step-body" aria-hidden={!props.open}>{body()}</div>
    </Show>
  </li>;
}
/** What a tool step opens to: its output in mono, scrolling; cut to a preview, `hidden` characters behind Show full output. */
export function StepOutput(props: { text: string; hidden?: number; full?: boolean; onToggleFull?: () => void }) {
  return <>
    <pre class="ui-step-output">{props.text}</pre>
    <Show when={props.hidden}><Button variant="ghost" size="sm" class="ui-step-more" onClick={() => props.onToggleFull?.()}>{props.full ? "Show preview" : `Show full output · ${props.hidden} hidden characters`}</Button></Show>
  </>;
}
/** What a thinking or narration step opens to: its whole text, the Answer's prose a step quieter. */
export const StepProse = (props: { children: JSX.Element }) => <div class="ui-step-prose">{props.children}</div>;
/** A failed request in the trail: what failed, when, on what, and the error. */
export function TraceError(props: { time?: string; facts?: string[]; message: string }) {
  return <li class="ui-trace-error"><div class="ui-trace-error-head"><TriangleAlertIcon /><b>Request failed</b><Show when={props.time}><time>{props.time}</time></Show></div>
    <Show when={props.facts?.length}><div class="ui-trace-error-facts"><For each={props.facts}>{(fact) => <span>{fact}</span>}</For></div></Show>
    <pre>{props.message}</pre></li>;
}
/** A message's action row: its time first, muted and tabular, then its actions (icon-xs ghost buttons). */
/** status: how the answer ended when it did not finish (Interrupted, Stopping…), after the time. */
export const MessageFoot = (props: { time: string; status?: string; end?: boolean; motion?: Motion; children?: JSX.Element }) =>
  <div class="ui-message-foot" data-end={props.end ? "" : undefined} {...motionOf(props.motion)}><time>{props.time}</time><Show when={props.status}><b class="ui-message-status">{props.status}</b></Show>{props.children}</div>;
/** In an answer's place, one stopped before writing any: the stop mark, Interrupted, and when. */
export const StopLine = (props: { detail: string }) =>
  <div class="ui-stop-line" role="status"><SquareIcon aria-hidden="true" /><b>Interrupted</b>{`\u00a0· ${props.detail}`}</div>;
/** A turn: the trace header, the answer and its foot, one gap apart. */
export const Turn = (props: { children: JSX.Element }) => <article class="ui-turn">{props.children}</article>;
/** The user's message: its Bubble and, under it at the right, its foot. */
export const Message = (props: { time: string; actions?: JSX.Element; motion?: Motion; children: JSX.Element }) =>
  <article class="ui-message" {...motionOf(props.motion)}><Bubble>{props.children}</Bubble><MessageFoot time={props.time} end>{props.actions}</MessageFoot></article>;
/** The reading column: the composer's width, its gutter, one gap between messages. */
export const Transcript = (props: { children: JSX.Element; class?: string }) => <div class={cn("ui-transcript", props.class)}>{props.children}</div>;


/* What sits on a surface: the look follows [data-surface] above it (library.css). */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
/** outline: the variant as a line in its colour with nothing inside (primary, ghost, destructive; secondary is already a line round a well). */
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; outline?: boolean; size?: "default" | "sm" | "icon" | "icon-sm" | "icon-xs" }) {
  const [local, rest] = splitProps(props, ["class", "variant", "outline", "size"]);
  return <button type="button" data-slot="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-outline={local.outline ? "" : undefined} data-size={local.size ?? "default"} />;
}

/** Multi-line text that grows with its lines: bare, the type's size, no geometry of its own -- what holds it pads it (DesktopComposer, PillField). */
export function TextArea(props: { placeholder?: string; value?: string; onInput?: (value: string) => void; class?: string }) {
  return <textarea class={cn("ui-textarea", props.class)} rows={1} placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />;
}

/** A field's name over its control: Caption type, --card-pair above it. */
export function Field(props: { label: string; children: JSX.Element }) {
  return <label class="ui-field"><span class="ui-field-label">{props.label}</span>{props.children}</label>;
}

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={cn("ui-input", local.class)} />;
}

/** A select's trigger: a field with a chevron, or bare (its value and a chevron, as in a settings row). */
export function SelectTrigger(props: { value: string; bare?: boolean; onClick?: () => void }) {
  return <button type="button" class="ui-input" data-bare={props.bare ? "" : undefined} onClick={props.onClick}><span>{props.value}</span><ChevronDownIcon /></button>;
}

export function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; count?: number }>; onChange: (value: T) => void; size?: "sm"; pill?: boolean; icons?: boolean }) {
  const index = () => Math.max(0, props.options.findIndex((option) => option.value === props.value));
  return <div role="radiogroup" aria-label={props.label} class={props.pill ? "ui-seg ui-frost" : "ui-seg"} data-pill={props.pill ? "" : undefined} data-icons={props.icons || props.pill ? "" : undefined} data-size={props.size}
    style={{ "--segments": props.options.length, "--segment": index() }}>
    <span class="ui-seg-thumb" aria-hidden="true" />
    <For each={props.options}>{(option) => <button type="button" role="radio" aria-checked={option.value === props.value} aria-label={props.icons || props.pill ? option.label : undefined} title={props.icons || props.pill ? option.label : undefined}
      onClick={() => props.onChange(option.value)}>{option.icon}{props.icons || props.pill ? null : <span>{option.label}</span>}{option.count !== undefined && <small>{option.count}</small>}</button>}</For>
  </div>;
}

/**
 * One choice from an ordered list, set by sliding along it (the app's
 * StepSlider, at the library's density). The value follows the thumb and is
 * chosen on release; with onOpen the value is an item that opens the levels.
 */
export function Slider(props: { label: string; options: { value: string; label: string }[]; value: string; disabled?: boolean; onChange: (value: string) => void; onOpen?: () => void }) {
  const id = createUniqueId();
  const indexOf = (value: string) => Math.max(0, props.options.findIndex((option) => option.value === value));
  const [preview, setPreview] = createSignal(indexOf(props.value));
  createEffect(() => setPreview(indexOf(props.value)));
  const shown = () => props.options[preview()]?.label ?? "";
  const commit = (index: number) => { const option = props.options[index]; if (option && option.value !== props.value) props.onChange(option.value); };
  return <div class="ui-slider" data-disabled={props.disabled ? "" : undefined}
    onKeyDown={(event) => { if (event.target instanceof HTMLInputElement && event.key !== "Escape" && event.key !== "Tab") event.stopPropagation(); }}>
    <div class="ui-slider-head">
      <label for={id} class="ui-title-text">{props.label}</label>
      <Show when={props.onOpen} fallback={<span class="ui-slider-value">{shown()}</span>}>
        <button type="button" class="ui-slider-value" data-opens disabled={props.disabled} onClick={() => props.onOpen?.()}>{shown()}<ChevronRightIcon /></button>
      </Show>
    </div>
    <input id={id} class="ui-slider-input" type="range" min={0} max={Math.max(0, props.options.length - 1)} step={1} value={preview()} disabled={props.disabled} aria-valuetext={shown()}
      style={{ "--fill": `${props.options.length > 1 ? (preview() / (props.options.length - 1)) * 100 : 0}%` }}
      onInput={(event) => setPreview(Number(event.currentTarget.value))} onChange={(event) => commit(Number(event.currentTarget.value))} />
    <div class="ui-slider-ticks" aria-hidden="true"><For each={props.options}>{(_, index) => <i data-reached={index() <= preview() ? "" : undefined} />}</For></div>
  </div>;
}

/** A group of nav rows (the sidebar's), with its label. */
export function NavGroup(props: { label?: string; children: JSX.Element }) {
  return <section class="ui-nav-group"><Show when={props.label}><div class="ui-nav-label">{props.label}</div></Show>{props.children}</section>;
}

/** A nav row: icon, label, an optional toggle at the end; indent under the row it belongs to. */
export function NavRow(props: { icon?: JSX.Element; indent?: boolean; current?: boolean; toggle?: JSX.Element; onClick?: () => void; children: JSX.Element }) {
  return <div role="link" class="ui-nav-row" data-indent={props.indent ? "" : undefined} aria-current={props.current ? "page" : undefined} onClick={props.onClick}>
    <Show when={props.icon}><span class="ui-nav-icon">{props.icon}</span></Show><span>{props.children}</span>
    <Show when={props.toggle}><span class="ui-nav-toggle">{props.toggle}</span></Show>
  </div>;
}
