import { massOf, sysWorld, view, type Stuff, type World } from '../core/state';
import { bodyRadius } from '../sim/formation';

/** On-screen radius of a world: a little larger than during formation, with giants compressed so systems stay readable. */
export const worldRadius = (s: Stuff) => 1.5 * Math.pow(bodyRadius(s), 0.8) * (massOf(s) < 0.02 ? 0.85 : 1);

/**
 * Distance of the n-th moon from its planet's centre (world units). It follows the player's spread
 * too (one setting for planets and moons); at 1 it is the old, tight layout.
 */
export const moonOrbit = (parent: Stuff, i: number, spread = view.spread) => worldRadius(parent) * (1.25 + 0.35 * spread) + 0.55 + 0.45 * spread + i * 0.95 * spread;

/** A distance travelled on the current map, as it would be on the old one: trips last the same at any spread. */
export const travel = (d: number) => d / view.spread;

/** Position of a world on the disk plane. */
export function worldXZ(w: World, byId: Map<number, World>, out: { x: number; z: number }) {
  if (w.parent === null) {
    const r = sysWorld(w.a);
    out.x = Math.cos(w.th) * r;
    out.z = Math.sin(w.th) * r;
    return out;
  }
  const p = byId.get(w.parent);
  if (!p) {
    out.x = out.z = 0;
    return out;
  }
  worldXZ(p, byId, out);
  const d = moonOrbit(p, w.a);
  out.x += Math.cos(w.th) * d;
  out.z += Math.sin(w.th) * d;
  return out;
}
