import { R_MAX, R_MIN, massOf, sysWorld, toAU, toWorld, type Encounter, type GameState, type NewsFocus, type World } from '../core/state';
import { moonOrbit, worldRadius } from '../render/layout';
import { Rng, clamp, smoothstep } from '../util';
import { isGiantStuff } from './worlds';
import { moonName, worldName } from '../content/names';
import { peopleOf, type PeopleSim } from './peoples';

/*
 * Orbits, pulls and collisions in the finished system. Every planet rules a band around its orbit
 * that widens with its mass; a lighter world inside a heavier one's band cannot stay there: it either
 * crashes into it or, if it is small enough, ends up orbiting it as a moon. Everything is measured
 * in world units of the old, tight map, so the player's "distance between worlds" only changes the
 * drawing, never the outcome.
 */

/** Moons a planet can hold. */
export const MAX_MOONS = 6;
/** A world this much lighter than its neighbour (or less) is captured as its moon instead of crashing. */
export const MOON_RATIO = 0.1;
/** A stable orbit closer than this share of the band is "on the edge" (it is only a warning). */
export const EDGE = 1.15;
/** A migration that ends this close (world units) to a stable orbit settles into it. */
export const SNAP = 0.6;
/** Stable orbits are searched for in steps of this many world units. */
const STEP = 0.05;
/** A safe margin over the band's edge for the orbits offered as stable. */
const SAFE = 1.03;
/** When the worlds settle, neighbours spread out to at least this many bands apart (room to migrate). */
const SETTLE_GAP = 1.6;
/** When the worlds settle, pairs deeper than this share of their band are left to meet later… */
const DEEP = 0.6;
/** …but no more than this many. */
const DEEP_MAX = 2;

/**
 * How far a world's look reaches from its centre: the planet, its ring and part of its moons. Measured
 * on the old, tight map: orbits spaced for it stay clear at any spread the player picks.
 */
export function reach(w: World, worlds: World[]) {
  const body = worldRadius(w) * (w.ring ? 2.2 : 1.15);
  const moons = worlds.filter((m) => m.parent === w.id).length;
  return moons ? Math.max(body, moonOrbit(w, moons - 1, 1) * 0.7 + 0.5) : body;
}

/** Room two neighbouring planets need so they never overlap on screen (world units). */
export const clearance = (a: World, b: World, worlds: World[]) => reach(a, worlds) + reach(b, worlds) + 2;

/** The heavier of two worlds first. */
const heavier = (a: World, b: World): [World, World] => (massOf(a) >= massOf(b) ? [a, b] : [b, a]);

/**
 * The band a planet rules around its orbit, against a given neighbour (world units, no spread): a
 * lighter world closer than this cannot keep its orbit. For worlds up to an Earth it is the old fixed
 * rule; heavier worlds rule a wider band (with the cube root of their mass).
 */
export function captureDist(a: World, b: World) {
  const [B, S] = heavier(a, b);
  return 1.2 * (worldRadius(B) + worldRadius(S)) + 0.6 + 0.8 * Math.max(0, Math.cbrt(massOf(B)) - 1);
}

/** Distance between two planets' orbits (world units, no spread). */
export const gapOf = (a: World, b: World) => Math.abs(toWorld(a.a) - toWorld(b.a));

/** One of the two lies inside the other's band. */
export const inBand = (a: World, b: World) => gapOf(a, b) < captureDist(a, b);

/** How a meeting ends: a light enough world becomes the heavier one's moon (if it has room); otherwise they crash. */
export function outcomeOf(a: World, b: World, worlds: World[]): 'moon' | 'impact' {
  const [B, S] = heavier(a, b);
  const moons = worlds.filter((m) => m.parent === B.id).length;
  return massOf(S) <= MOON_RATIO * massOf(B) && moons < MAX_MOONS ? 'moon' : 'impact';
}

const planetsOf = (worlds: World[]) => worlds.filter((w) => w.parent === null).sort((x, y) => x.a - y.a);

export interface OrbitState {
  /** stable · stable but close to a band (edge) · inside a band (unstable). */
  state: 'stable' | 'edge' | 'unstable';
  /** The neighbour that decides it (the closest one, measured in bands). */
  other?: World;
  /** Gap over band with that neighbour (≥ 1: outside its band). */
  margin: number;
  /** When unstable: how it would end. */
  outcome?: 'moon' | 'impact';
}

/** How safe a planet's orbit is (or would be at radius `a`, in AU), against its neighbours there. */
export function orbitState(w: World, worlds: World[], a = w.a): OrbitState {
  if (w.parent !== null) return { state: 'stable', margin: Infinity };
  const test = a === w.a ? w : { ...w, a };
  let inner: World | undefined;
  let outer: World | undefined;
  for (const p of worlds) {
    if (p.parent !== null || p.id === w.id) continue;
    if (p.a <= a) {
      if (!inner || p.a > inner.a) inner = p;
    } else if (!outer || p.a < outer.a) outer = p;
  }
  let worst: OrbitState = { state: 'stable', margin: Infinity };
  for (const n of [inner, outer]) {
    if (!n) continue;
    const m = gapOf(test, n) / captureDist(test, n);
    if (m < worst.margin) worst = { state: 'stable', margin: m, other: n };
  }
  if (worst.margin < 1) {
    worst.state = 'unstable';
    worst.outcome = outcomeOf(test, worst.other!, worlds);
  } else if (worst.margin < EDGE) worst.state = 'edge';
  return worst;
}

/** The stretches of the system where a planet would be stable, as [inner, outer] radii in AU. */
export function stableZones(w: World, worlds: World[]): [number, number][] {
  const out: [number, number][] = [];
  const lo = toWorld(R_MIN * 1.05);
  const hi = toWorld(R_MAX);
  let open: number | null = null;
  for (let x = lo; x <= hi + 1e-9; x += STEP) {
    const ok = orbitState(w, worlds, toAU(x)).margin >= SAFE;
    if (ok && open === null) open = x;
    if ((!ok || x + STEP > hi) && open !== null) {
      out.push([toAU(open), toAU(ok ? x : x - STEP)]);
      open = null;
    }
  }
  return out;
}

/**
 * The next stable orbits inwards and outwards (AU). From an unstable orbit, the nearest way out of the
 * band; from a stable one, the nearest stable stretch beyond the one it is in.
 */
export function nearestStable(w: World, worlds: World[], zones = stableZones(w, worlds)) {
  const here = zones.find(([lo, hi]) => w.a >= lo - 1e-6 && w.a <= hi + 1e-6);
  let inner: number | undefined;
  let outer: number | undefined;
  for (const [lo, hi] of zones) {
    if (zones.indexOf(here!) >= 0 && lo === here![0]) continue;
    if (hi < w.a && (inner === undefined || hi > inner)) inner = hi;
    if (lo > w.a && (outer === undefined || lo < outer)) outer = lo;
  }
  return { inner, outer, here: !!here };
}

/** A stable orbit within reach of `a` (world units of SNAP), or null. */
export function snapStable(w: World, worlds: World[], a: number) {
  const x0 = toWorld(a);
  for (let d = STEP; d <= SNAP + 1e-9; d += STEP) {
    for (const x of [x0 - d, x0 + d]) {
      const t = toAU(x);
      if (t < R_MIN * 1.05 || t > R_MAX) continue;
      if (orbitState(w, worlds, t).margin >= SAFE) return t;
    }
  }
  return null;
}

/**
 * When the worlds settle they spread out into roomy, stable orbits: each pair of neighbours ends at
 * least SETTLE_GAP bands apart (or as far as their looks need), both moving (the heavier less), within
 * the edges of the system. Up to two pairs deep inside a band are left alone: they will meet later, in
 * play. If the system has no room for all of them, any other pair still inside a band meets at once,
 * before the system is shown, as it would have during the formation: the lighter world becomes the
 * heavier one's moon, or the two become one; then the rest spread out again.
 */
export function spaceOrbits(worlds: World[]) {
  const left = new Set<string>();
  // The pairs left to meet later are chosen first, among those deepest in a band.
  {
    const planets = planetsOf(worlds);
    const deep = [];
    for (let i = 0; i < planets.length - 1; i++) {
      const A = planets[i];
      const B = planets[i + 1];
      const r = gapOf(A, B) / captureDist(A, B);
      if (r < DEEP) deep.push({ key: `${A.id}:${B.id}`, r });
    }
    deep.sort((x, y) => x.r - y.r);
    for (const d of deep.slice(0, DEEP_MAX)) left.add(d.key);
  }
  for (let pass = 0; pass < 64; pass++) {
    spread(worlds, left);
    // A pair still inside a band that was not left to meet later meets now; then spread out again.
    const now = planetsOf(worlds);
    let met = false;
    for (let i = 0; i < now.length - 1 && !met; i++) {
      const A = now[i];
      const B = now[i + 1];
      if (left.has(`${A.id}:${B.id}`) || !inBand(A, B)) continue;
      settleMeet(A, B, worlds);
      met = true;
    }
    if (!met) break;
  }
}

/** Pushes neighbours apart, both ways, until every pair (but those left to meet) has its room. */
function spread(worlds: World[], left: Set<string>) {
  const lo = toWorld(R_MIN * 1.05);
  const hi = toWorld(R_MAX * 1.2);
  for (let iter = 0; iter < 400; iter++) {
    const planets = planetsOf(worlds);
    const x = planets.map((p) => toWorld(p.a));
    let moved = false;
    for (let i = 0; i < planets.length - 1; i++) {
      const A = planets[i];
      const B = planets[i + 1];
      if (left.has(`${A.id}:${B.id}`)) continue;
      const need = Math.max(clearance(A, B, worlds), captureDist(A, B) * SETTLE_GAP);
      const gap = x[i + 1] - x[i];
      if (gap >= need - 1e-3) continue;
      // Half the shortfall each round, shared by mass (the heavier moves less), within the system.
      const short = (need - gap) * 0.5;
      const mA = massOf(A);
      const mB = massOf(B);
      let inA = (short * mB) / (mA + mB);
      let outB = short - inA;
      if (x[i] - inA < lo) {
        outB += inA - (x[i] - lo);
        inA = x[i] - lo;
      }
      if (x[i + 1] + outB > hi) {
        inA = Math.min(x[i] - lo, inA + (x[i + 1] + outB - hi));
        outB = hi - x[i + 1];
      }
      if (inA <= 1e-6 && outB <= 1e-6) continue;
      x[i] -= inA;
      x[i + 1] += outB;
      moved = true;
    }
    planets.forEach((p, i) => (p.a = toAU(x[i])));
    if (!moved) break;
  }
}

/** Two worlds meet before the system is shown: a moon caught, or one world made of both (no fanfare). */
function settleMeet(a: World, b: World, worlds: World[]) {
  const [big, small] = heavier(a, b);
  const moon = outcomeOf(a, b, worlds) === 'moon';
  let n = worlds.filter((m) => m.parent === big.id).length;
  if (moon) {
    small.parent = big.id;
    small.a = n++;
  } else {
    big.metal += small.metal;
    big.rock += small.rock;
    big.water += small.water;
    big.gas += small.gas;
    big.org += small.org;
  }
  // The small world's moons join the big one while there is room; the rest are lost.
  for (const m of worlds.filter((x) => x.parent === small.id)) {
    if (n < MAX_MOONS) {
      m.parent = big.id;
      m.a = n++;
    } else worlds.splice(worlds.indexOf(m), 1);
  }
  if (!moon) worlds.splice(worlds.indexOf(small), 1);
}

export type OrbitFx = { kind: 'collision'; world: number; x: number; z: number; big: boolean } | { kind: 'capture'; world: number; x: number; z: number } | { kind: 'stable'; world: number };

/** What the collisions need from the system. */
export interface OrbitHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  world(id: number): World | undefined;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact', focus?: NewsFocus): void;
  fx(f: OrbitFx): void;
  launch(from: number, to: number, alien: boolean, dur?: number, people?: number): void;
  removeWorld(id: number): void;
  /** A blow that kills a share of everyone on a world. */
  kill(w: World, frac: number): number;
  readonly peoples: PeopleSim;
}

const wrap = (d: number) => {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Where a planet is drawn right now (the drawing follows the player's spread). */
const drawn = (w: World) => {
  const r = sysWorld(w.a);
  return { x: Math.cos(w.th) * r, z: Math.sin(w.th) * r };
};

/**
 * A lighter world inside a heavier one's band does not keep its orbit: the two drift together, along
 * the orbit and across it at once, until they touch. Then they crash into one molten world (with new
 * moons, rings, sometimes a new planet made of the largest fragment), or the lighter one is caught as
 * a moon. Spacefaring peoples see a crash coming and evacuate.
 */
export class OrbitSim {
  private scanT = 2;

  constructor(private h: OrbitHost) {}

  get list(): Encounter[] {
    return (this.h.s.encounters ??= []);
  }

  busy(id: number) {
    return this.list.some((e) => e.a === id || e.b === id);
  }

  /** The encounter a planet is caught in, if any. */
  encounterOf(id: number) {
    return this.list.find((e) => e.a === id || e.b === id);
  }

  update(dt: number) {
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 3;
      this.scan();
    }
    for (const e of [...this.list]) this.step(e, dt);
  }

  /** Looks for neighbours inside each other's band right now (after a migration, without waiting). */
  scan() {
    const s = this.h.s;
    const planets = planetsOf(s.worlds);
    for (let i = 0; i < planets.length - 1; i++) {
      const A = planets[i];
      const B = planets[i + 1];
      if (this.busy(A.id) || this.busy(B.id) || !inBand(A, B)) continue;
      const D = captureDist(A, B);
      const gap = gapOf(A, B);
      // Deeper inside the band, sooner; several at once are staggered, so each gets its moment.
      const queue = this.list.length * 40;
      const e: Encounter = { id: this.h.nid(), a: A.id, b: B.id, t: 0, dur: 40 + 40 * (gap / D) + this.h.rng.range(0, 10) + queue, a0: A.a, b0: B.a, ea: A.a, eb: B.a };
      this.begin(e, A, B);
      this.list.push(e);
      const [big, small] = heavier(A, B);
      if (e.kind === 'moon')
        this.h.news(
          '☾',
          `${small.name} ha entrado en la zona de ${big.name}: su gravedad lo arrastra. Si nada lo impide, ${small.name} acabará orbitando a ${big.name} como una luna.`,
          `${small.name} has strayed into the reach of ${big.name}: its gravity drags it along. If nothing stops it, ${small.name} will end up orbiting ${big.name} as a moon.`,
          'warn',
          { pair: [A.id, B.id] },
        );
      else {
        this.h.news(
          '⚠',
          `Las órbitas de ${A.name} y ${B.name} están demasiado cerca: sus mundos empiezan a atraerse. Si nada lo impide, chocarán.`,
          `The orbits of ${A.name} and ${B.name} are too close: the two worlds are starting to pull at each other. If nothing stops them, they will collide.`,
          'warn',
          { pair: [A.id, B.id] },
        );
        this.emergency(e, A, B, true);
      }
    }
  }

  /** How it will end and where the lighter world starts along the orbit. */
  private begin(e: Encounter, A: World, B: World) {
    const [big, small] = heavier(A, B);
    e.kind = outcomeOf(A, B, this.h.s.worlds);
    e.dth0 = wrap(small.th - big.th);
  }

  /**
   * Spacefaring peoples on either world declare an emergency and send their people away (checked
   * again during the approach: a people may reach space in the meantime).
   */
  private emergency(e: Encounter, A: World, B: World, first: boolean) {
    const peoples = this.h.peoples;
    for (const [w, other] of [
      [A, B],
      [B, A],
    ] as const) {
      const pid = peopleOf(w);
      const p = peoples.get(pid);
      if (!p) {
        if (first && w.life && w.life.stage >= 1) this.h.news('❦', `La vida de ${w.name} no sabe lo que se le viene encima.`, `Life on ${w.name} has no idea what is coming.`, 'life', { world: w.id });
        continue;
      }
      if (peoples.stage(p) < 4) {
        if (first) this.h.news('❦', `Los ${p.name} de ${w.name} ven crecer en el cielo a ${other.name}. Sus sabios no saben qué significa.`, `The ${p.name} of ${w.name} watch ${other.name} grow in their sky. Their sages do not know what it means.`, 'life', { world: w.id });
        continue;
      }
      if (e.emergency) continue;
      e.emergency = true;
      this.h.news(
        '⚠',
        `¡Estado de emergencia en ${w.name}! Los ${p.name} calculan el choque con ${other.name} y empiezan a evacuar.`,
        `State of emergency on ${w.name}! The ${p.name} calculate the collision with ${other.name} and begin to evacuate.`,
        'warn',
        { world: w.id },
      );
      // Evacuation ships to their other worlds, or to any free world.
      const s = this.h.s;
      const safe = s.worlds.filter((x) => x !== A && x !== B && x.parent !== A.id && x.parent !== B.id);
      const theirs = safe.filter((x) => peopleOf(x) === pid);
      const pool = theirs.length ? theirs : safe.filter((x) => peoples.free(x));
      for (let k = 0; k < Math.min(5, pool.length ? 4 : 0); k++) this.h.launch(w.id, this.h.rng.pick(pool).id, false, undefined, pid);
    }
  }

  private step(e: Encounter, dt: number) {
    const A = this.h.world(e.a);
    const B = this.h.world(e.b);
    if (!A || !B || A.parent !== null || B.parent !== null) return this.drop(e);
    // An encounter from an older save: it starts over from where the worlds are now.
    if (!e.kind || e.dth0 === undefined) {
      e.dur = Math.max(20, e.dur - e.t);
      e.t = 0;
      e.a0 = e.ea = A.a;
      e.b0 = e.eb = B.a;
      this.begin(e, A, B);
    }
    // Someone moved one of them (a migration): the danger may be over.
    if (Math.abs(A.a - e.ea) > 0.01 || Math.abs(B.a - e.eb) > 0.01) {
      if (!inBand(A, B)) {
        this.h.news('✧', `${A.name} y ${B.name} se alejan: sus nuevas órbitas son estables. ${e.kind === 'moon' ? 'Captura evitada' : 'Choque evitado'}.`, `${A.name} and ${B.name} drift apart: their new orbits are stable. ${e.kind === 'moon' ? 'Capture averted' : 'Collision averted'}.`, 'good', { pair: [A.id, B.id] });
        for (const w of [A, B]) if (orbitState(w, this.h.s.worlds).state !== 'unstable') this.h.fx({ kind: 'stable', world: w.id });
        return this.drop(e);
      }
      // Still inside the band: it goes on from here, in the time that was left.
      e.dur = Math.max(20, e.dur - e.t);
      e.t = 0;
      e.a0 = A.a;
      e.b0 = B.a;
      this.begin(e, A, B);
    }
    const before = e.t;
    e.t += dt;
    if (e.kind === 'impact' && !e.emergency && Math.floor(before / 8) !== Math.floor(e.t / 8)) this.emergency(e, A, B, false);
    // Across the orbit and along it at once, smoothly: the distance between them only ever shrinks.
    const p = smoothstep(0, 1, Math.min(1, e.t / e.dur));
    const mA = massOf(A);
    const mB = massOf(B);
    const wa0 = toWorld(e.a0);
    const wb0 = toWorld(e.b0);
    const mid = (wa0 * mA + wb0 * mB) / (mA + mB);
    A.a = toAU(wa0 + (mid - wa0) * p);
    B.a = toAU(wb0 + (mid - wb0) * p);
    e.ea = A.a;
    e.eb = B.a;
    const [big, small] = heavier(A, B);
    const slot = this.h.s.worlds.filter((m) => m.parent === big.id).length;
    // A moon-to-be ends a moon's distance ahead of (or behind) the heavier world; a crash ends on it.
    const moonD = moonOrbit(big, slot);
    const end = e.kind === 'moon' ? Math.sign(e.dth0 ?? 1) * Math.min(0.5, moonD / Math.max(1, sysWorld(big.a))) : 0;
    small.th = big.th + (e.dth0 ?? 0) * (1 - p) + end * p;
    // It ends the moment they touch on screen (no overlapping first), or when the time is up.
    const pb = drawn(big);
    const ps = drawn(small);
    const d = Math.hypot(pb.x - ps.x, pb.z - ps.z);
    if (e.kind === 'moon') {
      if (d <= moonD * 1.02 || p >= 1) this.capture(e, big, small);
    } else if (d <= (worldRadius(big) + worldRadius(small)) * 0.9 || p >= 1) this.collide(e, A, B);
  }

  private drop(e: Encounter) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** The lighter world is caught: it becomes one of the heavier one's moons, with its life and peoples. */
  private capture(e: Encounter, big: World, small: World) {
    this.drop(e);
    const s = this.h.s;
    const rng = this.h.rng;
    const pb = drawn(big);
    const ps = drawn(small);
    // Its own moons follow it into the new family while there is room; the rest break into debris.
    const theirs = s.worlds.filter((m) => m.parent === small.id);
    const ours = s.worlds.filter((m) => m.parent === big.id).sort((x, y) => x.a - y.a);
    ours.forEach((m, i) => (m.a = i));
    small.parent = big.id;
    small.a = ours.length;
    small.th = Math.atan2(ps.z - pb.z, ps.x - pb.x);
    const lost: string[] = [];
    let n = ours.length + 1;
    for (const m of theirs) {
      if (n < MAX_MOONS) {
        m.parent = big.id;
        m.a = n++;
      } else {
        lost.push(m.name);
        this.h.removeWorld(m.id);
      }
    }
    if (lost.length) for (let i = 0; i < 30; i++) s.belts.push({ r: big.a * (1 + rng.gauss(0, 0.015)), th: big.th + rng.range(-0.6, 0.6), s: 0.0005, born: s.time });
    this.h.fx({ kind: 'capture', world: big.id, x: ps.x, z: ps.z });
    this.h.news(
      '☾',
      `${small.name} ha sido capturado por ${big.name}: ahora es una de sus lunas.${small.life || small.colony > 0 ? ' La vida sigue allí, bajo un cielo nuevo.' : ''}`,
      `${small.name} has been captured by ${big.name}: it is now one of its moons.${small.life || small.colony > 0 ? ' Life goes on there, under a new sky.' : ''}`,
      'good',
      { world: small.id },
    );
    if (lost.length) this.h.news('✺', `Las lunas que no caben se rompen en un anillo de escombros: ${lost.join(', ')}.`, `The moons with no room left break into a ring of debris: ${lost.join(', ')}.`, 'warn', { world: big.id });
  }

  /** Two worlds become one; what is left over becomes moons, rings, a trail — or a new world. */
  private collide(e: Encounter, A: World, B: World) {
    this.drop(e);
    const s = this.h.s;
    const rng = this.h.rng;
    const [big, small] = massOf(A) >= massOf(B) ? [A, B] : [B, A];
    const mb = massOf(big);
    const ms = massOf(small);
    const a = (big.a * mb + small.a * ms) / (mb + ms);
    const r = sysWorld(a);
    this.h.fx({ kind: 'collision', world: big.id, x: Math.cos(big.th) * r, z: Math.sin(big.th) * r, big: ms > 0.3 });
    const giant = isGiantStuff(big);
    // Peoples and life: the smaller world is gone, the larger one is scorched.
    const lost = small.life?.people ? this.h.peoples.get(small.life.people) : undefined;
    const lostColony = small.colony > 0 ? this.h.peoples.get(small.owner) : undefined;
    // The merged body.
    big.metal += small.metal * 0.92;
    big.rock += small.rock * 0.92;
    big.water += small.water * 0.7;
    big.org += small.org * 0.5;
    big.gas += small.gas * (giant ? 1 : 0.15);
    big.a = a;
    big.hot = 120;
    big.ocean *= 0.45;
    big.atm *= 0.6;
    big.organics *= 0.55;
    big.climate += giant ? 0 : 30;
    big.sats = 0;
    big.colony *= 0.25;
    if (big.life) big.life.health -= 0.75;
    this.h.kill(big, 0.85);
    // Moons: the small world's moons join the big one.
    for (const m of s.worlds) if (m.parent === small.id) m.parent = big.id;
    this.h.removeWorld(small.id);
    // Fresh moons from the debris.
    const moons = () => s.worlds.filter((m) => m.parent === big.id);
    const newMoons = rng.next() < 0.75 ? (rng.next() < 0.4 ? 2 : 1) : 0;
    const born: string[] = [];
    for (let k = 0; k < newMoons && moons().length < 6; k++) {
      const share = rng.range(0.02, 0.06) * ms;
      const moon = this.blank(big.id, moonName(big.name, moons().length), moons().length);
      moon.metal = share * 0.25;
      moon.rock = share * 0.7;
      moon.water = share * 0.05;
      moon.hot = 60;
      s.worlds.push(moon);
      born.push(moon.name);
    }
    // Keep moon slots tidy (they are spaced by index).
    moons().forEach((m, i) => (m.a = i));
    if (rng.next() < 0.5 && !big.ring) {
      big.ring = true;
      big.debrisRing = !giant;
    }
    for (let i = 0; i < 60; i++) s.belts.push({ r: a * (1 + rng.gauss(0, 0.02)), th: big.th - 0.05 - rng.range(0, 1.4), s: 0.0006, born: s.time });
    // The largest fragment may escape and gather into a new world of its own.
    let fresh: World | null = null;
    if (ms > 0.05 && rng.next() < 0.45) fresh = this.fragment(big, ms, rng);
    this.h.news(
      '✺',
      `¡Choque de mundos! ${small.name} se estrella contra ${big.name} y ambos se funden en uno: ${big.name} renace como un océano de magma.`,
      `Worlds collide! ${small.name} crashes into ${big.name} and the two melt into one: ${big.name} is reborn as an ocean of magma.`,
      'warn',
      { world: big.id },
    );
    if (born.length)
      this.h.news('☾', `De los restos nacen ${born.length === 1 ? 'una luna nueva' : 'dos lunas nuevas'}: ${born.join(' y ')}.`, `From the debris ${born.length === 1 ? 'a new moon is born' : 'two new moons are born'}: ${born.join(' and ')}.`, 'good', { world: big.id });
    if (fresh) this.h.news('✦', `Un gran fragmento escapa del choque y se reúne en un mundo nuevo: ${fresh.name}.`, `A large fragment escapes the collision and gathers into a new world: ${fresh.name}.`, 'good', { world: fresh.id });
    if (lost) this.h.news('✝', `${small.name}, hogar de los ${lost.name}, ya no existe. Solo quedan quienes lograron partir a tiempo.`, `${small.name}, home of the ${lost.name}, is no more. Only those who left in time remain.`, 'warn', { world: big.id });
    else if (lostColony) this.h.news('✝', `La colonia de los ${lostColony.name} en ${small.name} desaparece con su mundo.`, `The ${lostColony.name} colony on ${small.name} vanishes with its world.`, 'warn', { world: big.id });
  }

  /** A fragment of the collision settles in a free, stable orbit as a new small world. */
  private fragment(big: World, ms: number, rng: Rng) {
    const s = this.h.s;
    for (let k = 0; k < 8; k++) {
      const a = big.a * (rng.next() < 0.5 ? rng.range(0.55, 0.8) : rng.range(1.25, 1.7));
      if (a < 0.35 || a > R_MAX) continue;
      const w = this.blank(null, worldName(rng, new Set(s.worlds.map((x) => x.name))), a);
      const share = rng.range(0.15, 0.25) * ms;
      w.metal = share * 0.3;
      w.rock = share * 0.65;
      w.water = share * 0.05;
      w.th = big.th + Math.PI * rng.range(0.6, 1.4);
      w.hot = 80;
      const planets = planetsOf([...s.worlds, w]);
      const i = planets.indexOf(w);
      const ok = [planets[i - 1], planets[i + 1]].every((n) => !n || toWorld(Math.max(n.a, w.a)) - toWorld(Math.min(n.a, w.a)) >= clearance(n.a < w.a ? n : w, n.a < w.a ? w : n, s.worlds));
      if (!ok) continue;
      s.worlds.push(w);
      return w;
    }
    return null;
  }

  private blank(parent: number | null, name: string, a: number): World {
    return {
      id: this.h.nid(),
      name,
      seed: (this.h.rng.next() * 1e9) | 0,
      a,
      th: this.h.rng.range(0, Math.PI * 2),
      parent,
      metal: 0,
      rock: 0,
      water: 0,
      gas: 0,
      org: 0,
      atm: 0,
      ocean: 0,
      organics: 0.02,
      mag: 0,
      climate: 0,
      life: null,
      spark: 0,
      colony: 0,
      terra: 0,
      invaded: 0,
      sats: 0,
      ring: false,
      volcanoCd: 0,
    };
  }
}
