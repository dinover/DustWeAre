import { massOf, type World } from '../core/state';
import { clamp } from '../util';
import type { WorldStats } from './worlds';
import { ETHOS_PRESSURE, USE_PRESSURE, type Ethos, type Use } from './uses';

/**
 * How many people a world holds (in millions). Natives count from intelligence on; settlers by what
 * they made of the world. Catastrophes, wars, plagues and occupation thin them out; numbers grow back
 * slowly towards what the world can feed. A people that falls too low loses its stage.
 */

/** What a world can feed at each stage of its natives, before habitability and size (millions). */
export const NATIVE_CAP = [0, 0, 4, 900, 4000, 7000];
/** Below this many (millions) a stage cannot hold on, and the people falls back one stage. */
export const CRIT = [0, 0, 0.04, 12, 60, 120];
/** Settlers a fully grown colony holds, by use (millions). */
export const USE_CAP: Record<Use, number> = { garden: 900, lab: 4, mine: 30, ice: 15, gas: 60, fort: 25 };

/** Natives and settlers share this world: life of its own under someone else's colony (even one worn down by raids). */
export const coexists = (w: World) => w.colony > 0 && !!w.owner && !!w.life && w.life.people !== w.owner;

/** How many natives the world can feed right now. */
export function nativeCap(w: World, st: WorldStats, stage = w.life?.stage ?? 0) {
  const room = clamp(Math.sqrt(massOf(w)), 0.35, 1.6);
  return NATIVE_CAP[Math.min(5, stage)] * (0.2 + 0.8 * st.H) * room * (coexists(w) ? 0.5 : 1);
}

/** How many settlers the colony can hold right now. */
export function colonyCap(w: World) {
  if (!w.use || !(w.colony > 0)) return 0;
  const moon = w.parent !== null ? 0.6 : 1;
  const green = w.use === 'garden' ? 0.04 + 0.96 * w.terra : 1;
  return USE_CAP[w.use] * moon * green * (0.15 + 0.85 * (w.dev ?? 0)) * Math.min(1, w.colony);
}

/** How hard the settlers weigh on the natives that share their world (0: not at all). */
export function pressureOn(w: World, ethos: Ethos) {
  if (!coexists(w) || !w.use) return 0;
  const order = w.natives === 'protect' ? 0.25 : w.natives === 'purge' ? 3 : 1;
  return USE_PRESSURE[w.use] * ETHOS_PRESSURE[ethos] * (0.4 + 0.6 * (w.dev ?? 0)) * order;
}

/** Logistic growth towards what the world can feed (and a slow decline when there are too many). */
export function grow(p: number, K: number, rate: number, dt: number) {
  if (K <= 0) return Math.max(0, p - p * 0.05 * dt);
  if (p > K) return Math.max(K, p - (p - K) * 0.03 * dt);
  // A tiny floor keeps a handful of survivors from stalling forever.
  return Math.min(K, p + (rate * p * (1 - p / K) + K * 0.00004) * dt);
}
