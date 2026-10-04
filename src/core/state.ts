/**
 * Game state: everything that is saved. The simulation works in astronomical units (AU)
 * for orbits and Earth masses (ME) for mass; the renderer maps orbits to a compressed
 * world scale so inner and outer worlds both fit on screen.
 */

export const R_MIN = 0.32;
export const R_MAX = 14;
/** How much the map compresses distance: lower squeezes the outer system more. */
export const SCALE_EXP = 0.62;
/** Orbit radius (AU) → world units. */
export const toWorld = (au: number) => 14 * Math.pow(au, SCALE_EXP);
/** World units → orbit radius (AU). */
export const toAU = (w: number) => Math.pow(Math.max(0, w) / 14, 1 / SCALE_EXP);
/** Angular speed (rad/s at game speed 1). Gentler than Kepler so inner orbits stay readable. */
export const omega = (au: number) => 0.5 * Math.pow(Math.max(au, 0.05), -0.75);

/** Snow line: beyond it water freezes into ice (scales with the star's light). */
export const snowLine = (L: number) => 2.7 * Math.sqrt(L);
/**
 * Sunlight fades with distance more gently than in reality (a^-0.3 instead of a^-0.5): it gives a
 * roomier habitable zone, so several worlds can live in it without being packed together.
 */
export const T_EXP = 0.3;
/** Habitable zone (liquid water on a world with an Earth-like atmosphere). */
export const habZone = (L: number): [number, number] => {
  const k = Math.pow(L, 0.25 / T_EXP);
  return [0.6 * k, 1.6 * k];
};
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
  /** The people this life became (people id), once it reached intelligence. */
  people?: number;
}

/** A people of the system. The player is none of them: they only watch, and sometimes intervene. */
export interface People {
  id: number;
  name: string;
  hue: number;
  /** World where they were born (or first settled, if they came from elsewhere). */
  home: number;
  born: number;
  /** The two peoples that mixed into this one. */
  parents?: [number, number];
  /** They came from another star (an ark, refugees) instead of evolving here. */
  arrived?: boolean;
  gone?: boolean;
  nextShip: number;
}

/** How two peoples get along. */
export interface Relation {
  a: number;
  b: number;
  /** −1 hostile … +1 friendly. */
  mood: number;
  state: 'peace' | 'tension' | 'war' | 'alliance';
  warT: number;
  nextTalk: number;
  nextSkirmish: number;
  /** They have found each other (both can travel through space). */
  met?: boolean;
  /** A new people already came from these two. */
  mixed?: boolean;
}

/** Legacy (saves before peoples were equals). */
export interface Rival {
  name: string;
  hue: number;
  /** World where they were born. */
  home: number;
  /** −1 hostile … +1 friendly. */
  mood: number;
  relation: 'peace' | 'tension' | 'war' | 'alliance';
  /** Seconds since the war began (0 in peace). */
  warT: number;
  nextTalk: number;
  nextShip: number;
  nextSkirmish: number;
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
  /** Refugees from another star who were given this world. */
  guest?: string;
  /** Seconds a fresh impact scar keeps glowing. */
  hot?: number;
  /** Its ring is made of impact debris (thin and grey). */
  debrisRing?: boolean;
  /** People living on this world as a colony (people id); none: unclaimed. */
  owner?: number;
}

export type ShipKind = 'colony' | 'freight' | 'tanker' | 'miner' | 'trader' | 'refugee' | 'expedition' | 'flotilla' | 'armada' | 'raider' | 'alien' | 'mother' | 'ark';

export interface Ship {
  id: number;
  /** World id, or a negative number for deep space. */
  from: number;
  /** World id, or -1 when the ship flies to a fixed point (tx, tz). */
  to: number;
  t: number;
  dur: number;
  alien: boolean;
  /** Interstellar ark leaving the system. */
  ark?: boolean;
  kind?: ShipKind;
  /** Fixed start / end points on the disk plane (world units). */
  sx?: number;
  sz?: number;
  tx?: number;
  tz?: number;
  /** Asteroid-belt sample a mining ship flies to. */
  belt?: number;
  /** Return leg of a round trip. */
  back?: boolean;
  /** Seconds left before a defending fleet destroys it. */
  doom?: number;
  /** Hits a mothership can still take. */
  hp?: number;
  /** Refugee species on board. */
  species?: string;
  /** The people flying it (people id). */
  people?: number;
}

export interface Resources {
  metal: number;
  fuel: number;
  water: number;
  science: number;
}

export interface Decision {
  id: number;
  kind: 'trade' | 'refugees' | 'signal' | 'artifact' | 'rogue' | 'tension' | 'war' | 'incident' | 'alliance' | 'peace';
  /** Legacy: rival people involved. */
  rival?: number;
  /** The two peoples involved (tension and war). */
  pair?: [number, number];
  /** Seconds left before it expires. */
  left: number;
  dur: number;
  world?: number;
  give?: Partial<Resources>;
  get?: Partial<Resources>;
  species?: string;
}

export interface Mission {
  id: number;
  kind: 'expedition' | 'signal' | 'artifact';
  t: number;
  dur: number;
  x: number;
  z: number;
}

/** The late game: economy, great works, missions and visitors. */
export interface CivState {
  res: Resources;
  done: Record<string, boolean>;
  building: { id: string; t: number; dur: number } | null;
  missions: Mission[];
  decisions: Decision[];
  armada: { phase: 'rally' | 'hold' | 'away' | 'battle' | 'return'; t: number; x: number; z: number; launched: number; gathered: number; vsAliens: boolean; vsRival?: number; crew?: number[] } | null;
  /** A group of colonists gathering to leave for another star. */
  flotilla?: { launched: number; gathered: number; x: number; z: number; star: string; people?: number } | null;
  nextFlotilla?: number;
  rogue: { t: number; dur: number; seed: number; ang: number; off: number; offered: boolean } | null;
  nextLate: number;
  nextFlavor: number;
  peace: boolean;
  allies: string[];
  artifactFound: boolean;
  /** Technologies researched beyond the great works. */
  tech?: number;
  research?: { t: number; dur: number } | null;
  stats: { expeditions: number; battles: number; trades: number; colonies: number; armadas: number };
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
  civ?: CivState;
  peoples?: People[];
  relations?: Relation[];
  /** Legacy. */
  rivals?: Rival[];
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
