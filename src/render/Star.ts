import * as THREE from 'three';
import { NOISE } from './glsl';
import { glowTexture } from './Stage';

/** The star: boiling surface, warm halo and a slow corona. */
export class Star {
  group = new THREE.Group();
  mat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  corona: THREE.Sprite;
  radius = 3.4;
  private pulse = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vObj;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vObj = position;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uHeat;
        uniform float uPulse;
        varying vec3 vObj;
        varying vec3 vN;
        varying vec3 vView;
        ${NOISE}
        void main() {
          vec3 p = normalize(vObj);
          float n = fbm(p * 3.2 + vec3(0.0, uTime * 0.05, uTime * 0.03));
          float cells = 1.0 - abs(snoise(p * 9.0 + uTime * 0.12));
          float t = clamp(0.55 + n * 0.6 + cells * 0.18, 0.0, 1.0);
          vec3 deep = mix(vec3(0.85, 0.28, 0.06), vec3(0.95, 0.42, 0.1), uHeat);
          vec3 hot = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.95, 0.78), uHeat);
          vec3 col = mix(deep, hot, t);
          float limb = clamp(dot(vN, vView), 0.0, 1.0);
          col *= 0.62 + 0.5 * pow(limb, 0.45);
          col += vec3(1.0, 0.6, 0.25) * pow(1.0 - limb, 2.5) * 0.6;
          col += vec3(1.0, 0.85, 0.6) * uPulse * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), this.mat);
    sphere.scale.setScalar(this.radius);
    this.group.add(sphere);
    const tex = glowTexture();
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color: 0xffb46a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }),
    );
    this.halo.scale.setScalar(this.radius * 7);
    this.corona = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color: 0xff7a35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }),
    );
    this.corona.scale.setScalar(this.radius * 22);
    this.group.add(this.halo, this.corona);
    const light = new THREE.PointLight(0xffe2b8, 2.2, 0, 0);
    this.group.add(light);
  }

  /** A short bright pulse (solar flare). */
  flash() {
    this.pulse = 1;
  }

  update(dt: number, time: number, brightness: number, young: boolean) {
    this.pulse = Math.max(0, this.pulse - dt * 1.4);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uHeat.value = young ? 0.55 : 0.75 + 0.25 * (brightness - 1) * 2;
    this.mat.uniforms.uPulse.value = this.pulse;
    const flick = young ? 0.08 * Math.sin(time * 1.7) * Math.sin(time * 0.63) : 0;
    const b = brightness + flick + this.pulse * 0.6;
    this.halo.scale.setScalar(this.radius * (6.2 + 2.2 * b));
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.55 + 0.35 * b;
    this.corona.scale.setScalar(this.radius * (16 + 10 * b + this.pulse * 14));
    (this.corona.material as THREE.SpriteMaterial).opacity = 0.18 + 0.18 * b;
    this.group.rotation.y = time * 0.03;
  }
}
