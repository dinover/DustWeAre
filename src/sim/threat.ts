import type { GameState, Resources } from '../core/state';
import { clamp } from '../util';

/**
 * Difficulty: the stronger the system grows, the more it is noticed. Its power (settled worlds,
 * great works, technologies, colonies around other stars — conquered ones above all) sets a threat
 * level that makes invasions, reprisals and troubles beyond the system come sooner and harder. The
 * defences (fleet, shields, Space Patrols) can be raised level by level to keep up with it.
 */
export type DefenceId = 'fleet' | 'shield' | 'patrol';
export const DEFENCES: DefenceId[] = ['fleet', 'shield', 'patrol'];
export const MAX_LEVEL = 10;
/** Power needed for each threat level. */
const STEP = 5;

const BASE: Record<DefenceId, Partial<Resources>> = {
  fleet: { metal: 110, fuel: 70, science: 40 },
  shield: { metal: 90, water: 60, science: 60 },
  patrol: { metal: 120, fuel: 60, science: 50 },
};

/** What raising a defence from `level` to the next one costs. */
export function upgradeCost(id: DefenceId, level: number): Partial<Resources> {
  const k = Math.pow(1.45, Math.max(0, level - 1));
  const out: Partial<Resources> = {};
  for (const [r, v] of Object.entries(BASE[id]) as [keyof Resources, number][]) out[r] = Math.round((v * k) / 5) * 5;
  return out;
}

/** How strong the system looks from outside. */
export function powerOf(s: GameState, settled: number) {
  const civ = s.civ;
  if (!civ) return 0;
  const works = Object.values(civ.done).filter(Boolean).length;
  const stars = s.stars ?? [];
  const dom = stars.filter((x) => x.mode === 'dominion').length;
  return settled + works * 1.5 + (civ.tech ?? 0) * 0.6 + (stars.length - dom) + dom * 2.5;
}

export const levelFor = (power: number) => clamp(1 + Math.floor(power / STEP), 1, MAX_LEVEL);
/** Power at which the next threat level arrives. */
export const nextAt = (level: number) => level * STEP;

export const threatOf = (s: GameState) => s.threat?.level ?? 1;

/** Level of a defence (0: it does not exist yet). */
export function defLevel(s: GameState, id: DefenceId) {
  const civ = s.civ;
  if (!civ) return 0;
  const exists = id === 'patrol' ? !!s.patrol : !!civ.done[id];
  return exists ? Math.max(1, civ.def?.[id] ?? 1) : 0;
}

/** A defence against the current threat: 1 when they match, less when the threat is ahead. */
export const edge = (s: GameState, id: DefenceId) => defLevel(s, id) / threatOf(s);

/** Share of invading ships the fleet catches on their way in: each level behind the threat lets more through. */
export const fleetCatch = (F: number, L: number) => clamp(0.9 - 0.16 * (L - F), 0.08, 0.95);
/** Chance the shields stop an asteroid over a settled world. */
export const shieldStop = (S: number, L: number) => clamp(1 - 0.12 * (L - S), 0.4, 1);
/** How much of an invader landing gets through the shields of a settled world. */
export const shieldSlow = (S: number, L: number) => clamp(0.7 + 0.06 * (L - S), 0.55, 1);
/** Drop pods per assault wave, and how much faster the lance fires, by companies of Space Patrols. */
export const podsPerWave = (P: number) => Math.min(5, 2 + Math.floor((P - 1) / 2));
export const lanceSpeed = (P: number) => 0.6 + 0.4 * P;
