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

  ring(x: number, z: number, color: number, radius: number, dur = 1.4, y = 0) {
    const m = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.add(m, dur, (k) => {
      m.scale.setScalar(radius * (0.15 + 0.85 * (1 - Math.pow(1 - k, 3))));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    });
  }

  /** A beam from a to b (follows `to` each frame when given as a function). */
  beam(from: THREE.Vector3, to: () => THREE.Vector3, color: number, width: number, dur = 1.2) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uK; varying vec2 vUv;
        void main(){
          float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float head = smoothstep(uK * 1.6, uK * 1.6 - 0.25, vUv.x);
          float tail = 1.0 - smoothstep(0.0, 1.0, uK);
          float a = pow(across, 2.5) * head * (0.35 + 0.65 * tail);
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
      axis.copy(b).sub(from);
      const len = axis.length();
      axis.normalize();
      // Lay the beam flat towards the camera, turning around its own axis.
      toCam.copy(this.camera.position).sub(from).normalize();
      side.crossVectors(toCam, axis).normalize();
      normal.crossVectors(axis, side);
      basis.makeBasis(axis, side, normal);
      m.quaternion.setFromRotationMatrix(basis);
      m.position.copy(from);
      m.scale.set(len, width, 1);
      mat.uniforms.uK.value = k;
    });
  }

  private add(obj: THREE.Object3D, dur: number, tick: (k: number) => void) {
    tick(0);
    this.group.add(obj);
    this.list.push({ obj, t: 0, dur, tick });
  }

  update(dt: number) {
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
