import { Rng, randomSeed } from '../util';
import type { GameState, Settings, Species } from './state';
import { worldName } from '../content/names';

const KEY = 'dwa.save.v1';
const SKEY = 'dwa.settings';

export function newState(opts: { legacy?: number; legacySpecies?: Species | null; from?: 'uib' | null } = {}): GameState {
  const seed = randomSeed();
  const rng = new Rng(seed ^ 0x51ed);
  return {
    version: 1,
    seed,
    name: worldName(rng, new Set()),
    phase: 'formation',
    age: 0,
    time: 0,
    L: 1,
    dial: 1,
    energy: 60,
    bodies: [],
    disk: null,
    worlds: [],
    ships: [],
    threats: [],
    belts: [],
    species: null,
    alienSpecies: null,
    invasion: { next: 0, waves: 0, signal: 0 },
    arkTimer: 0,
    won: false,
    civStart: null,
    legacy: opts.legacy ?? 0,
    legacySpecies: opts.legacySpecies ?? null,
    news: [],
    nextId: 1,
    nextEvent: 120,
    tutorials: {},
    from: opts.from ?? null,
  };
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1 || !s.phase) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveState(s: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const hasSave = () => {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
};

const defaults = (): Settings => {
  const weak = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return { music: 0.6, sfx: 0.7, quality: weak ? 'low' : 'high', speed: 1 };
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SKEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return defaults();
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SKEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
