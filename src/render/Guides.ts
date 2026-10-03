import * as THREE from 'three';
import { habZone, snowLine, toWorld } from '../core/state';

/** Map guides on the disk plane: the habitable zone (green band) and the snow line (icy ring). */
export class Guides {
  group = new THREE.Group();
  private hz: THREE.Mesh;
  private hzMat: THREE.ShaderMaterial;
  private snow: THREE.LineLoop;
  private snowMat: THREE.LineDashedMaterial;
  opacity = 1;

  constructor() {
    this.hzMat = new THREE.ShaderMaterial({
      uniforms: { uIn: { value: 13 }, uOut: { value: 18 }, uAlpha: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uIn; uniform float uOut; uniform float uAlpha; uniform float uTime;
        varying vec3 vP;
        void main() {
          float r = length(vP.xy);
          float t = (r - uIn) / (uOut - uIn);
          if (t < -0.15 || t > 1.15) discard;
          float band = smoothstep(-0.15, 0.12, t) * smoothstep(1.15, 0.88, t);
          float edge = exp(-pow(t * 9.0, 2.0)) + exp(-pow((t - 1.0) * 9.0, 2.0));
          float a = (band * 0.09 + edge * 0.22) * uAlpha;
          float ang = atan(vP.y, vP.x);
          a *= 0.8 + 0.2 * sin(ang * 40.0 + uTime * 0.3);
          gl_FragColor = vec4(vec3(0.5, 0.78, 0.38) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.hz = new THREE.Mesh(new THREE.RingGeometry(8, 40, 160, 1), this.hzMat);
    this.hz.rotation.x = -Math.PI / 2;
    this.hz.position.y = -0.05;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.snowMat = new THREE.LineDashedMaterial({ color: 0x9fd4e6, dashSize: 0.035, gapSize: 0.03, transparent: true, opacity: 0.45, depthWrite: false });
    this.snow = new THREE.LineLoop(geo, this.snowMat);
    this.snow.computeLineDistances();
    this.group.add(this.hz, this.snow);
  }

  hzRadii(L: number) {
    const [a, b] = habZone(L);
    return [toWorld(a), toWorld(b)] as const;
  }
  snowRadius(L: number) {
    return toWorld(snowLine(L));
  }

  update(L: number, time: number, showSnow: boolean) {
    const [a, b] = this.hzRadii(L);
    this.hzMat.uniforms.uIn.value = a;
    this.hzMat.uniforms.uOut.value = b;
    this.hzMat.uniforms.uAlpha.value = this.opacity;
    this.hzMat.uniforms.uTime.value = time;
    const s = this.snowRadius(L);
    this.snow.scale.setScalar(s);
    this.snow.visible = showSnow;
    this.snowMat.opacity = 0.42 * this.opacity;
  }
}
