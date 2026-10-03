import { R_MAX, R_MIN, diskTemp, massOf, omega, snowLine, solidsOf, toAU, toWorld, type Body, type DiskSave, type Stuff } from '../core/state';
import { Rng, TAU, angDiff, clamp, smoothstep } from '../util';

export type Tool = 'gather' | 'heat' | 'cool' | 'nudge';

const NR = 36;
const NT = 24;
const LOG_SPAN = Math.log(R_MAX / R_MIN);
const rBin = (r: number) => Math.max(0, Math.min(NR - 1, Math.floor((Math.log(r / R_MIN) / LOG_SPAN) * NR)));
const tBin = (th: number) => Math.floor((((th % TAU) + TAU) % TAU) / TAU * NT) % NT;

/** Gas fades from the disk over this many seconds (the young star's light blows it away). */
const GAS_LIFETIME = 480;
/** Formation ends when this share of the solid material is still loose. */
export const FREE_TARGET = 0.12;

export const TOOL_RADIUS: Record<Tool, number> = { gather: 5.5, heat: 8, cool: 8, nudge: 5 };

/** Gas a body can hold on to: small bodies lose it, big cores swallow it. */
const gasRetention = (m: number) => 0.02 + 0.98 * smoothstep(2.5, 10, m);
const vaporRetention = (m: number) => 0.08 + 0.4 * smoothstep(0.3, 3, m);

export const solidsOfBody = (b: Stuff) => solidsOf(b);
/** Visual radius in world units. */
export function bodyRadius(s: Stuff) {
  const m = Math.max(1e-4, massOf(s));
  const gasFrac = s.gas / m;
  return (0.3 + 0.5 * Math.pow(m, 0.28)) * (1 + 0.7 * smoothstep(0.15, 0.6, gasFrac));
}
/** Capture radius: how close loose material must pass to be swept up (world units). */
export function captureRadius(b: Body) {
  const solids = solidsOf(b);
  const runaway = solids > 6 ? 1.25 : 1;
  return Math.min(4, (0.45 + 0.7 * Math.cbrt(solids) + 0.12 * Math.cbrt(b.gas)) * runaway);
}
/** Width of the band a body clears around its orbit (world units). */
export const feedingZone = (b: Body) => Math.min(8, captureRadius(b) * 2 + 0.8);

export interface FormationEvent {
  kind: 'seed' | 'merge' | 'moon' | 'capture' | 'giant' | 'clump';
  x: number;
  z: number;
  body?: Body;
  other?: Body;
  mass?: number;
}

const emptyStuff = (): Stuff => ({ metal: 0, rock: 0, water: 0, gas: 0, org: 0 });

/**
 * Formation phase: a disk of mixed gas, dust and ice around the young star.
 * Particles are parcels of material on circular orbits; bodies grow by sweeping them up.
 */
export class Formation {
  n: number;
  r: Float32Array;
  th: Float32Array;
  y: Float32Array;
  vr: Float32Array;
  metal: Float32Array;
  rock: Float32Array;
  water: Float32Array;
  gas: Float32Array;
  org: Float32Array;
  alive: Uint8Array;
  /** Per-frame world positions (for rendering and tools). */
  px: Float32Array;
  pz: Float32Array;
  pw: Float32Array;
  /** Local temperature (K) per particle, refreshed each frame. */
  temp: Float32Array;
  heat = new Float32Array(NR * NT);
  cool = new Float32Array(NR * NT);
  initialSolids = 0;
  freeSolids = 0;
  gasLeft = 1;
  bodies: Body[];
  L = 1;
  tool: Tool = 'gather';
  pointer = { x: 0, z: 0, down: false, valid: false };
  clump: (Stuff & { active: boolean }) | null = null;
  private nudgeBody: Body | null = null;
  private nudgeSet: number[] = [];
  private seedTimer = 6;
  private coolTimer = 1;
  private rng: Rng;
  private nextId: () => number;
  onEvent: (e: FormationEvent) => void = () => {};

  constructor(n: number, rng: Rng, bodies: Body[], nextId: () => number) {
    this.n = n;
    this.rng = rng;
    this.bodies = bodies;
    this.nextId = nextId;
    this.r = new Float32Array(n);
    this.th = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vr = new Float32Array(n);
    this.metal = new Float32Array(n);
    this.rock = new Float32Array(n);
    this.water = new Float32Array(n);
    this.gas = new Float32Array(n);
    this.org = new Float32Array(n);
    this.alive = new Uint8Array(n);
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.pw = new Float32Array(n);
    this.temp = new Float32Array(n);
  }

  /** A fresh disk: rock and metal inside, ice beyond the snow line, gas everywhere (more outside). */
  static create(n: number, rng: Rng, nextId: () => number) {
    const f = new Formation(n, rng, [], nextId);
    const w0 = toWorld(R_MIN);
    const w1 = toWorld(R_MAX);
    const snow = snowLine(1);
    const tot = { rm: 0, w: 0, g: 0, o: 0 };
    const raw: [number, number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r = toAU(w0 + (w1 - w0) * Math.pow(rng.next(), 0.92));
      const k = clamp((r - R_MIN) / (R_MAX - R_MIN));
      const rm = (0.6 + 0.5 * k) * rng.range(0.6, 1.4);
      const metalShare = 0.42 - 0.27 * k;
      const ice = r > snow ? rng.range(1.0, 2.2) * (0.8 + 0.4 * k) : rng.range(0.0, 0.08);
      const g = (0.5 + 2.6 * k * k) * rng.range(0.7, 1.3);
      const o = (r > snow ? 0.12 : 0.03) * rng.range(0.6, 1.4);
      raw.push([r, rm, metalShare, ice, g]);
      f.org[i] = o;
      tot.rm += rm;
      tot.w += ice;
      tot.g += g;
      tot.o += o;
    }
    // Normalise to a disk budget (Earth masses): rich enough for a few giants and rocky worlds.
    const RM = 64;
    const W = 52;
    const G = 420;
    const O = 9;
    for (let i = 0; i < n; i++) {
      const [r, rm, ms, ice, g] = raw[i];
      f.r[i] = r;
      f.th[i] = rng.range(0, TAU);
      f.y[i] = rng.gauss(0, 0.12 + 0.03 * toWorld(r) * 0.08);
      const rmM = (rm / tot.rm) * RM;
      f.metal[i] = rmM * ms;
      f.rock[i] = rmM * (1 - ms);
      f.water[i] = (ice / tot.w) * W;
      f.gas[i] = (g / tot.g) * G;
      f.org[i] = (f.org[i] / tot.o) * O;
      f.alive[i] = 1;
    }
    f.initialSolids = RM + W + O;
    f.freeSolids = f.initialSolids;
    return f;
  }

  // ------------------------------------------------------------------ save / load
  save(): DiskSave {
    const per = 9;
    const buf = new Float32Array(this.n * per);
    for (let i = 0; i < this.n; i++) {
      const o = i * per;
      buf[o] = this.alive[i] ? this.r[i] : -1;
      buf[o + 1] = this.th[i];
      buf[o + 2] = this.y[i];
      buf[o + 3] = this.metal[i];
      buf[o + 4] = this.rock[i];
      buf[o + 5] = this.water[i];
      buf[o + 6] = this.gas[i];
      buf[o + 7] = this.org[i];
      buf[o + 8] = this.vr[i];
    }
    return { n: this.n, data: b64(buf), heat: b64(this.heat), cool: b64(this.cool), initialSolids: this.initialSolids, gasLeft: this.gasLeft };
  }

  static load(s: DiskSave, rng: Rng, bodies: Body[], nextId: () => number) {
    const f = new Formation(s.n, rng, bodies, nextId);
    const buf = unb64(s.data);
    for (let i = 0; i < s.n; i++) {
      const o = i * 9;
      f.alive[i] = buf[o] >= 0 ? 1 : 0;
      f.r[i] = Math.max(buf[o], R_MIN);
      f.th[i] = buf[o + 1];
      f.y[i] = buf[o + 2];
      f.metal[i] = buf[o + 3];
      f.rock[i] = buf[o + 4];
      f.water[i] = buf[o + 5];
      f.gas[i] = buf[o + 6];
      f.org[i] = buf[o + 7];
      f.vr[i] = buf[o + 8];
    }
    f.heat.set(unb64(s.heat));
    f.cool.set(unb64(s.cool));
    f.initialSolids = s.initialSolids;
    f.gasLeft = s.gasLeft;
    return f;
  }

  // ------------------------------------------------------------------ helpers
  fieldAt(arr: Float32Array, r: number, th: number) {
    return arr[rBin(r) * NT + tBin(th)];
  }
  private stamp(arr: Float32Array, x: number, z: number, radiusW: number, amount: number) {
    const w = Math.hypot(x, z);
    const th = Math.atan2(z, x);
    // Touch every bin whose centre is inside the tool circle (approximate in polar space).
    for (let ri = 0; ri < NR; ri++) {
      const rc = R_MIN * Math.exp(((ri + 0.5) / NR) * LOG_SPAN);
      const wc = toWorld(rc);
      if (Math.abs(wc - w) > radiusW) continue;
      for (let ti = 0; ti < NT; ti++) {
        const tc = ((ti + 0.5) / NT) * TAU;
        const d = Math.hypot(Math.cos(tc) * wc - x, Math.sin(tc) * wc - z);
        if (d > radiusW + (TAU * wc) / NT * 0.5) continue;
        const k = ri * NT + ti;
        arr[k] = Math.min(3, arr[k] + amount * (1 - Math.min(1, d / (radiusW * 1.4))));
      }
    }
    void th;
  }

  /** Temperature the local parcel feels: star light, warmed or cooled by the player. */
  localTemp(r: number, th: number) {
    const k = rBin(r) * NT + tBin(th);
    return diskTemp(r, this.L) * (1 + 0.45 * this.heat[k]) - 75 * this.cool[k];
  }

  // ------------------------------------------------------------------ player input
  pointerDown(x: number, z: number) {
    this.pointer = { x, z, down: true, valid: true };
    if (this.tool === 'gather') this.clump = { ...emptyStuff(), active: true };
    if (this.tool === 'nudge') {
      let best: Body | null = null;
      let bd = Infinity;
      for (const b of this.bodies) {
        const w = toWorld(b.r);
        const d = Math.hypot(Math.cos(b.th) * w - x, Math.sin(b.th) * w - z);
        if (d < bodyRadius(b) + 3.2 && d < bd) {
          bd = d;
          best = b;
        }
      }
      this.nudgeBody = best;
      this.nudgeSet = [];
      if (!best) {
        for (let i = 0; i < this.n; i++) if (this.alive[i] && Math.hypot(this.px[i] - x, this.pz[i] - z) < TOOL_RADIUS.nudge) this.nudgeSet.push(i);
      }
    }
  }

  pointerMove(x: number, z: number, valid = true) {
    this.pointer.x = x;
    this.pointer.z = z;
    this.pointer.valid = valid;
  }

  pointerUp() {
    this.pointer.down = false;
    if (this.clump) this.releaseClump();
    if (this.nudgeBody) this.nudgeBody.target = null;
    this.nudgeBody = null;
    this.nudgeSet = [];
  }

  /** The body being moved with the nudge tool (to draw its new orbit). */
  get nudging() {
    return this.nudgeBody;
  }

  private releaseClump() {
    const c = this.clump!;
    this.clump = null;
    const solids = solidsOf(c);
    if (solids < 0.008) return;
    const { x, z } = this.pointer;
    // Released next to a body: it simply feeds it.
    for (const b of this.bodies) {
      const w = toWorld(b.r);
      if (Math.hypot(Math.cos(b.th) * w - x, Math.sin(b.th) * w - z) < bodyRadius(b) + 2) {
        this.feed(b, c, false);
        return;
      }
    }
    const m = massOf(c);
    const b: Body = {
      id: this.nextId(),
      r: clamp(toAU(Math.hypot(x, z)), R_MIN, R_MAX),
      th: Math.atan2(z, x),
      target: null,
      moons: [],
      seed: (this.rng.next() * 1e9) | 0,
      born: 0,
      metal: c.metal,
      rock: c.rock,
      org: c.org,
      water: c.water,
      gas: c.gas * gasRetention(m),
    };
    this.bodies.push(b);
    this.onEvent({ kind: 'clump', x, z, body: b, mass: massOf(b) });
  }

  /** Adds material to a body (gas and vapour only partly stay on small bodies). */
  private feed(b: Body, s: Stuff, vapour: boolean) {
    const m = massOf(b);
    const wasGiant = b.gas > 15;
    b.metal += s.metal;
    b.rock += s.rock;
    b.org += s.org;
    b.water += vapour ? s.water * vaporRetention(m) : s.water;
    b.gas += s.gas * (solidsOf(b) > 6 ? 1 : gasRetention(m));
    if (!wasGiant && b.gas > 15) {
      const w = toWorld(b.r);
      this.onEvent({ kind: 'giant', x: Math.cos(b.th) * w, z: Math.sin(b.th) * w, body: b });
    }
  }

  private absorbParticle(i: number, into: Stuff, vapour: boolean) {
    into.metal += this.metal[i];
    into.rock += this.rock[i];
    into.org += this.org[i];
    into.water += vapour ? this.water[i] * 0.25 : this.water[i];
    into.gas += this.gas[i];
    this.alive[i] = 0;
  }

  // ------------------------------------------------------------------ simulation
  update(dt: number) {
    const n = this.n;
    const { r, th, vr, alive, px, pz, pw, temp } = this;
    const ptr = this.pointer;
    const tool = this.tool;
    const active = ptr.down && ptr.valid;
    const radius = TOOL_RADIUS[tool];
    if (active && tool === 'heat') this.stamp(this.heat, ptr.x, ptr.z, radius, dt * 2.2);
    if (active && tool === 'cool') this.stamp(this.cool, ptr.x, ptr.z, radius, dt * 2.2);
    const hd = Math.exp(-dt * 0.22);
    const cd = Math.exp(-dt * 0.08);
    for (let k = 0; k < this.heat.length; k++) {
      this.heat[k] *= hd;
      this.cool[k] *= cd;
    }
    const gasDecay = Math.exp(-dt / GAS_LIFETIME);
    this.gasLeft *= gasDecay;
    let free = 0;
    const clump = this.clump;
    const capClump = clump ? 1.3 + 0.8 * Math.cbrt(massOf(clump)) : 0;

    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      let ri = r[i];
      ri += vr[i] * dt;
      vr[i] *= Math.exp(-dt * 1.4);
      if (ri < R_MIN * 0.85) {
        alive[i] = 0; // fell into the star
        continue;
      }
      if (ri > R_MAX * 1.25) {
        ri = R_MAX * 1.25;
        vr[i] = 0;
      }
      let ti = th[i] + omega(ri) * dt;
      this.gas[i] *= gasDecay;
      const T = this.localTemp(ri, ti);
      temp[i] = T;
      // Water vapour in the hot inner disk slowly escapes.
      if (T > 190 && this.water[i] > 0) this.water[i] *= Math.exp(-dt / 160);
      let w = toWorld(ri);
      let x = Math.cos(ti) * w;
      let z = Math.sin(ti) * w;

      if (active) {
        const dx = ptr.x - x;
        const dz = ptr.z - z;
        const d = Math.hypot(dx, dz);
        if (d < radius) {
          const s = 1 - d / radius;
          if (tool === 'gather' && clump) {
            if (d < capClump) {
              this.absorbParticle(i, clump, T > 170);
              continue;
            }
            const k = Math.min(1, s * s * 3 * dt);
            x += dx * k;
            z += dz * k;
            w = Math.hypot(x, z);
            ri = toAU(w);
            ti = Math.atan2(z, x);
          } else if (tool === 'heat') {
            const light = (this.gas[i] + (T > 170 ? this.water[i] : 0)) / Math.max(1e-6, this.massAt(i));
            vr[i] += s * (0.25 + 1.4 * light) * dt * (0.4 + ri * 0.12);
            this.gas[i] *= Math.exp(-s * dt * 0.6);
          } else if (tool === 'cool') {
            vr[i] *= Math.exp(-dt * 3 * s);
          }
        }
      }
      r[i] = ri;
      th[i] = ti;
      px[i] = x;
      pz[i] = z;
      pw[i] = w;
      free += this.metal[i] + this.rock[i] + this.water[i] + this.org[i];
    }

    // Nudge: drag a body (or a cloud of material) to a new orbit.
    if (active && tool === 'nudge') {
      const wt = Math.hypot(ptr.x, ptr.z);
      if (this.nudgeBody) this.nudgeBody.target = clamp(toAU(wt), R_MIN * 1.05, R_MAX);
      else
        for (const i of this.nudgeSet) {
          if (!alive[i]) continue;
          const nw = pw[i] + (wt - pw[i]) * Math.min(1, dt * 2.5);
          r[i] = toAU(nw);
          vr[i] = 0;
        }
    }

    this.updateBodies(dt);
    this.freeSolids = free;
    this.spontaneous(dt);
  }

  private massAt(i: number) {
    return this.metal[i] + this.rock[i] + this.water[i] + this.gas[i] + this.org[i];
  }

  private updateBodies(dt: number) {
    const { r, th, alive, px, pz, pw, temp } = this;
    const bodies = this.bodies;
    for (const b of bodies) {
      b.born += dt;
      if (b.target !== null) {
        const w = toWorld(b.r);
        const wt = toWorld(b.target);
        b.r = toAU(w + (wt - w) * Math.min(1, dt * 3));
      }
      b.th += omega(b.r) * dt;
      const bw = toWorld(b.r);
      const bx = Math.cos(b.th) * bw;
      const bz = Math.sin(b.th) * bw;
      const cap = captureRadius(b);
      const zone = feedingZone(b);
      const pull = Math.min(0.55, 0.08 + 0.12 * Math.cbrt(solidsOf(b)));
      const feedS = emptyStuff();
      let fed = false;
      for (let i = 0; i < this.n; i++) {
        if (!alive[i]) continue;
        const dw = pw[i] - bw;
        if (dw > zone || dw < -zone) continue;
        const d = Math.hypot(px[i] - bx, pz[i] - bz);
        if (d < cap) {
          this.absorbParticle(i, feedS, temp[i] > 170);
          fed = true;
          continue;
        }
        // Material in the feeding zone drifts along the orbit towards the body (and opens a gap).
        const da = angDiff(th[i], b.th);
        const k = pull * (1 - Math.abs(dw) / zone);
        th[i] += Math.sign(da) * Math.min(Math.abs(da), k * dt * (0.2 / (0.4 + Math.abs(da))));
        // Right next to the body its gravity wins: close neighbours fall in instead of piling up.
        const near = Math.abs(da) < 0.12 ? 0.9 : 0.028;
        r[i] += (b.r - r[i]) * Math.min(1, dt * near * k);
      }
      if (fed) this.feed(b, feedS, false);
    }

    // Bodies on crossing orbits meet and merge.
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const c = bodies[j];
        const big = massOf(a) >= massOf(c) ? a : c;
        const small = big === a ? c : a;
        const wb = toWorld(big.r);
        const ws = toWorld(small.r);
        const bx = Math.cos(big.th) * wb;
        const bz = Math.sin(big.th) * wb;
        const sx = Math.cos(small.th) * ws;
        const sz = Math.sin(small.th) * ws;
        const d = Math.hypot(bx - sx, bz - sz);
        if (d < (bodyRadius(big) + bodyRadius(small)) * 0.95) {
          this.collide(big, small, (bx + sx) / 2, (bz + sz) / 2);
          return; // arrays changed; continue next frame
        }
        const overlap = (captureRadius(big) + captureRadius(small)) * 0.42;
        if (Math.abs(wb - ws) < overlap && small.target === null) {
          small.r += (big.r - small.r) * Math.min(1, dt * 0.6);
          const da = angDiff(small.th, big.th);
          small.th += Math.sign(da) * Math.min(Math.abs(da), dt * 0.32);
        }
      }
    }
  }

  private collide(big: Body, small: Body, x: number, z: number) {
    const mb = massOf(big);
    const ms = massOf(small);
    const q = ms / mb;
    const idx = this.bodies.indexOf(small);
    this.bodies.splice(idx, 1);
    if (this.nudgeBody === small) this.nudgeBody = null;
    // A giant captures small passers-by as moons instead of swallowing them.
    if (mb > 25 && q < 0.04 && big.moons.length < 6 && this.rng.next() < 0.65) {
      big.moons.push({ metal: small.metal, rock: small.rock, water: small.water, gas: 0, org: small.org });
      for (const mm of small.moons) if (big.moons.length < 6) big.moons.push(mm);
      this.onEvent({ kind: 'capture', x, z, body: big, other: small });
      return;
    }
    this.feed(big, small, false);
    for (const mm of small.moons) if (big.moons.length < 6) big.moons.push(mm);
    // Giant impact: the debris can gather into a moon (like our own Moon).
    if (q > 0.04 && q < 0.6 && mb < 30 && big.moons.length < 3 && this.rng.next() < 0.55) {
      const t = (mb + ms) * 0.015;
      const share = t / Math.max(1e-6, mb + ms);
      const moon: Stuff = { metal: big.metal * share * 0.4, rock: big.rock * share * 1.5, water: big.water * share, gas: 0, org: big.org * share };
      big.metal -= moon.metal;
      big.rock = Math.max(0, big.rock - moon.rock);
      big.water -= moon.water;
      big.org -= moon.org;
      big.moons.push(moon);
      this.onEvent({ kind: 'moon', x, z, body: big, other: small });
      return;
    }
    this.onEvent({ kind: 'merge', x, z, body: big, other: small, mass: ms });
  }

  /** Planetesimals also appear on their own where dust is cold enough to stick (ice helps). */
  private spontaneous(dt: number) {
    this.seedTimer -= dt;
    this.coolTimer -= dt;
    const snow = snowLine(this.L);
    if (this.seedTimer <= 0) {
      this.seedTimer = 5 + this.bodies.length * 0.9;
      for (let tries = 0; tries < 16; tries++) {
        const i = (this.rng.next() * this.n) | 0;
        if (!this.alive[i] || this.r[i] < snow * 0.95 || this.temp[i] > 170) continue;
        if (this.formAround(i, 2.6, 0.06)) break;
      }
    }
    if (this.coolTimer <= 0) {
      this.coolTimer = 1.2;
      for (let tries = 0; tries < 24; tries++) {
        const i = (this.rng.next() * this.n) | 0;
        if (!this.alive[i] || this.fieldAt(this.cool, this.r[i], this.th[i]) < 0.7) continue;
        if (this.formAround(i, 2.2, 0.03)) break;
      }
    }
  }

  private formAround(i: number, radius: number, minSolids: number) {
    const x = this.px[i];
    const z = this.pz[i];
    // Never seed on top of an existing body.
    for (const b of this.bodies) {
      const w = toWorld(b.r);
      if (Math.hypot(Math.cos(b.th) * w - x, Math.sin(b.th) * w - z) < bodyRadius(b) + 5) return false;
    }
    const s = emptyStuff();
    const take: number[] = [];
    for (let j = 0; j < this.n; j++) {
      if (!this.alive[j]) continue;
      if (Math.hypot(this.px[j] - x, this.pz[j] - z) < radius) take.push(j);
    }
    let solids = 0;
    for (const j of take) solids += this.metal[j] + this.rock[j] + this.org[j] + (this.temp[j] < 170 ? this.water[j] : 0);
    if (solids < minSolids) return false;
    for (const j of take) this.absorbParticle(j, s, this.temp[j] > 170);
    const m = massOf(s);
    const b: Body = {
      id: this.nextId(),
      r: this.r[i],
      th: this.th[i],
      target: null,
      moons: [],
      seed: (this.rng.next() * 1e9) | 0,
      born: 0,
      metal: s.metal,
      rock: s.rock,
      water: s.water,
      org: s.org,
      gas: s.gas * gasRetention(m),
    };
    this.bodies.push(b);
    this.onEvent({ kind: 'seed', x, z, body: b });
    return true;
  }

  /** Share of the solid material (still in the disk) already gathered into bodies (0..1). */
  get progress() {
    let inBodies = 0;
    for (const b of this.bodies) {
      inBodies += solidsOf(b);
      for (const m of b.moons) inBodies += solidsOf(m);
    }
    return clamp(inBodies / Math.max(1e-6, inBodies + this.freeSolids));
  }
}

function b64(a: Float32Array) {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
