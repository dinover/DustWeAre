/**
 * Game state: everything that is saved. The simulation works in astronomical units (AU)
 * for orbits and Earth masses (ME) for mass; the renderer maps orbits to a compressed
 * world scale so inner and outer worlds both fit on screen.
 */

export const R_MIN = 0.32;
export const R_MAX = 14;
/** Orbit radius (AU) → world units. */
export const toWorld = (au: number) => 14 * Math.pow(au, 0.55);
/** World units → orbit radius (AU). */
export const toAU = (w: number) => Math.pow(Math.max(0, w) / 14, 1 / 0.55);
/** Angular speed (rad/s at game speed 1). Gentler than Kepler so inner orbits stay readable. */
export const omega = (au: number) => 0.5 * Math.pow(Math.max(au, 0.05), -0.75);

/** Snow line: beyond it water freezes into ice (scales with the star's light). */
export const snowLine = (L: number) => 2.7 * Math.sqrt(L);
/** Habitable zone (liquid water on a world with an Earth-like atmosphere). */
export const habZone = (L: number): [number, number] => [0.95 * Math.sqrt(L), 1.55 * Math.sqrt(L)];
/** Disk midplane temperature (K). */
export const diskTemp = (au: number, L: number) => (280 * Math.pow(L, 0.25)) / Math.sqrt(au);

export type Phase = 'formation' | 'system';

/** Material amounts in Earth masses. */
export interface Stuff {
  metal: number;
  rock: number;
  water: number;
  gas: number;
  org: number;
}

export const massOf = (s: Stuff) => s.metal + s.rock + s.water + s.gas + s.org;
export const solidsOf = (s: Stuff) => s.metal + s.rock + s.water + s.org;

/** A growing body during formation (planetesimal → protoplanet). */
export interface Body extends Stuff {
  id: number;
  r: number;
  th: number;
  /** Orbit target while the player nudges it (AU), null when free. */
  target: number | null;
  /** Moons made by impacts and captures. */
  moons: Stuff[];
  seed: number;
  born: number;
}

export interface Life {
  /** 0 microbes · 1 complex · 2 intelligence · 3 civilization · 4 space age · 5 interplanetary */
  stage: number;
  progress: number;
  health: number;
  /** True on the world where this species was born. */
  origin: boolean;
}

/** A finished world: planet or moon. */
export interface World extends Stuff {
  id: number;
  name: string;
  seed: number;
  /** Planet: orbit radius (AU). Moon: index around its parent. */
  a: number;
  th: number;
  parent: number | null;
  atm: number;
  ocean: number;
  organics: number;
  mag: number;
  climate: number;
  life: Life | null;
  /** Time spent habitable without life (abiogenesis clock). */
  spark: number;
  colony: number;
  terra: number;
  invaded: number;
  sats: number;
  ring: boolean;
  volcanoCd: number;
}

export interface Ship {
  id: number;
  from: number;
  to: number;
  t: number;
  dur: number;
  alien: boolean;
  /** Interstellar ark leaving the system. */
  ark?: boolean;
}

export interface Threat {
  id: number;
  target: number;
  t: number;
  dur: number;
  angle: number;
}

export interface NewsItem {
  age: number;
  icon: string;
  es: string;
  en: string;
  kind: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact';
}

export interface Species {
  name: string;
  hue: number;
}

export interface DiskSave {
  n: number;
  data: string;
  heat: string;
  cool: string;
  initialSolids: number;
  gasLeft: number;
}

export interface GameState {
  version: 1;
  seed: number;
  name: string;
  phase: Phase;
  /** System age in millions of years. */
  age: number;
  time: number;
  L: number;
  /** Star brightness chosen by the player (multiplies L). */
  dial: number;
  energy: number;
  bodies: Body[];
  disk: DiskSave | null;
  worlds: World[];
  ships: Ship[];
  threats: Threat[];
  belts: { r: number; th: number; s: number }[];
  species: Species | null;
  alienSpecies: Species | null;
  invasion: { next: number; waves: number; signal: number };
  arkTimer: number;
  won: boolean;
  /** System age when the first cities appeared (for the civilization calendar). */
  civStart?: number | null;
  /** Systems your species has already reached (new game+). */
  legacy: number;
  legacySpecies: Species | null;
  news: NewsItem[];
  nextId: number;
  nextEvent: number;
  tutorials: Record<string, boolean>;
  from: 'uib' | null;
}

export interface Settings {
  music: number;
  sfx: number;
  quality: 'low' | 'high';
  speed: number;
}
