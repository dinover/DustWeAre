import * as THREE from 'three';
import { omega, toWorld, type GameState, type Ship, type World } from '../core/state';
import { worldStats } from '../sim/worlds';
import { PlanetMesh, lookOfWorld } from './Planet';
import { glowTexture } from './Stage';
import { worldRadius, worldXZ } from './layout';
import { TAU, easeInOut } from '../util';

const MAX_SHIPS = 64;
const TRAIL = 12;
const MAX_SATS = 220;

interface Entry {
  mesh: PlanetMesh;
  orbit: THREE.LineLoop | null;
  lookT: number;
  aura: THREE.Sprite;
}

/** The finished system: worlds and moons, their orbits, belts, ships, satellites and threats. */
export class SystemView {
  group = new THREE.Group();
  private map = new Map<number, Entry>();
  private byId = new Map<number, World>();
  private orbitGeo: THREE.BufferGeometry;
  private belts: THREE.Points | null = null;
  private beltData: { r: number; th: number; s: number }[] = [];
  private shipGeo: THREE.BufferGeometry;
  private shipPos = new Float32Array(MAX_SHIPS * 3);
  private shipCol = new Float32Array(MAX_SHIPS * 3);
  private trailGeo: THREE.BufferGeometry;
  private trailPos = new Float32Array(MAX_SHIPS * TRAIL * 2 * 3);
  private trailCol = new Float32Array(MAX_SHIPS * TRAIL * 2 * 3);
  private satGeo: THREE.BufferGeometry;
  private satPos = new Float32Array(MAX_SATS * 3);
  private rocks = new Map<number, THREE.Mesh>();
  private rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private rockMat = new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 1, flatShading: true });
  private threatLines: THREE.LineSegments;
  private threatPos = new Float32Array(16 * 2 * 3);
  private tmp = { x: 0, z: 0 };
  private tmp2 = { x: 0, z: 0 };
  selected: number | null = null;
  hovered: number | null = null;
  /** Ship positions (for flare targeting). */
  shipXYZ = new Map<number, THREE.Vector3>();

  constructor(private hi: boolean) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 200; i++) pts.push(new THREE.Vector3(Math.cos((i / 200) * TAU), 0, Math.sin((i / 200) * TAU)));
    this.orbitGeo = new THREE.BufferGeometry().setFromPoints(pts);

    this.shipGeo = new THREE.BufferGeometry();
    this.shipGeo.setAttribute('position', new THREE.BufferAttribute(this.shipPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.shipGeo.setAttribute('color', new THREE.BufferAttribute(this.shipCol, 3).setUsage(THREE.DynamicDrawUsage));
    const ships = new THREE.Points(
      this.shipGeo,
      new THREE.PointsMaterial({ size: 1.6, vertexColors: true, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ships.frustumCulled = false;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    const trails = new THREE.LineSegments(
      this.trailGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    trails.frustumCulled = false;
    this.satGeo = new THREE.BufferGeometry();
    this.satGeo.setAttribute('position', new THREE.BufferAttribute(this.satPos, 3).setUsage(THREE.DynamicDrawUsage));
    const sats = new THREE.Points(
      this.satGeo,
      new THREE.PointsMaterial({ size: 0.5, color: 0xfff0c8, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    sats.frustumCulled = false;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.threatPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.threatLines = new THREE.LineSegments(tg, new THREE.LineDashedMaterial({ color: 0xff7a3a, dashSize: 1, gapSize: 1.2, transparent: true, opacity: 0.6 }));
    this.threatLines.frustumCulled = false;
    this.group.add(ships, trails, sats, this.threatLines);
    const amb = new THREE.AmbientLight(0x403028, 0.6);
    this.group.add(amb);
  }

  setBelts(belts: { r: number; th: number; s: number }[]) {
    if (this.belts) {
      this.group.remove(this.belts);
      this.belts.geometry.dispose();
    }
    this.beltData = belts;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(belts.length * 3);
    const col = new Float32Array(belts.length * 3);
    for (let i = 0; i < belts.length; i++) {
      const b = 0.35 + 0.4 * ((i * 7919) % 100) / 100;
      col[i * 3] = b * 0.95;
      col[i * 3 + 1] = b * 0.8;
      col[i * 3 + 2] = b * 0.62;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.belts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.55, vertexColors: true, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.belts.frustumCulled = false;
    this.group.add(this.belts);
  }

  /** World position of a world right now. */
  pos(w: World) {
    worldXZ(w, this.byId, this.tmp);
    return new THREE.Vector3(this.tmp.x, 0, this.tmp.z);
  }
  posOf(id: number) {
    const w = this.byId.get(id);
    return w ? this.pos(w) : null;
  }

  private shipPath(s: GameState, sh: Ship, k: number, out: THREE.Vector3) {
    const to = this.byId.get(sh.to);
    if (sh.ark) {
      const home = this.byId.get(sh.from);
      if (home) worldXZ(home, this.byId, this.tmp);
      else this.tmp.x = this.tmp.z = 0;
      const ang = Math.atan2(this.tmp.z, this.tmp.x) + 0.3;
      const kk = k * k;
      out.set(this.tmp.x + Math.cos(ang) * kk * 180, kk * 60, this.tmp.z + Math.sin(ang) * kk * 180);
      return out;
    }
    if (!to) return out.set(0, -999, 0);
    worldXZ(to, this.byId, this.tmp2);
    const from = sh.from >= 0 ? this.byId.get(sh.from) : null;
    if (from) worldXZ(from, this.byId, this.tmp);
    else {
      // Visitors (and arks) come from deep space.
      const a = (Math.abs(sh.from) * 2.399) % TAU;
      this.tmp.x = Math.cos(a) * 110;
      this.tmp.z = Math.sin(a) * 110;
    }
    const e = easeInOut(Math.min(1, Math.max(0, k)));
    const dx = this.tmp2.x - this.tmp.x;
    const dz = this.tmp2.z - this.tmp.z;
    const len = Math.hypot(dx, dz) || 1;
    const bow = Math.sin(Math.PI * e) * Math.min(len * 0.22, 9);
    out.set(this.tmp.x + dx * e - (dz / len) * bow, Math.sin(Math.PI * e) * Math.min(len * 0.12, 5), this.tmp.z + dz * e + (dx / len) * bow);
    return out;
  }

  update(s: GameState, dt: number, time: number) {
    this.byId.clear();
    for (const w of s.worlds) this.byId.set(w.id, w);
    const L = s.L * s.dial;
    const seen = new Set<number>();
    const alienHue = s.alienSpecies?.hue ?? 0.85;
    for (const w of s.worlds) {
      seen.add(w.id);
      let e = this.map.get(w.id);
      if (!e) {
        const mesh = new PlanetMesh(this.hi, w.seed);
        mesh.setInvaderHue(alienHue);
        const orbit = w.parent === null ? new THREE.LineLoop(this.orbitGeo, new THREE.LineBasicMaterial({ color: 0xc9a86a, transparent: true, opacity: 0.16, depthWrite: false })) : null;
        if (orbit) this.group.add(orbit);
        const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb07cff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        mesh.group.add(aura);
        e = { mesh, orbit, lookT: 0, aura };
        this.group.add(mesh.group);
        this.map.set(w.id, e);
      }
      const p = worldXZ(w, this.byId, this.tmp);
      e.mesh.group.position.set(p.x, 0, p.z);
      const r = worldRadius(w);
      e.mesh.setRadius(r);
      e.lookT -= dt;
      if (e.lookT <= 0) {
        e.lookT = 0.35;
        const st = worldStats(w, s.worlds, L);
        e.mesh.setLook(lookOfWorld(w, st));
        e.mesh.setRing(w.ring, w.seed, st.kind === 'icegiant' ? [0.62, 0.74, 0.8] : [0.82, 0.72, 0.56]);
        e.mesh.setInvaderHue(alienHue);
      }
      const sel = this.selected === w.id ? 1 : this.hovered === w.id ? 0.55 : 0;
      e.mesh.update(dt, time, sel);
      if (e.orbit) {
        e.orbit.scale.setScalar(toWorld(w.a));
        (e.orbit.material as THREE.LineBasicMaterial).opacity = this.selected === w.id ? 0.55 : this.hovered === w.id ? 0.32 : 0.14;
      }
      const am = e.aura.material as THREE.SpriteMaterial;
      am.opacity = w.invaded * (0.45 + 0.2 * Math.sin(time * 2 + w.id));
      e.aura.scale.setScalar(r * 5);
    }
    for (const [id, e] of this.map) {
      if (seen.has(id)) continue;
      this.group.remove(e.mesh.group);
      if (e.orbit) this.group.remove(e.orbit);
      e.mesh.dispose();
      this.map.delete(id);
    }

    // Asteroid belts drift with their orbits.
    if (this.belts) {
      const pos = this.belts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < this.beltData.length; i++) {
        const b = this.beltData[i];
        const th = b.th + omega(b.r) * 0.42 * s.time;
        const rw = toWorld(b.r);
        arr[i * 3] = Math.cos(th) * rw;
        arr[i * 3 + 1] = ((i * 37) % 11 - 5) * 0.06;
        arr[i * 3 + 2] = Math.sin(th) * rw;
      }
      pos.needsUpdate = true;
    }

    // Ships with their trails.
    const v = new THREE.Vector3();
    const hue = new THREE.Color();
    this.shipXYZ.clear();
    let n = 0;
    const sp = s.species?.hue ?? 0.35;
    for (const sh of s.ships) {
      if (n >= MAX_SHIPS) break;
      const k = sh.t / sh.dur;
      this.shipPath(s, sh, k, v);
      this.shipXYZ.set(sh.id, v.clone());
      if (sh.alien) hue.setHSL(alienHue, 0.8, 0.62);
      else if (sh.ark) hue.setRGB(1, 0.92, 0.7);
      else hue.setHSL(sp, 0.55, 0.62);
      this.shipPos.set([v.x, v.y, v.z], n * 3);
      this.shipCol.set([hue.r * 1.4, hue.g * 1.4, hue.b * 1.4], n * 3);
      const step = sh.ark ? 0.02 : 0.012;
      let prev = v.clone();
      for (let j = 0; j < TRAIL; j++) {
        const q = this.shipPath(s, sh, Math.max(0, k - (j + 1) * step), new THREE.Vector3());
        const o = (n * TRAIL + j) * 6;
        this.trailPos.set([prev.x, prev.y, prev.z, q.x, q.y, q.z], o);
        const f0 = (1 - j / TRAIL) * 0.75;
        const f1 = (1 - (j + 1) / TRAIL) * 0.75;
        this.trailCol.set([hue.r * f0, hue.g * f0, hue.b * f0, hue.r * f1, hue.g * f1, hue.b * f1], o);
        prev = q;
      }
      n++;
    }
    for (let i = n; i < MAX_SHIPS; i++) {
      this.shipPos[i * 3 + 1] = -9999;
      for (let j = 0; j < TRAIL * 6; j++) this.trailPos[(i * TRAIL) * 6 + j] = 0;
      for (let j = 0; j < TRAIL * 6; j++) this.trailCol[(i * TRAIL) * 6 + j] = 0;
    }
    this.shipGeo.attributes.position.needsUpdate = true;
    this.shipGeo.attributes.color.needsUpdate = true;
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;

    // Satellites around settled worlds.
    let si = 0;
    for (const w of s.worlds) {
      if (!w.sats) continue;
      const p = worldXZ(w, this.byId, this.tmp);
      const r = worldRadius(w) * 1.5 + 0.35;
      for (let j = 0; j < w.sats && si < MAX_SATS; j++, si++) {
        const a = time * (0.9 + (j % 3) * 0.25) + j * 2.4;
        const inc = ((j % 5) - 2) * 0.35;
        this.satPos[si * 3] = p.x + Math.cos(a) * r;
        this.satPos[si * 3 + 1] = Math.sin(a) * r * inc;
        this.satPos[si * 3 + 2] = p.z + Math.sin(a) * r * Math.cos(inc);
      }
    }
    for (let i = si; i < MAX_SATS; i++) this.satPos[i * 3 + 1] = -9999;
    this.satGeo.attributes.position.needsUpdate = true;

    // Incoming asteroids.
    const live = new Set<number>();
    let li = 0;
    for (const t of s.threats) {
      live.add(t.id);
      let rock = this.rocks.get(t.id);
      if (!rock) {
        rock = new THREE.Mesh(this.rockGeo, this.rockMat);
        rock.scale.set(1.1, 0.8, 0.9);
        this.rocks.set(t.id, rock);
        this.group.add(rock);
      }
      const target = this.byId.get(t.target);
      if (!target) continue;
      const p = worldXZ(target, this.byId, this.tmp);
      const d = 90 * (1 - t.t / t.dur) + worldRadius(target);
      rock.position.set(p.x + Math.cos(t.angle) * d, 2 * (1 - t.t / t.dur), p.z + Math.sin(t.angle) * d);
      rock.rotation.x += dt * 0.7;
      rock.rotation.y += dt * 0.4;
      if (li < 16) {
        this.threatPos.set([rock.position.x, rock.position.y, rock.position.z, p.x, 0, p.z], li * 6);
        li++;
      }
    }
    for (let i = li; i < 16; i++) this.threatPos.fill(0, i * 6, i * 6 + 6);
    this.threatLines.geometry.attributes.position.needsUpdate = true;
    this.threatLines.computeLineDistances();
    for (const [id, m] of this.rocks) {
      if (live.has(id)) continue;
      this.group.remove(m);
      this.rocks.delete(id);
    }
  }

  threatPos3(id: number) {
    return this.rocks.get(id)?.position ?? null;
  }

  clear() {
    for (const [, e] of this.map) {
      this.group.remove(e.mesh.group);
      if (e.orbit) this.group.remove(e.orbit);
      e.mesh.dispose();
    }
    this.map.clear();
    for (const [, m] of this.rocks) this.group.remove(m);
    this.rocks.clear();
    if (this.belts) {
      this.group.remove(this.belts);
      this.belts = null;
    }
  }
}
