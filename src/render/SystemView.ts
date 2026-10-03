import * as THREE from 'three';
import { omega, toWorld, type GameState, type Ship, type ShipKind, type World } from '../core/state';
import { worldStats, isGiantStuff } from '../sim/worlds';
import { isSettled } from '../sim/civ';
import { PlanetMesh, lookOfWorld, type Look } from './Planet';
import { glowTexture } from './Stage';
import { worldRadius, worldXZ } from './layout';
import { Rng, TAU, easeInOut } from '../util';

const MAX_SHIPS = 96;
/** Ships plus armada formation slots plus patrols. */
const MAX_POINTS = 220;
const TRAIL = 12;
const MAX_SATS = 220;
const DYSON = 900;

const KIND_SIZE: Partial<Record<ShipKind, number>> = { freight: 0.9, tanker: 1.1, miner: 0.8, trader: 1.3, refugee: 1.4, expedition: 1.5, armada: 1.2, alien: 1.4, mother: 3.6, ark: 3 };
const KIND_RGB: Partial<Record<ShipKind, [number, number, number]>> = {
  freight: [1, 0.86, 0.62],
  tanker: [1, 0.62, 0.28],
  miner: [0.95, 0.52, 0.32],
  trader: [1, 0.92, 0.45],
  refugee: [0.5, 0.95, 0.85],
  expedition: [1, 0.97, 0.85],
  ark: [1, 0.95, 0.8],
};

const SHIP_VS = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vC;
  void main() {
    vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize > 0.0 ? clamp(aSize * uScale / -mv.z, 2.5, 5.0 + aSize * 4.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const SHIP_FS = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vC;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).r;
    gl_FragColor = vec4(vC * a, a);
  }`;

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
  private shipMat: THREE.ShaderMaterial;
  private shipPos = new Float32Array(MAX_POINTS * 3);
  private shipCol = new Float32Array(MAX_POINTS * 3);
  private shipSize = new Float32Array(MAX_POINTS);
  private dyson: THREE.Points;
  private dysonGeo: THREE.BufferGeometry;
  private ringMesh: THREE.Mesh;
  private elevator: THREE.Line;
  private elevatorTop: THREE.Sprite;
  private rogue: PlanetMesh | null = null;
  private rogueGlow: THREE.Sprite;
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
    this.shipGeo.setAttribute('aColor', new THREE.BufferAttribute(this.shipCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.shipGeo.setAttribute('aSize', new THREE.BufferAttribute(this.shipSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.shipMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uMap: { value: glowTexture() } },
      vertexShader: SHIP_VS,
      fragmentShader: SHIP_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ships = new THREE.Points(this.shipGeo, this.shipMat);
    ships.frustumCulled = false;

    // Dyson swarm: collectors on tilted rings around the star.
    this.dysonGeo = new THREE.BufferGeometry();
    const dp = new Float32Array(DYSON * 3);
    const dr = new Rng(77);
    for (let i = 0; i < DYSON; i++) {
      const ring = i % 7;
      const a = dr.range(0, TAU);
      const r = 5.6 + ring * 0.42 + dr.gauss(0, 0.08);
      const tilt = (ring - 3) * 0.42;
      const node = ring * 0.9;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * Math.sin(tilt);
      const z = Math.sin(a) * r * Math.cos(tilt);
      dp[i * 3] = x * Math.cos(node) - z * Math.sin(node);
      dp[i * 3 + 1] = y;
      dp[i * 3 + 2] = x * Math.sin(node) + z * Math.cos(node);
    }
    this.dysonGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dyson = new THREE.Points(
      this.dysonGeo,
      new THREE.PointsMaterial({ size: 0.32, color: 0xffd28a, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.dyson.visible = false;
    // Orbital ring around the home world.
    this.ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.035, 8, 120),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ringMesh.visible = false;
    // Space elevator: a thread of light from the home world to its station.
    const eg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    this.elevator = new THREE.Line(eg, new THREE.LineBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.8, depthWrite: false }));
    this.elevator.visible = false;
    this.elevatorTop = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe0a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.elevatorTop.visible = false;
    this.rogueGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7a2a18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    this.rogueGlow.visible = false;
    this.group.add(this.dyson, this.ringMesh, this.elevator, this.elevatorTop, this.rogueGlow);
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

  private beltXZ(s: GameState, i: number, out: { x: number; z: number }) {
    const b = this.beltData[i % Math.max(1, this.beltData.length)];
    if (!b) return (out.x = out.z = 0), out;
    const th = b.th + omega(b.r) * 0.42 * s.time;
    const rw = toWorld(b.r);
    out.x = Math.cos(th) * rw;
    out.z = Math.sin(th) * rw;
    return out;
  }

  /** Where a ship is at progress k (0..1). */
  private shipPath(s: GameState, sh: Ship, k: number, out: THREE.Vector3) {
    if (sh.ark) {
      const home = this.byId.get(sh.from);
      if (home) worldXZ(home, this.byId, this.tmp);
      else this.tmp.x = this.tmp.z = 0;
      const ang = Math.atan2(this.tmp.z, this.tmp.x) + 0.3;
      const kk = k * k;
      out.set(this.tmp.x + Math.cos(ang) * kk * 180, kk * 60, this.tmp.z + Math.sin(ang) * kk * 180);
      return out;
    }
    // Start point.
    const from = sh.from >= 0 ? this.byId.get(sh.from) : null;
    if (from) worldXZ(from, this.byId, this.tmp);
    else if (sh.sx !== undefined && sh.sz !== undefined) {
      this.tmp.x = sh.sx;
      this.tmp.z = sh.sz;
    } else if (sh.from === -2 && sh.belt !== undefined) this.beltXZ(s, sh.belt, this.tmp);
    else {
      // Visitors come from deep space.
      const a = (Math.abs(sh.from) * 2.399) % TAU;
      this.tmp.x = Math.cos(a) * 110;
      this.tmp.z = Math.sin(a) * 110;
    }
    // End point.
    if (sh.to >= 0) {
      const to = this.byId.get(sh.to);
      if (!to) return out.set(0, -999, 0);
      worldXZ(to, this.byId, this.tmp2);
    } else if (sh.belt !== undefined && !sh.back) this.beltXZ(s, sh.belt, this.tmp2);
    else {
      this.tmp2.x = sh.tx ?? 0;
      this.tmp2.z = sh.tz ?? 0;
    }
    const e = easeInOut(Math.min(1, Math.max(0, k)));
    const dx = this.tmp2.x - this.tmp.x;
    const dz = this.tmp2.z - this.tmp.z;
    const len = Math.hypot(dx, dz) || 1;
    // Arc to one side; when the straight route would cross the star, arc around it instead.
    const nx = -dz / len;
    const nz = dx / len;
    const mx = (this.tmp.x + this.tmp2.x) / 2;
    const mz = (this.tmp.z + this.tmp2.z) / 2;
    const dm = Math.hypot(mx, mz);
    const clear = Math.max(9, 0.55 * Math.min(Math.hypot(this.tmp.x, this.tmp.z), Math.hypot(this.tmp2.x, this.tmp2.z)));
    let bowMax = Math.min(len * 0.22, 9);
    let bowSign = sh.id % 2 ? 1 : -1;
    if (dm < clear) {
      const side = nx * mx + nz * mz;
      bowSign = side >= 0 ? 1 : -1;
      bowMax = Math.max(bowMax, clear - Math.abs(side));
    }
    const bow = Math.sin(Math.PI * e) * bowMax * bowSign;
    out.set(this.tmp.x + dx * e - (dz / len) * bow, Math.sin(Math.PI * e) * Math.min(len * 0.12, 5), this.tmp.z + dz * e + (dx / len) * bow);
    return out;
  }

  setScale(heightPx: number, fovDeg: number) {
    this.shipMat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
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
    const q = new THREE.Vector3();
    const hue = new THREE.Color();
    this.shipXYZ.clear();
    let n = 0;
    const sp = s.species?.hue ?? 0.35;
    const civ = s.civ;
    for (const sh of s.ships) {
      if (n >= MAX_SHIPS) break;
      const k = sh.t / sh.dur;
      if (k < 0) continue;
      this.shipPath(s, sh, k, v);
      this.shipXYZ.set(sh.id, v.clone());
      const kind: ShipKind = sh.kind ?? (sh.ark ? 'ark' : sh.alien ? 'alien' : 'colony');
      const rgb = KIND_RGB[kind];
      if (sh.alien) hue.setHSL(alienHue, 0.8, kind === 'mother' ? 0.5 : 0.62);
      else if (rgb) hue.setRGB(rgb[0], rgb[1], rgb[2]);
      else hue.setHSL(sp, kind === 'armada' ? 0.75 : 0.55, kind === 'armada' ? 0.7 : 0.62);
      const flash = sh.doom !== undefined ? 1 + 1.5 * Math.abs(Math.sin(time * 30)) : 1;
      this.shipPos.set([v.x, v.y, v.z], n * 3);
      this.shipCol.set([hue.r * 1.4 * flash, hue.g * 1.4 * flash, hue.b * 1.4 * flash], n * 3);
      this.shipSize[n] = KIND_SIZE[kind] ?? 1.5;
      const step = sh.ark ? 0.02 : kind === 'mother' ? 0.016 : 0.012;
      const trail = kind === 'freight' || kind === 'miner' ? 0.45 : 0.75;
      let prev = v.clone();
      for (let j = 0; j < TRAIL; j++) {
        this.shipPath(s, sh, Math.max(0, k - (j + 1) * step), q);
        const o = (n * TRAIL + j) * 6;
        this.trailPos.set([prev.x, prev.y, prev.z, q.x, q.y, q.z], o);
        const f0 = (1 - j / TRAIL) * trail;
        const f1 = (1 - (j + 1) / TRAIL) * trail;
        this.trailCol.set([hue.r * f0, hue.g * f0, hue.b * f0, hue.r * f1, hue.g * f1, hue.b * f1], o);
        prev.copy(q);
      }
      n++;
    }
    for (let i = n; i < MAX_SHIPS; i++) {
      for (let j = 0; j < TRAIL * 6; j++) this.trailPos[i * TRAIL * 6 + j] = 0;
      for (let j = 0; j < TRAIL * 6; j++) this.trailCol[i * TRAIL * 6 + j] = 0;
    }
    let p = n;
    // The armada in formation: a chevron pointing out to the stars.
    const ar = civ?.armada;
    if (ar && (ar.phase === 'rally' || ar.phase === 'hold')) {
      const count = ar.phase === 'hold' ? ar.launched : ar.gathered;
      const len = Math.hypot(ar.x, ar.z) || 1;
      const fx = ar.x / len;
      const fz = ar.z / len;
      hue.setHSL(sp, 0.75, 0.7);
      for (let i = 0; i < count && p < MAX_POINTS; i++, p++) {
        const row = Math.floor((i + 1) / 2);
        const side = i === 0 ? 0 : i % 2 ? 1 : -1;
        const back = row * 0.95;
        const lat = side * row * 0.75;
        const bob = Math.sin(time * 2 + i) * 0.15;
        this.shipPos.set([ar.x - fx * back - fz * lat, 1 + bob + (ar.phase === 'hold' ? Math.sin(time * 6) * 0.05 : 0), ar.z - fz * back + fx * lat], p * 3);
        const glow = ar.phase === 'hold' ? 1.3 + 0.6 * Math.min(1, ar.t / 9) : 1.2;
        this.shipCol.set([hue.r * glow, hue.g * glow, hue.b * glow], p * 3);
        this.shipSize[p] = 1.2;
      }
    }
    // Defence fleet: guard ships circling every settled world.
    if (civ?.done.fleet) {
      hue.setHSL(sp, 0.7, 0.66);
      for (const w of s.worlds) {
        if (!isSettled(w)) continue;
        const c = worldXZ(w, this.byId, this.tmp);
        const r = worldRadius(w) * 2.1 + 1;
        for (let j = 0; j < 3 && p < MAX_POINTS; j++, p++) {
          const a = time * 1.4 + j * 2.094 + w.id;
          this.shipPos.set([c.x + Math.cos(a) * r, Math.sin(a * 2) * 0.3, c.z + Math.sin(a) * r], p * 3);
          this.shipCol.set([hue.r, hue.g, hue.b], p * 3);
          this.shipSize[p] = 0.8;
        }
      }
    }
    for (let i = p; i < MAX_POINTS; i++) this.shipSize[i] = 0;
    this.shipGeo.attributes.position.needsUpdate = true;
    this.shipGeo.attributes.aColor.needsUpdate = true;
    this.shipGeo.attributes.aSize.needsUpdate = true;
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;

    this.updateWorks(s, time);

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

  /** Great works: Dyson swarm, orbital ring, space elevator, and the wandering planet. */
  private updateWorks(s: GameState, time: number) {
    const civ = s.civ;
    const b = civ?.building;
    const progress = (id: string) => (civ?.done[id] ? 1 : b?.id === id ? b.t / b.dur : 0);
    const dys = progress('dyson');
    this.dyson.visible = dys > 0;
    if (dys > 0) {
      this.dysonGeo.setDrawRange(0, Math.floor(DYSON * dys));
      this.dyson.rotation.y = time * 0.05;
      this.dyson.rotation.x = Math.sin(time * 0.03) * 0.08;
    }
    const origin = s.worlds.find((w) => w.life?.origin && w.life.stage >= 3) ?? s.worlds.find((w) => w.colony >= 1) ?? null;
    const ring = progress('ring');
    this.ringMesh.visible = ring > 0 && !!origin;
    const elev = progress('elevator');
    this.elevator.visible = this.elevatorTop.visible = elev > 0 && !!origin;
    if (origin) {
      const c = worldXZ(origin, this.byId, this.tmp);
      const r = worldRadius(origin);
      if (ring > 0) {
        this.ringMesh.position.set(c.x, 0, c.z);
        this.ringMesh.scale.setScalar(r * 1.75);
        this.ringMesh.rotation.set(Math.PI / 2 + 0.25, 0, time * 0.05);
        (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.6 * ring;
      }
      if (elev > 0) {
        const len = Math.hypot(c.x, c.z) || 1;
        const ux = c.x / len;
        const uz = c.z / len;
        const L = r + r * 3.2 * elev;
        this.elevator.position.set(c.x + ux * r, 0, c.z + uz * r);
        this.elevator.scale.setScalar(L - r);
        this.elevator.rotation.set(0, -Math.atan2(uz, ux), 0);
        this.elevatorTop.position.set(c.x + ux * L, 0, c.z + uz * L);
        this.elevatorTop.scale.setScalar(1.4 + 0.2 * Math.sin(time * 3));
      }
    }
    // The wandering planet.
    const rg = civ?.rogue;
    if (rg) {
      if (!this.rogue) {
        this.rogue = new PlanetMesh(this.hi, rg.seed);
        const look: Look = {
          seed: (rg.seed % 1000) / 37,
          rock: [0.16, 0.15, 0.16],
          rock2: [0.3, 0.28, 0.3],
          ocean: 0,
          ice: 0.35,
          veg: 0,
          city: 0,
          lava: 0.15,
          cloud: 0,
          gas: 0,
          band1: [0, 0, 0],
          band2: [0, 0, 0],
          invade: 0,
          atm: 0.2,
          atmCol: [0.6, 0.3, 0.25],
        };
        this.rogue.setLook(look);
        this.rogue.setRadius(1.6);
        this.group.add(this.rogue.group);
      }
      const k = rg.t / rg.dur;
      const d = toWorld(9) + rg.off;
      const along = (k - 0.5) * 260;
      const nx = Math.cos(rg.ang);
      const nz = Math.sin(rg.ang);
      this.rogue.group.position.set(nx * d - nz * along, 0.5, nz * d + nx * along);
      this.rogue.update(0.016, time, 0);
      this.rogueGlow.visible = true;
      this.rogueGlow.position.copy(this.rogue.group.position);
      this.rogueGlow.scale.setScalar(7);
    } else if (this.rogue) {
      this.group.remove(this.rogue.group);
      this.rogue.dispose();
      this.rogue = null;
      this.rogueGlow.visible = false;
    }
  }

  roguePos() {
    return this.rogue ? this.rogue.group.position : null;
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
