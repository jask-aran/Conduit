// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * A jumping spider loose on the wall. It moves the way salticids do: short bursts that swell and die away,
 * still pauses, quick sprung swivels to face whatever moves. It watches the cursor, edging closer, and if
 * it holds still, crouches and pounces, landing low and springing back up. It stalks resting flies the
 * same way. Every jump pays out a dragline from where it took off.
 */
import type { Fly } from "./flies";
import { angleDiff, clamp, rand, type Vec } from "./math";
import { Spider } from "./spider";
import type { World } from "./world";

export type JumperState = "pause" | "burst" | "crouch" | "jump";

/** What has its attention, and how far off it is. */
interface Interest {
  x: number;
  y: number;
  d: number;
  fly: Fly | null;
}

interface Leap {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  fly: Fly | null;
}

export class Jumper {
  readonly spider: Spider;
  state: JumperState = "pause";
  private timer = rand(0.4, 1.2);
  private goal: Vec | null = null;
  /** How long the target has held still in front of it. */
  private watch = 0;
  private cool = 0;
  private hunger = 0.6;
  /** The dragline paid out from the last take-off, fading once it lands. */
  drag: { x: number; y: number; life: number } | null = null;
  private mark = { x: 0, y: 0 };
  private bt = 0;
  private bdur = 0;
  private bv = 0;
  private crouch: Interest | null = null;
  private jump: Leap | null = null;

  constructor(private world: World, B: number) {
    this.spider = new Spider("jumper", B);
  }

  place(x: number, y: number) {
    this.spider.place(x, y, rand(0, Math.PI * 2));
  }

  /** What has its attention: the cursor, else a resting fly when hungry. */
  private interest(): Interest | null {
    const { pointer, swarm } = this.world;
    const sp = this.spider;
    if (pointer.active) {
      const d = Math.hypot(pointer.x - sp.x, pointer.y - sp.y);
      if (d < 440) return { x: pointer.x, y: pointer.y, d, fly: null };
    }
    if (this.hunger < 0.35) return null;
    let best: Interest | null = null;
    for (const f of swarm.flies) {
      if (f.mode !== "rest") continue;
      const d = Math.hypot(f.x - sp.x, f.y - sp.y);
      if (d < 480 && (!best || d < best.d)) best = { x: f.x, y: f.y, d, fly: f };
    }
    return best;
  }

  update(dt: number) {
    const sp = this.spider;
    const { width: W, height: H } = this.world;
    const px = sp.x;
    const py = sp.y;
    const s = sp.B / 60;
    this.hunger = Math.min(1, this.hunger + dt * 0.02);
    this.cool = Math.max(0, this.cool - dt);
    if (this.drag) {
      this.drag.life -= dt * (this.state === "jump" ? 0 : 0.35);
      if (this.drag.life <= 0) this.drag = null;
    }
    let scaleTo = 1;

    if (this.state === "jump" && this.jump) {
      const j = this.jump;
      j.t = Math.min(1, j.t + dt / j.dur);
      const e = 1 - (1 - j.t) ** 2.4;
      sp.x = j.x0 + (j.x1 - j.x0) * e;
      sp.y = j.y0 + (j.y1 - j.y0) * e;
      sp.scale = 1 + 0.3 * Math.sin(Math.PI * j.t);
      scaleTo = sp.scale;
      if (j.t >= 1) {
        sp.airborne = false;
        sp.scale = 0.9; // lands low, and springs back up
        sp.place(sp.x, sp.y, sp.h);
        this.state = "pause";
        this.timer = rand(0.6, 1.2);
        const f = j.fly;
        if (f && f.mode === "rest" && Math.hypot(f.x - sp.x, f.y - sp.y) < sp.B * 0.7) {
          f.mode = "gone";
          f.respawn = rand(3, 7);
          this.world.burst(f.x, f.y);
          this.hunger = 0;
          this.timer = 1.8;
        }
      }
    } else if (this.state === "crouch" && this.crouch) {
      // Settle low on the legs for a beat, then go.
      this.timer -= dt;
      scaleTo = 0.88;
      sp.steer(Math.atan2(this.crouch.y - sp.y, this.crouch.x - sp.x), dt, 160);
      if (this.timer <= 0) this.leap(this.crouch);
    } else {
      const it = this.interest();
      let goal: Vec;
      let near = sp.B * 1.2;
      if (it) {
        const still = it.fly ? true : Math.hypot(it.x - this.mark.x, it.y - this.mark.y) < 10;
        if (!still) (this.mark.x = it.x), (this.mark.y = it.y), (this.watch = 0);
        goal = it;
        near = sp.B * 4.2;
      } else {
        this.watch = 0;
        if (!this.goal || Math.hypot(this.goal.x - sp.x, this.goal.y - sp.y) < sp.B * 1.2) {
          const m = sp.B * 1.6;
          this.goal = { x: rand(m, W - m), y: rand(m, H - m) };
        }
        goal = this.goal;
      }
      const face = Math.atan2(goal.y - sp.y, goal.x - sp.x);
      const d = Math.hypot(goal.x - sp.x, goal.y - sp.y);
      // Swivel to face it: quick, sprung, as salticids do.
      sp.steer(face, dt, it ? 110 : 45);
      const aligned = Math.abs(angleDiff(sp.h, face)) < 0.22;
      if (this.state === "burst") {
        // A burst: speed swells and dies away along a sine, then a still pause.
        this.bt += dt;
        const k = this.bt / this.bdur;
        const v = this.bv * Math.sin(Math.PI * Math.min(1, k)) ** 1.4;
        sp.x += Math.cos(sp.h) * v * dt;
        sp.y += Math.sin(sp.h) * v * dt;
        if (k >= 1 || d < near * 0.85) {
          this.state = "pause";
          this.timer = it ? rand(0.35, 0.9) : rand(0.7, 2.6);
        }
      } else {
        this.timer -= dt;
        if (it && d <= near && aligned) {
          this.watch += dt;
          if (this.watch > (it.fly ? 0.45 : 0.9) && this.cool <= 0 && d > sp.B * 0.9) {
            this.state = "crouch";
            this.timer = 0.26;
            this.crouch = it;
          }
        } else if (this.timer <= 0 && d > near && aligned) {
          this.state = "burst";
          this.bt = 0;
          this.bdur = it ? rand(0.45, 0.8) : rand(0.7, 1.4);
          this.bv = (it ? 55 : 62) * s * rand(0.85, 1.15);
        }
      }
    }
    if (this.state !== "jump") sp.scale += (scaleTo - sp.scale) * (1 - Math.exp(-dt * 14));

    const m = sp.B * 0.8;
    sp.x = clamp(sp.x, m, W - m);
    sp.y = clamp(sp.y, m, H - m);
    sp.vx = (sp.x - px) / Math.max(dt, 1e-4);
    sp.vy = (sp.y - py) / Math.max(dt, 1e-4);
    sp.updateLegs(dt);
  }

  private leap(it: Interest) {
    const sp = this.spider;
    // Land just short of a fly; right on the cursor.
    const short = it.fly ? sp.B * 0.35 : sp.B * 0.2;
    const a = Math.atan2(it.y - sp.y, it.x - sp.x);
    const d = Math.max(0, Math.hypot(it.x - sp.x, it.y - sp.y) - short);
    this.jump = { x0: sp.x, y0: sp.y, x1: sp.x + Math.cos(a) * d, y1: sp.y + Math.sin(a) * d, t: 0, dur: 0.32 + d / 700, fly: it.fly };
    this.drag = { x: sp.x, y: sp.y, life: 1 };
    sp.airborne = true;
    this.state = "jump";
    this.watch = 0;
    this.cool = it.fly ? 0.5 : 2.6;
  }
}
