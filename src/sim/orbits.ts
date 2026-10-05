import { R_MAX, massOf, toAU, toWorld, type Encounter, type GameState, type NewsFocus, type World } from '../core/state';
import { moonOrbit, worldRadius } from '../render/layout';
import { Rng, clamp } from '../util';
import { isGiantStuff } from './worlds';
import { moonName, worldName } from '../content/names';
import { peopleOf, type PeopleSim } from './peoples';

/** How far a world's look reaches from its centre: the planet, its ring and part of its moons. */
export function reach(w: World, worlds: World[]) {
  const body = worldRadius(w) * (w.ring ? 2.2 : 1.15);
  const moons = worlds.filter((m) => m.parent === w.id).length;
  return moons ? Math.max(body, moonOrbit(w, moons - 1) * 0.7 + 0.5) : body;
}

/** Room two neighbouring planets need so they never overlap on screen (world units). */
export const clearance = (a: World, b: World, worlds: World[]) => reach(a, worlds) + reach(b, worlds) + 2;

/** Too close to share the sky for long: their gravity will pull them together. */
export const doomed = (a: World, b: World) => toWorld(b.a) - toWorld(a.a) < (worldRadius(a) + worldRadius(b)) * 1.2 + 0.6;

const planetsOf = (worlds: World[]) => worlds.filter((w) => w.parent === null).sort((x, y) => x.a - y.a);

/**
 * When the worlds settle: neighbours that are close (but not doomed) drift apart into stable,
 * well spaced orbits. Doomed pairs are left alone; they will meet later.
 */
export function spaceOrbits(worlds: World[]) {
  const planets = planetsOf(worlds);
  for (let i = 0; i < planets.length - 1; i++) {
    const A = planets[i];
    const B = planets[i + 1];
    if (doomed(A, B)) continue;
    const need = clearance(A, B, worlds);
    if (toWorld(B.a) - toWorld(A.a) >= need) continue;
    const a = toAU(toWorld(A.a) + need);
    if (a <= R_MAX * 1.2) B.a = a;
  }
}

export type OrbitFx = { kind: 'collision'; world: number; x: number; z: number; big: boolean };

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
  readonly peoples: PeopleSim;
}

const wrap = (d: number) => {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * Worlds whose orbits are too close do not share the sky for long: they drift together and
 * collide. A new, molten world rises from the two, with new moons, rings, sometimes a new
 * planet made of the largest fragment. Spacefaring peoples see it coming and evacuate.
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

  update(dt: number) {
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 3;
      this.scan();
    }
    for (const e of [...this.list]) this.step(e, dt);
  }

  private scan() {
    const s = this.h.s;
    const planets = planetsOf(s.worlds);
    for (let i = 0; i < planets.length - 1; i++) {
      const A = planets[i];
      const B = planets[i + 1];
      if (this.busy(A.id) || this.busy(B.id) || !doomed(A, B)) continue;
      const gap = Math.max(0, toWorld(B.a) - toWorld(A.a));
      // Several at once are staggered, so each collision gets its moment.
      const queue = this.list.length * 40;
      const e: Encounter = { id: this.h.nid(), a: A.id, b: B.id, t: 0, dur: 60 + gap * 6 + this.h.rng.range(0, 20) + queue, a0: A.a, b0: B.a, ea: A.a, eb: B.a };
      this.list.push(e);
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
    if (!A || !B) return this.drop(e);
    // Someone moved one of them (a migration): the danger may be over.
    if (Math.abs(A.a - e.ea) > 0.01 || Math.abs(B.a - e.eb) > 0.01) {
      const [inner, outer] = A.a <= B.a ? [A, B] : [B, A];
      if (!doomed(inner, outer)) {
        this.h.news('✧', `${A.name} y ${B.name} se alejan: sus nuevas órbitas son estables. Choque evitado.`, `${A.name} and ${B.name} drift apart: their new orbits are stable. Collision averted.`, 'good', { pair: [A.id, B.id] });
        return this.drop(e);
      }
      e.a0 = A.a;
      e.b0 = B.a;
      e.t *= 0.5;
    }
    const before = e.t;
    e.t += dt;
    if (!e.emergency && Math.floor(before / 8) !== Math.floor(e.t / 8)) this.emergency(e, A, B, false);
    const k = Math.min(1, e.t / e.dur);
    const ease = k * k;
    const mA = massOf(A);
    const mB = massOf(B);
    // The heavier world moves less.
    const wa0 = toWorld(e.a0);
    const wb0 = toWorld(e.b0);
    const mid = (wa0 * mA + wb0 * mB) / (mA + mB);
    A.a = toAU(wa0 + (mid - wa0) * ease);
    B.a = toAU(wb0 + (mid - wb0) * ease);
    e.ea = A.a;
    e.eb = B.a;
    // At the end, they also catch up with each other along the orbit.
    const d = wrap(B.th - A.th);
    if (k > 0.55) {
      const f = clamp((k - 0.55) / 0.45) * Math.min(1, dt * (k >= 1 ? 3 : 1.2));
      A.th += d * f * (mB / (mA + mB));
      B.th -= d * f * (mA / (mA + mB));
    }
    if (k >= 1 && Math.abs(wrap(B.th - A.th)) < 0.08) this.collide(e, A, B);
  }

  private drop(e: Encounter) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
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
    const r = toWorld(a);
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
    for (let i = 0; i < 60; i++) s.belts.push({ r: a * (1 + rng.gauss(0, 0.02)), th: big.th - 0.05 - rng.range(0, 1.4), s: 0.0006 });
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
