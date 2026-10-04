import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Real ship models: the Quaternius “Ultimate Spaceships” pack (CC0), converted to glTF with a
 * 512 px texture and an accent mask, so each people's colour goes on the livery stripes.
 */
export type ModelHull = 'striker' | 'spitfire' | 'zenith' | 'challenger' | 'bob' | 'dispatcher' | 'executioner' | 'imperial' | 'insurgent' | 'omen' | 'pancake';
export type Hull = 'dart' | 'hauler' | 'tanker' | 'diamond' | 'claw' | 'mother' | 'orb' | 'ark' | 'barge' | 'pod' | 'gunship' | ModelHull;
type ProcHull = Exclude<Hull, ModelHull>;

const MODELS: Record<ModelHull, { cap: number; fallback: ProcHull }> = {
  striker: { cap: 120, fallback: 'dart' },
  spitfire: { cap: 120, fallback: 'dart' },
  zenith: { cap: 120, fallback: 'dart' },
  challenger: { cap: 80, fallback: 'dart' },
  bob: { cap: 60, fallback: 'hauler' },
  dispatcher: { cap: 30, fallback: 'diamond' },
  executioner: { cap: 40, fallback: 'gunship' },
  imperial: { cap: 80, fallback: 'hauler' },
  insurgent: { cap: 50, fallback: 'tanker' },
  omen: { cap: 70, fallback: 'claw' },
  pancake: { cap: 8, fallback: 'mother' },
};

/** Space Patrol livery: ultramarine plate, gold trim, a little bone and iron. */
const BLUE: [number, number, number] = [0.16, 0.3, 0.78];
const GOLD: [number, number, number] = [1, 0.78, 0.3];
const IRON: [number, number, number] = [0.42, 0.44, 0.5];
const BONE: [number, number, number] = [0.93, 0.88, 0.76];
type Paint = [number, number, number];

/** Space Patrol hulls are painted part by part (their colour is not the faction tint). */
function paintedGeometry(h: Hull): { geo: THREE.BufferGeometry; paint: Paint[] } | null {
  const parts: [THREE.BufferGeometry, Paint][] = [];
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, p: Paint) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    parts.push([g, p]);
    return g;
  };
  const cone = (r: number, h2: number, seg: number, x: number, y: number, z: number, p: Paint, rotZ = 0) => {
    const g = new THREE.ConeGeometry(r, h2, seg);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(x, y, z);
    parts.push([g, p]);
  };
  const tri = (v: number[], p: Paint) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    parts.push([g, p]);
  };
  if (h === 'barge') {
    // A battle barge: a long armoured slab with a ram prow, a gothic cathedral of spires on its
    // back, buttresses along its flanks, a bank of engines… and a two-headed eagle on the prow.
    box(0.78, 0.13, 0.2, -0.05, 0, 0, BLUE);
    box(0.62, 0.06, 0.26, -0.1, -0.07, 0, IRON);
    // Ram prow, tapering forward.
    const P = [0.56, -0.02, 0], a = [0.34, 0.065, 0.1], b = [0.34, 0.065, -0.1], c = [0.34, -0.08, 0.1], d = [0.34, -0.08, -0.1];
    tri([...P, ...a, ...b, ...P, ...c, ...a, ...P, ...b, ...d, ...P, ...d, ...c], GOLD);
    // Cathedral: nave, towers and spires, highest at the back.
    box(0.36, 0.08, 0.1, -0.2, 0.1, 0, BLUE);
    box(0.08, 0.16, 0.08, -0.3, 0.17, 0, BLUE);
    cone(0.05, 0.16, 4, -0.3, 0.33, 0, GOLD);
    for (const [x, hh] of [[-0.18, 0.1], [-0.06, 0.07], [-0.4, 0.08]] as [number, number][]) {
      box(0.05, hh, 0.05, x, 0.14 + hh / 2, 0.045, BLUE);
      box(0.05, hh, 0.05, x, 0.14 + hh / 2, -0.045, BLUE);
      cone(0.03, 0.08, 4, x, 0.14 + hh + 0.04, 0.045, GOLD);
      cone(0.03, 0.08, 4, x, 0.14 + hh + 0.04, -0.045, GOLD);
    }
    // Flying buttresses along both flanks.
    for (const x of [-0.32, -0.16, 0, 0.16]) {
      box(0.04, 0.1, 0.05, x, 0.02, 0.125, BLUE);
      box(0.04, 0.1, 0.05, x, 0.02, -0.125, BLUE);
    }
    // Engines.
    for (const z of [-0.07, 0, 0.07]) {
      const e = new THREE.CylinderGeometry(0.035, 0.045, 0.1, 6);
      e.rotateZ(Math.PI / 2);
      e.translate(-0.48, 0, z);
      parts.push([e, IRON]);
    }
    // The eagle: two swept golden wings and two heads, on the prow.
    tri([0.36, 0.08, 0, 0.26, 0.09, 0.2, 0.2, 0.08, 0.02, 0.36, 0.08, 0, 0.2, 0.08, -0.02, 0.26, 0.09, -0.2], GOLD);
    tri([0.36, 0.08, 0, 0.2, 0.08, 0.02, 0.26, 0.09, 0.2, 0.36, 0.08, 0, 0.26, 0.09, -0.2, 0.2, 0.08, -0.02], GOLD);
    box(0.04, 0.04, 0.03, 0.39, 0.1, 0.03, BONE);
    box(0.04, 0.04, 0.03, 0.39, 0.1, -0.03, BONE);
  } else if (h === 'pod') {
    // Drop pod: a squat armoured capsule falling nose first, petals folded, a gold tip.
    const g = new THREE.CylinderGeometry(0.22, 0.3, 0.5, 6);
    g.rotateZ(-Math.PI / 2);
    parts.push([g, BLUE]);
    cone(0.22, 0.3, 6, 0.4, 0, 0, GOLD, -Math.PI / 2);
    for (const [y, z] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) box(0.36, 0.05 + Math.abs(y) * 0.1, 0.05 + Math.abs(z) * 0.1, -0.06, y * 0.8, z * 0.8, IRON);
  } else if (h === 'gunship') {
    // Gunship: a stubby armoured hull, swept wings with gold edges, a tall tail.
    box(0.62, 0.16, 0.18, 0, 0, 0, BLUE);
    box(0.16, 0.1, 0.14, 0.32, 0.03, 0, GOLD);
    tri([0.1, 0, 0.09, -0.2, 0, 0.5, -0.24, 0, 0.09, 0.1, 0, -0.09, -0.24, 0, -0.09, -0.2, 0, -0.5], BLUE);
    tri([0.1, 0, 0.09, -0.24, 0, 0.09, -0.2, 0, 0.5, 0.1, 0, -0.09, -0.2, 0, -0.5, -0.24, 0, -0.09], BLUE);
    box(0.06, 0.03, 0.42, -0.2, 0.005, 0.28, GOLD);
    box(0.06, 0.03, 0.42, -0.2, 0.005, -0.28, GOLD);
    box(0.14, 0.24, 0.04, -0.26, 0.14, 0, BLUE);
  } else return null;
  const geo = mergeAll(parts.map(([g]) => g));
  const paint: Paint[] = [];
  for (const [g, p] of parts) {
    const n = (g.index ? g.toNonIndexed() : g).attributes.position.count;
    for (let i = 0; i < n; i++) paint.push(p);
  }
  return { geo, paint };
}

/** Builds a small flat-shaded hull pointing along +X (about one unit long). */
function hullGeometry(h: Hull): THREE.BufferGeometry {
  const tri = (v: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  };
  switch (h) {
    case 'dart': {
      // Arrowhead with a raised spine: the civilization's own ships.
      const N = [0.6, 0, 0], L = [-0.45, 0, 0.4], R = [-0.45, 0, -0.4], T = [-0.25, 0.16, 0], B = [-0.25, -0.08, 0], C = [-0.3, 0, 0];
      return tri([...N, ...L, ...T, ...N, ...T, ...R, ...L, ...C, ...T, ...T, ...C, ...R, ...N, ...B, ...L, ...N, ...R, ...B, ...L, ...B, ...C, ...C, ...B, ...R]);
    }
    case 'hauler': {
      // A boxy freighter with a small cockpit.
      const g = new THREE.BoxGeometry(0.9, 0.26, 0.36);
      const cab = new THREE.BoxGeometry(0.22, 0.18, 0.22);
      cab.translate(0.5, 0.06, 0);
      return mergeAll([g, cab]);
    }
    case 'tanker': {
      const body = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8, 1);
      body.rotateZ(Math.PI / 2);
      const nose = new THREE.ConeGeometry(0.2, 0.3, 8);
      nose.rotateZ(-Math.PI / 2);
      nose.translate(0.55, 0, 0);
      return mergeAll([body, nose]);
    }
    case 'diamond': {
      // Traders and allies: a wide gem-like hull.
      const g = new THREE.OctahedronGeometry(0.5, 0);
      g.scale(1.25, 0.45, 0.85);
      return g;
    }
    case 'claw': {
      // Invaders: two prongs reaching forward.
      const A = [0.6, 0, 0.32], B = [0.6, 0, -0.32], M = [0.12, 0, 0], K = [-0.5, 0, 0], U = [-0.1, 0.2, 0], D = [-0.1, -0.12, 0];
      const W1 = [0.0, 0, 0.42], W2 = [0.0, 0, -0.42];
      return tri([...A, ...M, ...U, ...A, ...U, ...W1, ...W1, ...U, ...K, ...B, ...U, ...M, ...B, ...W2, ...U, ...W2, ...K, ...U, ...A, ...D, ...M, ...A, ...W1, ...D, ...W1, ...K, ...D, ...B, ...M, ...D, ...B, ...D, ...W2, ...W2, ...D, ...K]);
    }
    case 'mother': {
      const core = new THREE.OctahedronGeometry(0.5, 1);
      core.scale(1.3, 0.5, 1.0);
      const ring = new THREE.TorusGeometry(0.62, 0.06, 6, 18);
      ring.rotateX(Math.PI / 2);
      const spike = new THREE.ConeGeometry(0.12, 0.6, 5);
      spike.rotateZ(-Math.PI / 2);
      spike.translate(0.85, 0, 0);
      return mergeAll([core, ring, spike]);
    }
    case 'orb':
      return new THREE.IcosahedronGeometry(0.32, 0);
    case 'ark': {
      const g = new THREE.CylinderGeometry(0.18, 0.32, 1.4, 10, 1);
      g.rotateZ(-Math.PI / 2);
      const ring = new THREE.TorusGeometry(0.42, 0.07, 6, 20);
      ring.rotateY(Math.PI / 2);
      ring.translate(-0.25, 0, 0);
      return mergeAll([g, ring]);
    }
    default:
      return paintedGeometry(h)!.geo;
  }
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/**
 * Lit, textured hull material: the star lights it, a faint glow keeps the night side readable,
 * and the instance colour paints only the accent stripes (the people's livery).
 */
function modelMaterial(map: THREE.Texture, accent: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.35, emissive: new THREE.Color(0.2, 0.2, 0.22), emissiveMap: map });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.accentMap = { value: accent };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D accentMap;')
      .replace(
        '#include <color_fragment>',
        `float acc = 0.0;
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
          acc = texture2D( accentMap, vMapUv ).r;
          float lum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
          // The livery: the people's colour, keeping the paint's wear and panel lines.
          diffuseColor.rgb = mix( diffuseColor.rgb * mix( vec3( 1.0 ), vColor.rgb, 0.12 ), vColor.rgb * ( 0.3 + 1.5 * lum ), acc );
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
          totalEmissiveRadiance += vColor.rgb * acc * 0.22;
        #endif`,
      );
  };
  return mat;
}

/** Two-tone shading baked into the hull: light deck, dark belly, a brighter nose. */
function finish(geo: THREE.BufferGeometry, paint?: Paint[]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!paint) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  // Light from above and slightly ahead, so decks glow and bellies and flanks fall into shade.
  const L = new THREE.Vector3(0.35, 1, 0.25).normalize();
  for (let i = 0; i < pos.count; i++) {
    const d = nor.getX(i) * L.x + nor.getY(i) * L.y + nor.getZ(i) * L.z;
    let c = 0.42 + 0.58 * Math.max(0, d);
    if (pos.getX(i) > 0.35) c *= 1.12;
    const p = paint?.[i];
    if (p) {
      // Paint is picked in sRGB; vertex colours are linear. The light does the shading.
      const lin = (v: number) => Math.pow(Math.min(1, v), 2.2);
      col[i * 3] = lin(p[0]);
      col[i * 3 + 1] = lin(p[1]);
      col[i * 3 + 2] = lin(p[2]);
    } else col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.min(1, c);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const CAP: Record<ProcHull, number> = { dart: 260, hauler: 70, tanker: 40, diamond: 24, claw: 60, mother: 6, orb: 12, ark: 2, barge: 1, pod: 30, gunship: 24 };

/**
 * Every ship as a tiny 3D hull, batched per shape. Hulls keep a minimum size on screen, so a
 * fleet still reads as ships (not dots) when the camera is far away.
 */
export class ShipHulls {
  group = new THREE.Group();
  private meshes = new Map<Hull, THREE.InstancedMesh>();
  private counts = new Map<Hull, number>();
  private caps = new Map<Hull, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private basis = new THREE.Matrix4();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  /** World units per CSS pixel at unit distance (set every frame). */
  pxScale = 0.001;

  constructor() {
    for (const h of Object.keys(CAP) as ProcHull[]) {
      // Shading is baked into vertex colours: the faction colour always reads, whatever the light.
      const painted = paintedGeometry(h);
      const mat = painted
        ? new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.42, metalness: 0.55, side: THREE.DoubleSide, emissive: new THREE.Color(0.03, 0.04, 0.08) })
        : new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
      const geo = painted ? finish(painted.geo, painted.paint) : finish(hullGeometry(h));
      this.addMesh(h, geo, mat, CAP[h]);
    }
    this.loadModels();
  }

  private addMesh(h: Hull, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.meshes.set(h, mesh);
    this.caps.set(h, cap);
    this.counts.set(h, 0);
    this.group.add(mesh);
  }

  /** Loads the real models; until each arrives, its simple hull stands in. */
  private loadModels() {
    const base = `${import.meta.env.BASE_URL}models/ships/`;
    const loader = new GLTFLoader();
    const tex = new THREE.TextureLoader();
    for (const name of Object.keys(MODELS) as ModelHull[]) {
      loader.load(
        `${base}${name}.glb`,
        (gltf) => {
          let geo: THREE.BufferGeometry | null = null;
          gltf.scene.traverse((o) => {
            if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry;
          });
          if (!geo) return;
          const g = geo as THREE.BufferGeometry;
          // The models fly along +Z; our hulls point along +X.
          g.rotateY(Math.PI / 2);
          const map = tex.load(`${base}${name}.jpg`);
          map.flipY = false;
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 4;
          const accent = tex.load(`${base}${name}_mask.png`);
          accent.flipY = false;
          this.addMesh(name, g, modelMaterial(map, accent), MODELS[name].cap);
        },
        undefined,
        () => {
          /* Missing model: the simple hull keeps standing in. */
        },
      );
    }
  }

  begin() {
    for (const h of this.meshes.keys()) this.counts.set(h, 0);
  }

  /**
   * Adds one hull at `pos`, heading along `dir`. `size` is its true size (world units) and
   * `px` the smallest size it may look on screen.
   */
  add(h: Hull, pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, size: number, px: number, camPos: THREE.Vector3) {
    if (!this.meshes.has(h)) h = MODELS[h as ModelHull]?.fallback ?? 'dart';
    const mesh = this.meshes.get(h)!;
    const i = this.counts.get(h)!;
    if (i >= (this.caps.get(h) ?? 0)) return;
    const d = camPos.distanceTo(pos);
    const scale = Math.max(size, px * this.pxScale * d);
    this.fwd.copy(dir);
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(1, 0, 0);
    this.fwd.normalize();
    this.side.set(-this.fwd.z, 0, this.fwd.x);
    if (this.side.lengthSq() < 1e-6) this.side.set(0, 0, 1);
    this.side.normalize();
    this.up.crossVectors(this.side, this.fwd).normalize();
    // Columns: forward (+X), up (+Y), side (+Z) — a right-handed frame.
    this.basis.makeBasis(this.fwd, this.up, this.side);
    this.q.setFromRotationMatrix(this.basis);
    this.s.setScalar(scale);
    this.m.compose(pos, this.q, this.s);
    mesh.setMatrixAt(i, this.m);
    mesh.setColorAt(i, color);
    this.counts.set(h, i + 1);
  }

  end() {
    for (const [h, mesh] of this.meshes) {
      mesh.count = this.counts.get(h) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

