import * as THREE from 'three';
import { Rng, clamp, damp } from '../util';

/**
 * Renderer, camera rig and the far backdrop (stars and the old nebula you were born from).
 * The camera orbits a target point on the disk plane: wheel/pinch zooms, right-drag or
 * two fingers turn it.
 */
export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  yaw = 0.7;
  pitch = 0.98;
  dist = 132;
  target = new THREE.Vector3();
  goal = { yaw: 0.7, pitch: 0.98, dist: 132, target: new THREE.Vector3() };
  minDist = 10;
  maxDist = 240;
  /** Slow drift when nobody touches the camera (title screen). */
  drift = 0;
  /** The sky brightens (a nearby supernova) and fades back. */
  skyFlash = 0;
  private trauma = 0;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  backdrop: THREE.Group;

  constructor(
    public el: HTMLElement,
    quality: 'low' | 'high',
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x050403, 1);
    el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
    this.backdrop = makeBackdrop(quality);
    this.scene.add(this.backdrop);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get canvas() {
    return this.renderer.domElement;
  }

  setQuality(q: 'low' | 'high') {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : 1.25));
    this.resize();
  }

  resize() {
    const w = this.el.clientWidth || window.innerWidth;
    const h = this.el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens need a wider view so the whole disk fits.
    this.camera.fov = w < h ? 58 : 45;
    this.camera.updateProjectionMatrix();
  }

  /** A short camera tremble (big warp jumps). */
  shake(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  zoom(factor: number) {
    this.goal.dist = clamp(this.goal.dist * factor, this.minDist, this.maxDist);
  }
  rotate(dx: number, dy: number) {
    this.goal.yaw -= dx * 0.006;
    this.goal.pitch = clamp(this.goal.pitch + dy * 0.005, 0.35, 1.45);
  }

  update(dt: number) {
    const g = this.goal;
    g.yaw += this.drift * dt;
    this.yaw = damp(this.yaw, g.yaw, 6, dt);
    this.pitch = damp(this.pitch, g.pitch, 6, dt);
    this.dist = damp(this.dist, g.dist, 5, dt);
    this.target.x = damp(this.target.x, g.target.x, 4, dt);
    this.target.y = damp(this.target.y, g.target.y, 4, dt);
    this.target.z = damp(this.target.z, g.target.z, 4, dt);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.2);
      const a = this.trauma * this.trauma * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.target);
    this.backdrop.position.copy(this.camera.position);
    this.skyFlash = Math.max(0, this.skyFlash - dt * 0.22);
    const sky = (this.backdrop.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    sky.color.setRGB(1 + this.skyFlash * 2.4, 1 + this.skyFlash * 1.9, 1 + this.skyFlash * 1.5);
  }

  /** Point on the disk plane under the cursor. */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.tmp);
    if (!hit) return null;
    return { x: hit.x, z: hit.z };
  }

  /** Screen position (CSS pixels) of a world point. */
  project(x: number, y: number, z: number, out: { x: number; y: number; vis: boolean }) {
    this.tmp.set(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    out.x = (this.tmp.x * 0.5 + 0.5) * r.width + r.left;
    out.y = (-this.tmp.y * 0.5 + 0.5) * r.height + r.top;
    out.vis = this.tmp.z < 1 && this.tmp.z > -1;
    return out;
  }

  /** World units per CSS pixel at a given point (for screen-space picking). */
  pixelScale(x: number, y: number, z: number) {
    const d = this.camera.position.distanceTo(this.tmp.set(x, y, z));
    const h = this.canvas.getBoundingClientRect().height || 1;
    return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

/** Soft round sprite texture used by glows and particles. */
let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function makeBackdrop(quality: 'low' | 'high') {
  const group = new THREE.Group();
  const rng = new Rng(20240611);
  // Painted sky: dusky clouds, dark dust lanes and, far away, the ring of the nebula you came from.
  const W = quality === 'high' ? 2048 : 1024;
  const H = W / 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#050403';
  g.fillRect(0, 0, W, H);
  const band = (y: number) => H * 0.5 + Math.sin(y) * H * 0.12;
  const blob = (x: number, y: number, r: number, col: string, a: number) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, col.replace('A', String(a)));
    grd.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    // wrap horizontally so the seam disappears
    if (x - r < 0) {
      g.save();
      g.translate(W, 0);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
    if (x + r > W) {
      g.save();
      g.translate(-W, 0);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
  };
  g.globalCompositeOperation = 'lighter';
  const palette = ['rgba(150,70,35,A)', 'rgba(120,90,60,A)', 'rgba(40,85,90,A)', 'rgba(90,50,80,A)', 'rgba(160,110,60,A)'];
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, W);
    const y = band(x / W * Math.PI * 2 + 1.3) + rng.gauss(0, H * 0.13);
    blob(x, y, rng.range(W * 0.015, W * 0.09), rng.pick(palette), rng.range(0.025, 0.07));
  }
  // The planetary nebula: a glowing shell, teal inside, rust at the rim.
  const nx = W * 0.72;
  const ny = H * 0.38;
  const nr = W * 0.035;
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = nr * rng.range(0.75, 1.1);
    blob(nx + Math.cos(a) * rr * 1.25, ny + Math.sin(a) * rr, nr * rng.range(0.25, 0.5), i % 3 ? 'rgba(210,95,55,A)' : 'rgba(240,170,90,A)', rng.range(0.05, 0.11));
  }
  blob(nx, ny, nr * 0.9, 'rgba(70,170,170,A)', 0.22);
  blob(nx, ny, nr * 0.12, 'rgba(255,255,240,A)', 0.8);
  // Dust lanes.
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, W);
    const y = band(x / W * Math.PI * 2 + 1.3) + rng.gauss(0, H * 0.05);
    blob(x, y, rng.range(W * 0.01, W * 0.05), 'rgba(5,4,3,A)', rng.range(0.25, 0.5));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.rotation.z = 0.35;
  sky.renderOrder = -10;
  group.add(sky);

  // Brighter stars as real points so they twinkle a little with depth.
  const n = quality === 'high' ? 3200 : 2000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - u * u);
    const R = 1500;
    pos[i * 3] = Math.cos(a) * s * R;
    pos[i * 3 + 1] = u * R;
    pos[i * 3 + 2] = Math.sin(a) * s * R;
    const warm = rng.next();
    const b = Math.pow(rng.next(), 2.2) * 0.85 + 0.15;
    col[i * 3] = b;
    col[i * 3 + 1] = b * (0.82 + 0.15 * warm);
    col[i * 3 + 2] = b * (0.62 + 0.35 * (1 - warm));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  stars.renderOrder = -9;
  group.add(stars);
  return group;
}
