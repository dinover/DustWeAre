import * as THREE from 'three';
import { R_MAX, R_MIN, SCALE_EXP, toWorld } from '../core/state';
import { TOOL_RADIUS, type Formation, type Tool } from '../sim/formation';
import { NOISE } from './glsl';
import { glowTexture } from './Stage';
import { clamp, smoothstep } from '../util';

const NR = 36;
const NT = 24;

export const TOOL_COLOR: Record<Tool, number> = { gather: 0xe8c27a, heat: 0xff6a2a, cool: 0x8fd0ea, nudge: 0xd9cbb0 };

/**
 * The protoplanetary disk on screen: a cloud of dust and ice parcels, the glowing gas
 * around them, and the cursor of the tool the player is using.
 */
export class DiskView {
  group = new THREE.Group();
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private base: Float32Array;
  private baseT = 0;
  private pmat: THREE.ShaderMaterial;
  private haze: THREE.Mesh;
  private hazeMat: THREE.ShaderMaterial;
  private field: THREE.DataTexture;
  private fieldData: Uint8Array;
  private cursor: THREE.Mesh;
  private cursorMat: THREE.MeshBasicMaterial;
  private cursorFill: THREE.Mesh;
  private clump: THREE.Sprite;
  private orbit: THREE.LineLoop;
  private avgSolids = 0.01;

  constructor(private n: number) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 110);
    this.pmat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uMap: { value: glowTexture() } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(aSize * uScale / -mv.z, aSize > 0.0 ? 1.2 : 0.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vC;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r;
          gl_FragColor = vec4(vC * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.pmat);
    this.points.frustumCulled = false;

    this.fieldData = new Uint8Array(NR * NT * 4);
    this.field = new THREE.DataTexture(this.fieldData, NT, NR, THREE.RGBAFormat);
    this.field.magFilter = THREE.LinearFilter;
    this.field.minFilter = THREE.LinearFilter;
    this.field.wrapS = THREE.RepeatWrapping;
    this.field.wrapT = THREE.ClampToEdgeWrapping;
    this.field.needsUpdate = true;
    this.hazeMat = new THREE.ShaderMaterial({
      uniforms: {
        uGas: { value: 1 },
        uTime: { value: 0 },
        uField: { value: this.field },
        uRmin: { value: R_MIN },
        uSpan: { value: Math.log(R_MAX / R_MIN) },
        uSnow: { value: 2.7 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uGas; uniform float uTime; uniform sampler2D uField;
        uniform float uRmin; uniform float uSpan; uniform float uSnow;
        varying vec3 vW;
        ${NOISE}
        void main() {
          float rw = length(vW.xz);
          float rau = pow(rw / 14.0, 1.0 / ${SCALE_EXP.toFixed(3)});
          float ang = atan(vW.z, vW.x);
          float prof = smoothstep(5.0, 8.5, rw) * smoothstep(90.0, 60.0, rw);
          float spin = ang - uTime * 0.18 * pow(max(rau, 0.1), -0.75);
          vec3 q = vec3(cos(spin) * 2.2, sin(spin) * 2.2, log(rau) * 2.4);
          float n = fbm3(q) * 0.5 + 0.5;
          float wisps = pow(n, 1.7);
          float dens = uGas * prof * (0.25 + 0.95 * wisps);
          vec3 warm = vec3(0.62, 0.34, 0.2);
          vec3 cold = vec3(0.32, 0.26, 0.36);
          vec3 col = mix(warm, cold, smoothstep(uSnow * 0.6, uSnow * 2.6, rau));
          col = mix(col, vec3(0.95, 0.55, 0.25), smoothstep(1.0, 0.35, rau) * 0.6);
          vec2 fuv = vec2(fract(ang / 6.2831853 + 1.0), clamp(log(rau / uRmin) / uSpan, 0.0, 1.0));
          vec4 f = texture2D(uField, fuv);
          float heat = f.r * 3.0;
          float cool = f.g * 3.0;
          vec3 c = col * dens * 0.55;
          c += vec3(1.0, 0.36, 0.08) * heat * prof * (0.2 + 0.25 * n);
          c += vec3(0.45, 0.75, 0.95) * cool * prof * (0.12 + 0.18 * n);
          float a = clamp(dens * 0.4 + heat * 0.1 + cool * 0.08, 0.0, 1.0);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.haze = new THREE.Mesh(new THREE.RingGeometry(5, 92, 200, 8), this.hazeMat);
    this.haze.rotation.x = -Math.PI / 2;
    this.haze.position.y = -0.2;

    this.cursorMat = new THREE.MeshBasicMaterial({ color: 0xe8c27a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 72), this.cursorMat);
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursorFill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8c27a, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.cursorFill.rotation.x = -Math.PI / 2;
    this.clump = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd28a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) pts.push(new THREE.Vector3(Math.cos((i / 160) * Math.PI * 2), 0, Math.sin((i / 160) * Math.PI * 2)));
    this.orbit = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xe8d2a0, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.group.add(this.haze, this.points, this.cursorFill, this.cursor, this.clump, this.orbit);
  }

  /** Pixel scale for point sizes (depends on the canvas height and field of view). */
  setScale(heightPx: number, fovDeg: number) {
    this.pmat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  private refreshBase(f: Formation) {
    // Dust colour from what each parcel is made of (recomputed a few times per second).
    let tot = 0;
    let cnt = 0;
    for (let i = 0; i < this.n; i++) {
      if (!f.alive[i]) continue;
      const rm = f.rock[i] + f.metal[i];
      const s = rm + f.water[i] + f.org[i];
      tot += s;
      cnt++;
      const inv = 1 / Math.max(1e-9, s + f.gas[i] * 0.02);
      const metalShare = f.metal[i] / Math.max(1e-9, rm);
      // Rock: ochre to rust; ice: pale teal; organics: dark amber.
      const rr = 0.86 - 0.12 * metalShare;
      const rg = 0.5 - 0.18 * metalShare;
      const rb = 0.24 - 0.08 * metalShare;
      const g = f.gas[i] * 0.02;
      this.base[i * 3] = (rm * rr + f.water[i] * 0.55 + f.org[i] * 0.62 + g * 0.7) * inv;
      this.base[i * 3 + 1] = (rm * rg + f.water[i] * 0.74 + f.org[i] * 0.34 + g * 0.36) * inv;
      this.base[i * 3 + 2] = (rm * rb + f.water[i] * 0.86 + f.org[i] * 0.16 + g * 0.3) * inv;
    }
    this.avgSolids = cnt ? tot / cnt : 0.01;
  }

  update(f: Formation, dt: number, time: number, cursorOn: boolean, showOrbit: number | null) {
    this.baseT -= dt;
    if (this.baseT <= 0) {
      this.baseT = 0.4;
      this.refreshBase(f);
    }
    const avg = this.avgSolids;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      if (!f.alive[i]) {
        this.size[i] = 0;
        this.pos[o + 1] = -9999;
        continue;
      }
      this.pos[o] = f.px[i];
      this.pos[o + 1] = f.y[i];
      this.pos[o + 2] = f.pz[i];
      const s = f.metal[i] + f.rock[i] + f.water[i] + f.org[i];
      const k = Math.sqrt(s / avg);
      const T = f.temp[i];
      const glow = smoothstep(420, 1100, T);
      const b = 0.26 + 0.26 * clamp(k, 0, 2);
      this.col[o] = (this.base[o] * (1 - glow) + 1.0 * glow) * b * (1 + glow);
      this.col[o + 1] = (this.base[o + 1] * (1 - glow) + 0.45 * glow) * b * (1 + glow * 0.5);
      this.col[o + 2] = (this.base[o + 2] * (1 - glow) + 0.15 * glow) * b;
      this.size[i] = 0.42 + 0.32 * Math.min(2.5, k);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;

    for (let k = 0; k < NR * NT; k++) {
      this.fieldData[k * 4] = Math.min(255, f.heat[k] * 85);
      this.fieldData[k * 4 + 1] = Math.min(255, f.cool[k] * 85);
    }
    this.field.needsUpdate = true;
    this.hazeMat.uniforms.uGas.value = 0.12 + 0.88 * f.gasLeft;
    this.hazeMat.uniforms.uTime.value = time;
    this.hazeMat.uniforms.uSnow.value = 2.7 * Math.sqrt(f.L);

    const p = f.pointer;
    const on = cursorOn && p.valid;
    this.cursor.visible = this.cursorFill.visible = on;
    if (on) {
      const r = TOOL_RADIUS[f.tool];
      const pulse = 1 + (p.down ? 0.04 * Math.sin(time * 9) : 0);
      this.cursor.position.set(p.x, 0.1, p.z);
      this.cursor.scale.setScalar(r * pulse);
      this.cursorFill.position.set(p.x, 0.08, p.z);
      this.cursorFill.scale.setScalar(r * pulse);
      this.cursorMat.color.setHex(TOOL_COLOR[f.tool]);
      (this.cursorFill.material as THREE.MeshBasicMaterial).color.setHex(TOOL_COLOR[f.tool]);
      this.cursorMat.opacity = p.down ? 0.95 : 0.55;
      (this.cursorFill.material as THREE.MeshBasicMaterial).opacity = p.down ? 0.12 : 0.05;
    }
    const c = f.clump;
    this.clump.visible = !!c;
    if (c) {
      const m = c.metal + c.rock + c.water + c.org;
      this.clump.position.set(p.x, 0.3, p.z);
      this.clump.scale.setScalar(2.2 + 9 * Math.cbrt(m) + Math.sin(time * 7) * 0.3);
    }
    this.orbit.visible = showOrbit !== null;
    if (showOrbit !== null) this.orbit.scale.setScalar(toWorld(showOrbit));
  }

  dispose() {
    this.geo.dispose();
    this.pmat.dispose();
    this.hazeMat.dispose();
    this.field.dispose();
  }
}
