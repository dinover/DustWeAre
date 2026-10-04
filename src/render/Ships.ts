import * as THREE from 'three';

export type Hull = 'dart' | 'hauler' | 'tanker' | 'diamond' | 'claw' | 'mother' | 'orb' | 'ark';

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

/** Two-tone shading baked into the hull: light deck, dark belly, a brighter nose. */
function finish(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  // Light from above and slightly ahead, so decks glow and bellies and flanks fall into shade.
  const L = new THREE.Vector3(0.35, 1, 0.25).normalize();
  for (let i = 0; i < pos.count; i++) {
    const d = nor.getX(i) * L.x + nor.getY(i) * L.y + nor.getZ(i) * L.z;
    let c = 0.42 + 0.58 * Math.max(0, d);
    if (pos.getX(i) > 0.35) c *= 1.12;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.min(1, c);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const CAP: Record<Hull, number> = { dart: 260, hauler: 70, tanker: 40, diamond: 24, claw: 60, mother: 6, orb: 12, ark: 2 };

/**
 * Every ship as a tiny 3D hull, batched per shape. Hulls keep a minimum size on screen, so a
 * fleet still reads as ships (not dots) when the camera is far away.
 */
export class ShipHulls {
  group = new THREE.Group();
  private meshes = new Map<Hull, THREE.InstancedMesh>();
  private counts = new Map<Hull, number>();
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
    for (const h of Object.keys(CAP) as Hull[]) {
      // Shading is baked into vertex colours: the faction colour always reads, whatever the light.
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
      const mesh = new THREE.InstancedMesh(finish(hullGeometry(h)), mat, CAP[h]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.set(h, mesh);
      this.group.add(mesh);
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
    const mesh = this.meshes.get(h)!;
    const i = this.counts.get(h)!;
    if (i >= CAP[h]) return;
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

