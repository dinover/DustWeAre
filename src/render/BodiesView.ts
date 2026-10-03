import * as THREE from 'three';
import { diskTemp, massOf, toWorld, type Body } from '../core/state';
import { bodyRadius } from '../sim/formation';
import { PlanetMesh, lookOfBody } from './Planet';
import { moonOrbit } from './layout';

interface Entry {
  mesh: PlanetMesh;
  moons: PlanetMesh[];
  lookT: number;
  hot: number;
  mass: number;
}

/** Growing planetesimals and protoplanets during formation. */
export class BodiesView {
  group = new THREE.Group();
  private map = new Map<number, Entry>();
  hovered: number | null = null;

  constructor(private hi: boolean) {}

  /** A collision just happened: the body glows with fresh magma. */
  heat(id: number, amount = 1) {
    const e = this.map.get(id);
    if (e) {
      e.hot = Math.min(1.2, e.hot + amount);
      e.lookT = 0;
    }
  }

  position(b: Body) {
    const w = toWorld(b.r);
    return { x: Math.cos(b.th) * w, z: Math.sin(b.th) * w };
  }

  update(bodies: Body[], L: number, dt: number, time: number) {
    const seen = new Set<number>();
    for (const b of bodies) {
      seen.add(b.id);
      let e = this.map.get(b.id);
      if (!e) {
        e = { mesh: new PlanetMesh(this.hi, b.seed), moons: [], lookT: 0, hot: 0.9, mass: massOf(b) };
        this.group.add(e.mesh.group);
        this.map.set(b.id, e);
      }
      const m = massOf(b);
      if (m > e.mass * 1.02) e.hot = Math.min(1, e.hot + (m / e.mass - 1) * 2);
      e.mass = m;
      e.hot = Math.max(0, e.hot - dt * 0.05);
      e.lookT -= dt;
      const { x, z } = this.position(b);
      e.mesh.group.position.set(x, 0, z);
      e.mesh.setRadius(bodyRadius(b));
      if (e.lookT <= 0) {
        e.lookT = 0.5;
        e.mesh.setLook(lookOfBody(b, b.seed, diskTemp(b.r, L), e.hot));
      }
      e.mesh.update(dt, time, this.hovered === b.id ? 0.8 : 0);
      // Moons born from impacts or captured.
      while (e.moons.length < b.moons.length) {
        const mm = new PlanetMesh(false, b.seed + e.moons.length * 13);
        e.moons.push(mm);
        this.group.add(mm.group);
      }
      for (let i = 0; i < e.moons.length; i++) {
        const mo = b.moons[i];
        const mm = e.moons[i];
        if (!mo) {
          mm.group.visible = false;
          continue;
        }
        mm.group.visible = true;
        const a = time * (1.1 / (i + 1.5)) + i * 2.1;
        const d = moonOrbit(b, i);
        mm.group.position.set(x + Math.cos(a) * d, 0, z + Math.sin(a) * d);
        mm.setRadius(bodyRadius(mo) * 0.9);
        if (e.lookT === 0.5) mm.setLook(lookOfBody(mo, b.seed + i * 13, diskTemp(b.r, L), e.hot * 0.5));
        mm.update(dt, time, 0);
      }
    }
    for (const [id, e] of this.map) {
      if (seen.has(id)) continue;
      this.group.remove(e.mesh.group);
      e.mesh.dispose();
      for (const mm of e.moons) {
        this.group.remove(mm.group);
        mm.dispose();
      }
      this.map.delete(id);
    }
  }

  clear() {
    for (const [, e] of this.map) {
      this.group.remove(e.mesh.group);
      e.mesh.dispose();
      for (const mm of e.moons) {
        this.group.remove(mm.group);
        mm.dispose();
      }
    }
    this.map.clear();
  }
}
