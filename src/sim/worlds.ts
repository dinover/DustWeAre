import { massOf, solidsOf, type Body, type Stuff, type World } from '../core/state';
import { Rng, clamp, ramp, smoothstep } from '../util';
import { moonName, worldName } from '../content/names';

export type Kind = 'gas' | 'icegiant' | 'lava' | 'scorched' | 'ocean' | 'ice' | 'desert' | 'barren' | 'temperate';

export interface Factors {
  temp: number;
  water: number;
  atm: number;
  org: number;
  mag: number;
  mass: number;
}

export interface WorldStats {
  T: number;
  kind: Kind;
  giant: boolean;
  f: Factors;
  /** Habitability 0..1 (product of every factor). */
  H: number;
  ocean: number;
  atm: number;
  organics: number;
}

export const isGiantStuff = (s: Stuff) => {
  const m = massOf(s);
  return (m > 8 && s.gas / m > 0.35) || (m > 4 && (s.water + s.gas) / m > 0.55 && s.gas / m > 0.08);
};

export function orbitOf(w: World, worlds: World[]) {
  if (w.parent === null) return w.a;
  return worlds.find((p) => p.id === w.parent)?.a ?? 1;
}

/** Physical state of a world right now (temperature, kind, habitability). */
export function worldStats(w: World, worlds: World[], L: number): WorldStats {
  const m = massOf(w);
  const parent = w.parent === null ? null : worlds.find((p) => p.id === w.parent) ?? null;
  const a = parent ? parent.a : w.a;
  const giant = isGiantStuff(w);
  // Colonists terraform: the world drifts towards gentle, Earth-like conditions.
  const ocean = Math.max(w.ocean, w.terra * 0.65);
  const atm = w.terra > 0 ? w.atm + (clamp(w.atm, 0.8, 1.6) - w.atm) * w.terra : w.atm;
  const organics = Math.max(w.organics, w.terra);
  const tidal = parent && isGiantStuff(parent) ? 55 / (w.a + 1) : 0;
  const Teq = (255 * Math.pow(L, 0.25)) / Math.sqrt(Math.max(a, 0.05));
  const greenhouse = 33 * Math.pow(Math.min(atm, 120), 0.8);
  let T = Teq + greenhouse + w.climate + tidal;
  if (w.terra > 0) T += (290 - T) * 0.85 * w.terra;
  const f: Factors = {
    temp: T < 273 ? ramp(238, 273, T) : 1 - ramp(312, 350, T),
    water: ramp(0.02, 0.2, ocean),
    atm: atm < 0.4 ? ramp(0.08, 0.4, atm) : 1 - ramp(4, 14, atm),
    org: ramp(0.04, 0.3, organics),
    mag: w.mag >= 0.25 ? 1 : 0.55 + 1.8 * w.mag,
    mass: giant ? 0 : ramp(0.03, 0.1, m) * (1 - ramp(8, 14, m)),
  };
  const H = clamp(f.temp * f.water * f.atm * f.org * f.mag * f.mass);
  const waterFrac = w.water / Math.max(1e-6, m);
  let kind: Kind;
  if (giant) kind = w.gas / m > 0.5 ? 'gas' : 'icegiant';
  else if (T > 560) kind = 'lava';
  else if (T > 345) kind = 'scorched';
  else if (T < 235 && (ocean > 0.04 || waterFrac > 0.03)) kind = 'ice';
  else if (ocean >= 0.85 || waterFrac > 0.25) kind = 'ocean';
  else if (ocean < 0.05) kind = atm < 0.1 ? 'barren' : 'desert';
  else kind = 'temperate';
  return { T, kind, giant, f, H, ocean, atm, organics };
}

/** Starting surface conditions from what the world is made of. */
function surfaceFrom(s: Stuff) {
  const m = Math.max(1e-6, massOf(s));
  const waterFrac = s.water / m;
  const gasFrac = s.gas / m;
  const orgFrac = s.org / m;
  const hold = smoothstep(0.04, 0.5, m);
  return {
    ocean: clamp(waterFrac * 7),
    atm: clamp(gasFrac * 25 + waterFrac * 3 + orgFrac * 12, 0, 8) * hold,
    organics: clamp(orgFrac * 45),
    mag: clamp(Math.sqrt(m) * (s.metal / m) * 2.4),
  };
}

/** Turns the bodies left after formation into planets and moons. */
export function makeWorlds(bodies: Body[], rng: Rng, nextId: () => number): World[] {
  const used = new Set<string>();
  const sorted = [...bodies].sort((a, b) => a.r - b.r);
  const worlds: World[] = [];
  for (const b of sorted) {
    const base = surfaceFrom(b);
    const w: World = {
      id: nextId(),
      name: worldName(rng, used),
      seed: b.seed,
      a: b.r,
      th: b.th,
      parent: null,
      metal: b.metal,
      rock: b.rock,
      water: b.water,
      gas: b.gas,
      org: b.org,
      ...base,
      climate: 0,
      life: null,
      spark: 0,
      colony: 0,
      terra: 0,
      invaded: 0,
      sats: 0,
      ring: isGiantStuff(b) && rng.next() < 0.55,
      volcanoCd: 0,
    };
    worlds.push(w);
    b.moons
      .sort((x, y) => massOf(y) - massOf(x))
      .forEach((mo, i) => {
        const mb = surfaceFrom(mo);
        worlds.push({
          id: nextId(),
          name: moonName(w.name, i),
          seed: (rng.next() * 1e9) | 0,
          a: i,
          th: rng.range(0, Math.PI * 2),
          parent: w.id,
          ...mo,
          ...mb,
          climate: 0,
          life: null,
          spark: 0,
          colony: 0,
          terra: 0,
          invaded: 0,
          sats: 0,
          ring: false,
          volcanoCd: 0,
        });
      });
  }
  return worlds;
}

/** Worlds that count for "your species reached every world". */
export const colonizable = (w: World) => solidsOf(w) + w.gas > 0.003;
