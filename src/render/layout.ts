import { massOf, toWorld, type Stuff, type World } from '../core/state';
import { bodyRadius } from '../sim/formation';

/** On-screen radius of a world: a little larger than during formation, with giants compressed so systems stay readable. */
export const worldRadius = (s: Stuff) => 1.5 * Math.pow(bodyRadius(s), 0.8) * (massOf(s) < 0.02 ? 0.85 : 1);

/** Distance of the n-th moon from its planet's centre (world units). */
export const moonOrbit = (parent: Stuff, i: number) => worldRadius(parent) * 1.6 + 1.0 + i * 0.95;

/** Position of a world on the disk plane. */
export function worldXZ(w: World, byId: Map<number, World>, out: { x: number; z: number }) {
  if (w.parent === null) {
    const r = toWorld(w.a);
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
