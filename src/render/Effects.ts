import * as THREE from 'three';
import { glowTexture } from './Stage';

interface Fx {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  tick: (k: number) => void;
}

/** Short-lived visual effects: flashes, shock rings and beams of light. */
export class Effects {
  group = new THREE.Group();
  private list: Fx[] = [];
  private ringGeo = new THREE.RingGeometry(0.9, 1, 64);
  private thinRingGeo = new THREE.RingGeometry(0.975, 1, 96);
  private beamGeo: THREE.PlaneGeometry;

  constructor(private camera: THREE.Camera) {
    this.beamGeo = new THREE.PlaneGeometry(1, 1);
    this.beamGeo.translate(0.5, 0, 0);
  }

  flash(x: number, y: number, z: number, color: number, size: number, dur = 0.9) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    s.position.set(x, y, z);
    this.add(s, dur, (k) => {
      s.scale.setScalar(size * (0.4 + 1.2 * Math.sqrt(k)));
      s.material.opacity = Math.pow(1 - k, 1.6);
    });
  }

  ring(x: number, z: number, color: number, radius: number, dur = 1.4, y = 0, thin = false) {
    const m = new THREE.Mesh(
      thin ? this.thinRingGeo : this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.add(m, dur, (k) => {
      m.scale.setScalar(radius * (0.15 + 0.85 * (1 - Math.pow(1 - k, 3))));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    });
  }

  /** A beam of light from `from` to `to`; either end can follow a moving point. */
  beam(from: THREE.Vector3 | (() => THREE.Vector3), to: () => THREE.Vector3, color: number, width: number, dur = 1.2, streak = false) {
    const src = typeof from === 'function' ? from : () => from;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 }, uFade: { value: 1 }, uStreak: { value: streak ? 1 : 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uK; uniform float uFade; uniform float uStreak; varying vec2 vUv;
        void main(){
          float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float a;
          if (uStreak > 0.5) {
            // A streak of light: bright head at the far end, fading tail.
            a = pow(across, 1.8) * (0.15 + 0.85 * pow(vUv.x, 1.5)) * uFade;
            gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45 * vUv.x) * a * 2.4, a);
            return;
          }
          float head = smoothstep(uK * 1.6, uK * 1.6 - 0.25, vUv.x);
          float tail = 1.0 - smoothstep(0.0, 1.0, uK);
          a = pow(across, 2.5) * head * (0.35 + 0.65 * tail);
          gl_FragColor = vec4(uColor * a * 1.6, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.beamGeo, mat);
    const axis = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const side = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    this.add(m, dur, (k) => {
      const b = to();
      const a = src();
      axis.copy(b).sub(a);
      const len = axis.length();
      axis.normalize();
      // Lay the beam flat towards the camera, turning around its own axis.
      toCam.copy(this.camera.position).sub(a).normalize();
      side.crossVectors(toCam, axis).normalize();
      normal.crossVectors(axis, side);
      basis.makeBasis(axis, side, normal);
      m.quaternion.setFromRotationMatrix(basis);
      m.position.copy(a);
      m.scale.set(Math.max(0.001, len), width, 1);
      mat.uniforms.uK.value = k;
      mat.uniforms.uFade.value = 1 - k * k;
    });
  }

  /** A quick laser shot between two moving points. */
  laser(from: () => THREE.Vector3, to: () => THREE.Vector3, color: number) {
    this.beam(from, to, color, 0.32, 0.45);
  }

  /** An explosion: a hot flash and a fading shock ring. */
  boom(x: number, y: number, z: number, big: boolean, color = 0xffa060) {
    this.flash(x, y, z, color, big ? 9 : 3.5, big ? 1.2 : 0.6);
    this.flash(x, y, z, 0xffffff, big ? 4 : 1.5, 0.3);
    this.ring(x, z, color, big ? 6 : 2.2, big ? 1.2 : 0.6, y, true);
  }

  /**
   * A warp jump: a burst of light, a shock ring, and streaks of light stretching to the stars
   * (or collapsing out of them when `arriving`).
   */
  warp(x: number, z: number, dx: number, dz: number, count: number, color: number, arriving: boolean) {
    const dir = new THREE.Vector3(dx, 0.08, dz).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(1, 0.08, 0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const n = Math.max(1, Math.min(30, count));
    const t0 = this.time;
    const tn = (i: number) => Math.min(1, Math.max(0, (this.time - t0) / 0.85 - i * 0.004));
    this.flash(x, 1, z, 0xffffff, 6 + n * 0.35, arriving ? 0.6 : 0.8);
    this.flash(x, 1, z, color, 10 + n * 0.4, 1.0);
    this.ring(x, z, color, 6 + n * 0.2, 1.0, 1, true);
    this.ring(x, z, 0xffffff, 3.5 + n * 0.12, 0.6, 1, true);
    for (let i = 0; i < n; i++) {
      const row = Math.floor((i + 1) / 2);
      const s = i === 0 ? 0 : i % 2 ? 1 : -1;
      const p = new THREE.Vector3(x, 1, z).addScaledVector(dir, -row * 0.95).addScaledVector(side, s * row * 0.75);
      const delay = (i / n) * 0.12;
      const head = new THREE.Vector3();
      const tail = new THREE.Vector3();
      if (arriving) {
        // Out of the stars: long streaks that shrink into the ships.
        this.beam(
          () => tail.copy(p).addScaledVector(dir, -(1 - tn(i)) * 140 - 1.5),
          () => head.copy(p),
          color,
          0.6,
          0.85 + delay,
          true,
        );
      } else {
        // Into the stars: the tail stays a moment, the head shoots away.
        this.beam(
          () => tail.copy(p).addScaledVector(dir, Math.pow(tn(i), 3) * 160),
          () => head.copy(p).addScaledVector(dir, 2 + Math.pow(tn(i), 1.6) * 230),
          color,
          0.6,
          0.95 + delay,
          true,
        );
      }
    }
  }

  private time = 0;

  private add(obj: THREE.Object3D, dur: number, tick: (k: number) => void) {
    tick(0);
    this.group.add(obj);
    this.list.push({ obj, t: 0, dur, tick });
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.tick(k);
      if (k >= 1) {
        this.group.remove(f.obj);
        const mm = (f.obj as THREE.Mesh).material as THREE.Material | undefined;
        mm?.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  clear() {
    for (const f of this.list) this.group.remove(f.obj);
    this.list = [];
  }
}
