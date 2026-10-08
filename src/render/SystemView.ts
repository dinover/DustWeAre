import * as THREE from 'three';
import { omega, toWorld, type GameState, type Ship, type ShipKind, type World } from '../core/state';
import { worldStats, isGiantStuff } from '../sim/worlds';
import { isSettled } from '../sim/civ';
import { peopleOf } from '../sim/peoples';
import { PlanetMesh, baseLook, lookOfWorld, ringStyleOf, type Look } from './Planet';
import { glowTexture } from './Stage';
import { worldRadius, worldXZ } from './layout';
import { Rng, TAU, easeInOut } from '../util';
import { ShipHulls, type Hull } from './Ships';
import { BARGE_Y } from '../sim/patrols';

const MAX_SHIPS = 96;
/** Ships plus armada formation slots plus patrols. */
const MAX_POINTS = 220;
const TRAIL = 12;
const MAX_SATS = 220;
const DYSON = 900;

/** Engine glow size per kind. */
const KIND_SIZE: Partial<Record<ShipKind, number>> = { freight: 0.5, tanker: 0.6, miner: 0.45, trader: 0.9, refugee: 0.9, expedition: 0.9, flotilla: 0.8, armada: 0.9, alien: 0.9, mother: 2.4, ark: 2.2, pod: 0.9, gunship: 0.8 };
/** Hull shape, true size (world units) and smallest on-screen size (pixels) per kind. */
const HULL_OF: Record<ShipKind, { hull: Hull; size: number; px: number }> = {
  colony: { hull: 'challenger', size: 0.6, px: 15 },
  expedition: { hull: 'zenith', size: 0.7, px: 16 },
  flotilla: { hull: 'challenger', size: 0.62, px: 15 },
  armada: { hull: 'striker', size: 0.7, px: 16 },
  raider: { hull: 'striker', size: 0.62, px: 15 },
  freight: { hull: 'bob', size: 0.55, px: 12 },
  miner: { hull: 'bob', size: 0.42, px: 10 },
  tanker: { hull: 'insurgent', size: 0.6, px: 13 },
  trader: { hull: 'dispatcher', size: 0.85, px: 16 },
  refugee: { hull: 'zenith', size: 0.65, px: 14 },
  alien: { hull: 'omen', size: 0.75, px: 16 },
  mother: { hull: 'pancake', size: 2.8, px: 38 },
  ark: { hull: 'ark', size: 1.8, px: 22 },
  pod: { hull: 'pod', size: 0.42, px: 6 },
  gunship: { hull: 'executioner', size: 0.65, px: 8 },
};
/**
 * The battle barge's true size. It keeps it at every zoom, like the worlds (no minimum size on
 * screen: from afar it would swell far beyond the planets).
 */
const BARGE_SIZE = 4.6;
/** Each people's shipyards favour one warship design. */
const WARSHIPS: Hull[] = ['striker', 'spitfire', 'zenith'];
const hullOf = (kind: ShipKind, people?: number): Hull => (kind === 'armada' || kind === 'raider' ? WARSHIPS[(people ?? 0) % WARSHIPS.length] : HULL_OF[kind].hull);
/** Space Patrol engines burn blue-white; their gunships wear ultramarine stripes. */
const PATROL_GLOW = new THREE.Color(0.75, 0.85, 1);
const PATROL_ACCENT = new THREE.Color(0.25, 0.42, 1);
/** Height of each barge of the formation above or below the flagship: they stack in tiers. */
const TIERS = [0, 2.6, -2.2, 4.4, -3.8, 6, -5.2, 7.6, -6.4, 9];
/** Integer hash for the patrol craft routes (deterministic, so they need no state). */
const hop = (a: number, b: number) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % 1000003;
/** The Freedom Wings fly in pale gold. */
const WINGS_TINT = new THREE.Color(1, 0.86, 0.55);

/** Faction colours: every people its own hue, traders gold, refugees teal, invaders violet. */
export const FACTION = { trader: new THREE.Color(1, 0.8, 0.32), refugee: new THREE.Color(0.45, 0.95, 0.85) };

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
  private craftPorts: { x: number; z: number; r: number }[] = [];
  private craftPos = new THREE.Vector3();
  private craftDir = new THREE.Vector3();
  private orbitGeo: THREE.BufferGeometry;
  private belts: THREE.Points | null = null;
  private beltData: { r: number; th: number; s: number }[] = [];
  private beltCount = -1;
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

  private hulls = new ShipHulls();
  private flashCol = new THREE.Color();

  constructor(
    private hi: boolean,
    private camera: THREE.Camera,
  ) {
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
    this.group.add(ships, trails, sats, this.threatLines, this.hulls.group);
    const amb = new THREE.AmbientLight(0x403028, 0.6);
    // Soft light from the galaxy above, so the ships' night sides are never pitch black.
    const sky = new THREE.HemisphereLight(0xb8c4e0, 0x2a2018, 0.9);
    this.group.add(amb, sky);
  }

  setBelts(belts: { r: number; th: number; s: number }[]) {
    if (this.belts) {
      this.group.remove(this.belts);
      this.belts.geometry.dispose();
    }
    this.beltData = belts;
    this.beltCount = belts.length;
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
    // Space Patrol drop pods and gunships leave the battle barge, high above the plane.
    if (sh.from === -7) {
      const to = this.byId.get(sh.to);
      if (!to) return out.set(0, -999, 0);
      worldXZ(to, this.byId, this.tmp2);
      const kk = Math.min(1, Math.max(0, k));
      const pod = sh.kind === 'pod';
      const e = pod ? kk * kk : easeInOut(kk);
      const sx = sh.sx ?? 0;
      const sz = sh.sz ?? 0;
      const y0 = pod ? BARGE_Y * 0.6 : BARGE_Y * 0.55;
      const bow = pod ? 0 : Math.sin(Math.PI * e) * 2.2 * (sh.id % 2 ? 1 : -1);
      const dx = this.tmp2.x - sx;
      const dz = this.tmp2.z - sz;
      const len = Math.hypot(dx, dz) || 1;
      out.set(sx + dx * e - (dz / len) * bow, y0 * (1 - e) + (pod ? 0 : Math.sin(Math.PI * e) * 1.2), sz + dz * e + (dx / len) * bow);
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

  setScale(heightPx: number, fovDeg: number, cssHeight: number) {
    const t = 2 * Math.tan((fovDeg * Math.PI) / 360);
    this.shipMat.uniforms.uScale.value = heightPx / t;
    this.hulls.pxScale = t / Math.max(1, cssHeight);
  }

  /** The colour that tells who a ship belongs to. */
  private shipColor(s: GameState, sh: Ship, kind: ShipKind, out: THREE.Color) {
    if (sh.alien) return out.setHSL(s.alienSpecies?.hue ?? 0.86, 0.85, kind === 'mother' ? 0.5 : 0.58);
    if (kind === 'trader') return out.copy(FACTION.trader);
    if (kind === 'refugee') return out.copy(FACTION.refugee);
    if (kind === 'ark') return out.setRGB(1, 0.95, 0.82);
    if (kind === 'pod') return out.copy(PATROL_GLOW);
    if (kind === 'gunship') return out.copy(PATROL_ACCENT);
    const cargo = kind === 'freight' || kind === 'miner' || kind === 'tanker';
    // Whose ship: its own mark, else the people of the world it left (or is heading to).
    let pid = sh.people ?? 0;
    if (!pid) {
      const w = this.byId.get(sh.from) ?? this.byId.get(sh.to);
      if (w) pid = peopleOf(w);
    }
    const hue = pid ? this.peopleHue(s, pid) : sh.from === -1 && s.legacySpecies ? s.legacySpecies.hue : -1;
    if (hue < 0) return out.setHSL(0.11, 0.25, 0.75);
    return out.setHSL(hue, cargo ? 0.6 : 0.85, cargo ? 0.52 : 0.6);
  }

  private peopleHue(s: GameState, id: number) {
    const p = s.peoples?.find((x) => x.id === id);
    return p ? p.hue : -1;
  }

  /** Colour of a people (pale gold for a mixed or unknown crew). */
  private peopleColor(s: GameState, id: number | undefined, out: THREE.Color, sat = 0.85, l = 0.6) {
    const hue = id ? this.peopleHue(s, id) : -1;
    return hue < 0 ? out.setHSL(0.11, 0.3, 0.72) : out.setHSL(hue, sat, l);
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
        e.mesh.setRing(w.ring ? ringStyleOf(w, st.kind === 'icegiant') : null);
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

    // Asteroid belts drift with their orbits (and grow when impacts leave debris).
    if (s.belts.length !== this.beltCount) this.setBelts(s.belts);
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

    // Ships: a small 3D hull each, an engine glow and a fading trail.
    const v = new THREE.Vector3();
    const q = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const hue = new THREE.Color();
    const cam = this.camera.position;
    this.shipXYZ.clear();
    this.hulls.begin();
    let n = 0;
    const civ = s.civ;
    for (const sh of s.ships) {
      if (n >= MAX_SHIPS) break;
      const k = sh.t / sh.dur;
      if (k < 0) continue;
      this.shipPath(s, sh, k, v);
      this.shipXYZ.set(sh.id, v.clone());
      const kind: ShipKind = sh.kind ?? (sh.ark ? 'ark' : sh.alien ? 'alien' : 'colony');
      this.shipColor(s, sh, kind, hue);
      // Heading: towards where it will be a moment later.
      if (k < 0.98) this.shipPath(s, sh, k + 0.01, q), dir.subVectors(q, v);
      else this.shipPath(s, sh, k - 0.01, q), dir.subVectors(v, q);
      const spec = HULL_OF[kind];
      const flash = sh.doom !== undefined ? 1 + 1.5 * Math.abs(Math.sin(time * 30)) : 1;
      this.hulls.add(hullOf(kind, sh.people), v, dir, flash > 1 ? this.flashCol.copy(hue).multiplyScalar(flash) : hue, spec.size, spec.px, cam);
      // Engine glow just behind the hull.
      dir.normalize();
      const back = Math.max(spec.size, spec.px * this.hulls.pxScale * cam.distanceTo(v)) * 0.55;
      this.shipPos.set([v.x - dir.x * back, v.y - dir.y * back, v.z - dir.z * back], n * 3);
      this.shipCol.set([hue.r * 1.3 * flash, hue.g * 1.3 * flash, hue.b * 1.3 * flash], n * 3);
      this.shipSize[n] = KIND_SIZE[kind] ?? 0.8;
      const step = sh.ark ? 0.02 : kind === 'mother' ? 0.016 : 0.012;
      const trail = kind === 'freight' || kind === 'miner' || kind === 'tanker' ? 0.35 : 0.7;
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
      dir.set(fx, 0, fz);
      for (let i = 0; i < count && p < MAX_POINTS; i++, p++) {
        // Every people sends its own ships: the formation shows them side by side.
        this.peopleColor(s, ar.crew?.[i], hue, 0.8, 0.62);
        const hull = hullOf('armada', ar.crew?.[i]);
        const row = Math.floor((i + 1) / 2);
        const side = i === 0 ? 0 : i % 2 ? 1 : -1;
        const back = row * 1.25;
        const lat = side * row * 1.0;
        const bob = Math.sin(time * 2 + i) * 0.15;
        v.set(ar.x - fx * back - fz * lat, 1 + bob, ar.z - fz * back + fx * lat);
        this.hulls.add(hull, v, dir, hue, 0.75, 14, cam);
        const glow = ar.phase === 'hold' ? 1.3 + 0.8 * Math.min(1, ar.t / 9) : 1.1;
        this.shipPos.set([v.x - fx * 0.6, v.y, v.z - fz * 0.6], p * 3);
        this.shipCol.set([hue.r * glow, hue.g * glow, hue.b * glow], p * 3);
        this.shipSize[p] = 0.9;
      }
    }
    // Colonists waiting for the jump to another star.
    const fl = civ?.flotilla;
    if (fl && fl.gathered > 0) {
      const len = Math.hypot(fl.x, fl.z) || 1;
      const fx = fl.x / len;
      const fz = fl.z / len;
      dir.set(fx, 0, fz);
      this.peopleColor(s, fl.people, hue, 0.8, 0.62);
      for (let i = 0; i < fl.gathered && p < MAX_POINTS; i++, p++) {
        const row = Math.floor((i + 1) / 2);
        const side = i === 0 ? 0 : i % 2 ? 1 : -1;
        v.set(fl.x - fx * row * 1.1 - fz * side * row * 0.9, 1 + Math.sin(time * 2 + i) * 0.12, fl.z - fz * row * 1.1 + fx * side * row * 0.9);
        this.hulls.add('challenger', v, dir, hue, 0.62, 13, cam);
        this.shipPos.set([v.x - fx * 0.5, v.y, v.z - fz * 0.5], p * 3);
        this.shipCol.set([hue.r * 1.2, hue.g * 1.2, hue.b * 1.2], p * 3);
        this.shipSize[p] = 0.8;
      }
    }
    // The armada over an enemy world: circling it while the battle rages.
    if (ar && ar.phase === 'battle') {
      for (let i = 0; i < ar.launched && p < MAX_POINTS; i++, p++) {
        this.peopleColor(s, ar.crew?.[i], hue, 0.8, 0.62);
        const a = time * 0.9 + (i / ar.launched) * TAU;
        const r = 5 + (i % 3) * 1.2;
        v.set(ar.x + Math.cos(a) * r, 1 + Math.sin(a * 3) * 0.4, ar.z + Math.sin(a) * r);
        dir.set(-Math.sin(a), 0, Math.cos(a));
        this.hulls.add(hullOf('armada', ar.crew?.[i]), v, dir, hue, 0.7, 13, cam);
        this.shipPos.set([v.x, v.y, v.z], p * 3);
        this.shipCol.set([hue.r, hue.g, hue.b], p * 3);
        this.shipSize[p] = 0.7;
      }
    }
    // Defence fleet: guard ships circling every settled world.
    if (civ?.done.fleet) {
      for (const w of s.worlds) {
        if (!isSettled(w)) continue;
        this.peopleColor(s, peopleOf(w), hue, 0.75, 0.6);
        const c = worldXZ(w, this.byId, this.tmp);
        const r = worldRadius(w) * 2.1 + 1;
        for (let j = 0; j < 3; j++) {
          const a = time * 1.4 + j * 2.094 + w.id;
          v.set(c.x + Math.cos(a) * r, Math.sin(a * 2) * 0.3, c.z + Math.sin(a) * r);
          dir.set(-Math.sin(a), 0, Math.cos(a));
          this.hulls.add('bob', v, dir, hue, 0.4, 8, cam);
        }
      }
    }
    // The Space Patrols' battle barge on its high orbit (the biggest hull of the pack, in their
    // ultramarine), its gunships flying escort: one more for every company.
    const pt = s.patrol;
    if (pt && pt.phase !== 'away') {
      v.set(pt.x, pt.y, pt.z);
      if (pt.phase === 'orbit' || pt.phase === 'rising') dir.set(-Math.sin(pt.ang), 0, Math.cos(pt.ang));
      else if (pt.phase === 'assault' && pt.target !== undefined && this.byId.get(pt.target)) {
        const c = worldXZ(this.byId.get(pt.target)!, this.byId, this.tmp);
        dir.set(c.x - pt.x, 0, c.z - pt.z);
      } else dir.set(pt.x - pt.sx, 0, pt.z - pt.sz);
      if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(pt.ang), 0, Math.cos(pt.ang));
      dir.normalize();
      const model = this.hulls.has('imperial');
      if (model) hue.copy(PATROL_ACCENT);
      else hue.setRGB(1, 1, 1);
      const hull: Hull = model ? 'imperial' : 'barge';
      this.hulls.add(hull, v, dir, hue, BARGE_SIZE, 0, cam);
      const scale = BARGE_SIZE;
      // Every company at home is one more barge, flying in echelon behind the flagship.
      const total = Math.max(1, s.civ?.def?.patrol ?? 1);
      const home = total - (pt.detach ?? []).reduce((n, d) => n + d.companies, 0);
      // Every company at home is one more barge, in echelon behind the flagship and stacked in tiers.
      for (let i = 1; i < home; i++) {
        const row = Math.ceil(i / 2);
        const side = i % 2 ? 1 : -1;
        q.set(
          v.x - dir.x * row * scale * 0.95 - dir.z * side * row * scale * 0.62,
          v.y + TIERS[i % TIERS.length] + Math.sin(time * 0.7 + i) * 0.15,
          v.z - dir.z * row * scale * 0.95 + dir.x * side * row * scale * 0.62,
        );
        this.hulls.add(hull, q, dir, hue, BARGE_SIZE * 0.92, 0, cam);
      }
      p = this.patrolCraft(s, Math.max(1, home), time, cam, p);
      if (p < MAX_POINTS) {
        this.shipPos.set([v.x - dir.x * scale * 0.55, v.y, v.z - dir.z * scale * 0.55], p * 3);
        this.shipCol.set([PATROL_GLOW.r, PATROL_GLOW.g, PATROL_GLOW.b * 1.2], p * 3);
        this.shipSize[p] = 1;
        p++;
      }
      const escorts = 2;
      for (let j = 0; j < escorts; j++) {
        const a = time * 0.8 + (j * TAU) / escorts;
        const r = scale * (0.72 + 0.08 * (j % 2));
        q.set(v.x + Math.cos(a) * r, v.y + Math.sin(a * 2) * 0.3, v.z + Math.sin(a) * r);
        this.craftDir.set(-Math.sin(a), 0, Math.cos(a));
        this.hulls.add('executioner', q, this.craftDir, PATROL_ACCENT, 0.55, 6, cam);
      }
    }
    // The Freedom Wings at home: three squadrons of fighters circling the home world, more as they grow.
    const wg = s.wings;
    if (wg && wg.units > 0) {
      const base = s.worlds.find((w) => w.life?.origin && w.life.stage >= 3) ?? s.worlds.find((w) => isSettled(w));
      if (base) {
        const c = worldXZ(base, this.byId, this.tmp);
        const cx = c.x;
        const cz = c.z;
        const n = Math.min(12, Math.ceil(wg.units / 4));
        const r0 = worldRadius(base) * 2.6 + 1.6;
        for (let j = 0; j < n; j++) {
          const sq = j % 3;
          const a = time * (0.45 + 0.08 * sq) + Math.floor(j / 3) * 0.32 + sq * 2.1;
          const r = r0 + sq * 0.7;
          v.set(cx + Math.cos(a) * r, 0.6 + sq * 0.35 + Math.sin(a * 3) * 0.1, cz + Math.sin(a) * r);
          dir.set(-Math.sin(a), 0, Math.cos(a));
          this.hulls.add('spitfire', v, dir, WINGS_TINT, 0.36, 9, cam);
        }
      }
    }
    this.hulls.end();
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
  /**
   * Smaller Space Patrol craft sweep the system while barges are at home — three for each one —
   * hopping from settled world to settled world (or circling the star) at their own heights.
   * Returns the next free engine-glow point.
   */
  private patrolCraft(s: GameState, barges: number, time: number, cam: THREE.Vector3, p: number) {
    const ports = this.craftPorts;
    ports.length = 0;
    for (const w of s.worlds) {
      if (!isSettled(w)) continue;
      const c = worldXZ(w, this.byId, this.tmp);
      ports.push({ x: c.x, z: c.z, r: worldRadius(w) * 2 + 1.4 });
    }
    const n = Math.min(12, barges * 3);
    const at = this.craftPos;
    const dir = this.craftDir;
    for (let i = 0; i < n; i++) {
      const alt = 1.6 + (i % 4) * 1.1;
      if (ports.length >= 2) {
        // Legs of 9–13 s between two worlds, each craft on its own route.
        const seg = 9 + (i % 3) * 2;
        const tt = time / seg + i * 1.37;
        const leg = Math.floor(tt);
        const f = tt - leg;
        const ai = hop(leg, i) % ports.length;
        let bi = hop(leg + 1, i) % ports.length;
        if (bi === ai) bi = (ai + 1) % ports.length;
        const A = ports[ai];
        const B = ports[bi];
        let dx = B.x - A.x;
        let dz = B.z - A.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        // Leave and arrive just outside each world, curving a little to one side.
        const ax = A.x + dx * A.r;
        const az = A.z + dz * A.r;
        const bx = B.x - dx * B.r;
        const bz = B.z - dz * B.r;
        const k = easeInOut(f);
        const bend = Math.sin(Math.PI * f) * Math.min(4, len * 0.15) * (i % 2 ? 1 : -1);
        at.set(ax + (bx - ax) * k - dz * bend, alt + Math.sin(Math.PI * f) * 1.8, az + (bz - az) * k + dx * bend);
        dir.set(bx - ax, 0, bz - az);
      } else {
        const a = time * (0.05 + 0.01 * (i % 3)) + i * 1.9;
        const r = 18 + (i % 4) * 7;
        at.set(Math.cos(a) * r, alt, Math.sin(a) * r);
        dir.set(-Math.sin(a), 0, Math.cos(a));
      }
      this.hulls.add('executioner', at, dir, PATROL_ACCENT, 0.5, 6, cam);
      if (p < MAX_POINTS) {
        dir.normalize();
        this.shipPos.set([at.x - dir.x * 0.4, at.y, at.z - dir.z * 0.4], p * 3);
        this.shipCol.set([PATROL_GLOW.r, PATROL_GLOW.g, PATROL_GLOW.b], p * 3);
        this.shipSize[p] = 0.5;
        p++;
      }
    }
    return p;
  }

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
          ...baseLook(rg.seed),
          rock: [0.16, 0.15, 0.16],
          rock2: [0.3, 0.28, 0.3],
          ice: 0.35,
          lava: 0.15,
          crater: 0.8,
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
