import * as THREE from 'three';
import { NOISE } from './glsl';
import { massOf, type Stuff, type World } from '../core/state';
import type { WorldStats } from '../sim/worlds';
import { Rng, clamp, smoothstep } from '../util';

export type RGB = [number, number, number];

/** Everything the planet shader needs to paint a world. */
export interface Look {
  seed: number;
  rock: RGB;
  rock2: RGB;
  ocean: number;
  ice: number;
  veg: number;
  city: number;
  lava: number;
  cloud: number;
  gas: number;
  band1: RGB;
  band2: RGB;
  invade: number;
  atm: number;
  atmCol: RGB;
}

const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function rockColors(s: Stuff, seed: number, T: number): [RGB, RGB] {
  const m = Math.max(1e-6, massOf(s));
  const metal = s.metal / m;
  const org = s.org / m;
  const r = new Rng(seed);
  const tan: RGB = [0.58, 0.47, 0.36];
  const grey: RGB = [0.46, 0.44, 0.42];
  const rust: RGB = [0.62, 0.32, 0.2];
  const dark: RGB = [0.24, 0.2, 0.18];
  let a = mix3(tan, grey, r.next());
  a = mix3(a, rust, clamp(r.next() * 0.7 + (T > 250 && T < 450 ? 0.15 : 0)));
  a = mix3(a, dark, clamp(metal * 0.9 + org * 1.5));
  const b = mix3(a, r.next() < 0.5 ? [0.72, 0.62, 0.48] : [0.3, 0.26, 0.24], 0.45);
  return [a, b];
}

/** Appearance of a growing body during formation. */
export function lookOfBody(s: Stuff, seed: number, T: number, hot: number): Look {
  const m = Math.max(1e-6, massOf(s));
  const gasFrac = s.gas / m;
  const waterFrac = s.water / m;
  const [rock, rock2] = rockColors(s, seed, T);
  const giant = gasFrac > 0.3 && m > 4;
  const icy = waterFrac > 0.3;
  return {
    seed: (seed % 1000) / 37,
    rock,
    rock2,
    ocean: 0,
    ice: icy ? 1 : T < 200 ? clamp(waterFrac * 4) * 0.6 : 0,
    veg: 0,
    city: 0,
    lava: clamp(hot),
    cloud: giant ? 0 : clamp(gasFrac * 3) * 0.6,
    gas: smoothstep(0.15, 0.4, gasFrac) * (m > 3 ? 1 : 0.4),
    band1: icy ? [0.55, 0.75, 0.8] : [0.86, 0.72, 0.52],
    band2: icy ? [0.32, 0.5, 0.62] : [0.62, 0.44, 0.3],
    invade: 0,
    atm: clamp(gasFrac * 2 + 0.15),
    atmCol: icy ? [0.5, 0.75, 1] : [1, 0.75, 0.5],
  };
}

/** Appearance of a finished world, from its physical state and what lives there. */
export function lookOfWorld(w: World, st: WorldStats): Look {
  const [rock, rock2] = rockColors(w, w.seed, st.T);
  const life = w.life;
  const stage = life ? life.stage : -1;
  const veg = Math.max(stage >= 1 ? 0.55 + 0.1 * stage : stage === 0 ? 0.18 : 0, w.terra * 0.9);
  const city = Math.max(stage >= 3 && life?.origin ? 0.7 + 0.1 * (stage - 3) : 0, w.colony >= 1 ? 0.55 : w.colony * 0.3);
  const ice = st.kind === 'ice' ? 0.95 : st.T < 255 ? 0.55 : st.T < 280 ? 0.25 : st.T < 300 ? 0.12 : 0;
  const icegiant = st.kind === 'icegiant';
  let band1: RGB = icegiant ? [0.5, 0.74, 0.8] : [0.88, 0.74, 0.54];
  let band2: RGB = icegiant ? [0.28, 0.46, 0.62] : [0.64, 0.42, 0.28];
  const hue = new Rng(w.seed ^ 77).next();
  if (!icegiant && hue > 0.6) {
    band1 = [0.9, 0.82, 0.68];
    band2 = [0.7, 0.5, 0.38];
  }
  let atmCol: RGB = [0.45, 0.68, 1];
  if (st.kind === 'desert' || st.kind === 'barren') atmCol = [0.95, 0.66, 0.42];
  if (st.kind === 'lava') atmCol = [1, 0.42, 0.18];
  if (st.kind === 'scorched') atmCol = [1, 0.72, 0.42];
  if (st.giant) atmCol = icegiant ? [0.55, 0.82, 1] : [1, 0.82, 0.6];
  if (st.kind === 'ice') atmCol = [0.75, 0.88, 1];
  return {
    seed: (w.seed % 1000) / 37,
    rock,
    rock2,
    ocean: st.giant ? 0 : clamp(st.ocean),
    ice,
    veg: clamp(veg) * (st.giant ? 0 : 1),
    city,
    lava: st.kind === 'lava' ? 1 : w.volcanoCd > 15 ? 0.6 : 0,
    cloud: st.giant ? 0 : clamp(st.atm * 0.35) * (st.ocean > 0.1 ? 1 : 0.5),
    gas: st.giant ? 1 : 0,
    band1,
    band2,
    invade: clamp(w.invaded),
    atm: st.giant ? 0.7 : clamp(Math.sqrt(st.atm) * 0.6),
    atmCol,
  };
}

let sphereHi: THREE.SphereGeometry | null = null;
let sphereLo: THREE.SphereGeometry | null = null;
const sphere = (hi: boolean) => (hi ? (sphereHi ??= new THREE.SphereGeometry(1, 56, 36)) : (sphereLo ??= new THREE.SphereGeometry(1, 28, 18)));

const PLANET_VS = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vView;
  void main() {
    vObj = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const PLANET_FS = /* glsl */ `
  uniform float uSeed;
  uniform vec3 uRock;
  uniform vec3 uRock2;
  uniform float uOcean;
  uniform float uIce;
  uniform float uVeg;
  uniform float uCity;
  uniform float uLava;
  uniform float uCloud;
  uniform float uGas;
  uniform vec3 uBand1;
  uniform vec3 uBand2;
  uniform float uInvade;
  uniform vec3 uInvadeCol;
  uniform float uTime;
  uniform float uSel;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vView;
  ${NOISE}
  void main() {
    vec3 n = normalize(vObj);
    vec3 p = n * 1.6 + vec3(uSeed, uSeed * 0.37, -uSeed * 0.71);
    float h = fbm(p) * 0.5 + 0.5;
    float lat = abs(n.y);
    vec3 col;
    float land = 1.0;
    vec3 emit = vec3(0.0);
    if (uGas > 0.5) {
      float warp = fbm3(p * vec3(1.0, 4.0, 1.0) + vec3(uTime * 0.01, 0.0, 0.0));
      float b = sin(n.y * 14.0 + warp * 3.2 + uSeed);
      col = mix(uBand1, uBand2, b * 0.5 + 0.5);
      float storm = smoothstep(0.75, 0.95, snoise(p * 2.2 + 11.0) * 0.5 + 0.5);
      col = mix(col, uBand2 * 0.75 + vec3(0.15, 0.04, 0.0), storm * 0.6);
      col *= 0.9 + 0.2 * snoise(p * 9.0);
      land = 0.0;
    } else {
      float d = fbm3(p * 3.4 + 7.0) * 0.5 + 0.5;
      col = mix(uRock, uRock2, smoothstep(0.35, 0.72, d));
      col *= 0.85 + 0.3 * (h - 0.5);
      // Seas fill the low ground; the coverage follows how much water the world holds.
      float sea = uOcean <= 0.001 ? -1.0 : (uOcean >= 0.97 ? 2.0 : 0.5 + (uOcean - 0.5) * 0.62);
      if (h < sea) {
        float depth = smoothstep(sea - 0.22, sea, h);
        col = mix(vec3(0.03, 0.1, 0.18), vec3(0.1, 0.34, 0.4), depth);
        land = 0.0;
      } else {
        float coast = smoothstep(sea, sea + 0.25, h);
        float vegMask = uVeg * smoothstep(0.92, 0.35, lat) * (1.0 - smoothstep(0.75, 0.95, h));
        vec3 green = mix(vec3(0.18, 0.36, 0.12), vec3(0.34, 0.44, 0.18), d);
        col = mix(col, green, clamp(vegMask * (0.6 + 0.6 * coast), 0.0, 0.9));
      }
      // Ice caps grow towards the equator as the world cools.
      float capLine = 1.0 - uIce;
      float iceMask = smoothstep(capLine, capLine + 0.06, lat + (h - 0.5) * 0.25);
      col = mix(col, vec3(0.9, 0.94, 0.98), iceMask);
      // Molten crust: dark rock with glowing cracks.
      if (uLava > 0.0) {
        float crack = pow(1.0 - abs(snoise(p * 3.5 + uTime * 0.02)), 7.0);
        col = mix(col, vec3(0.13, 0.09, 0.08), uLava * 0.75);
        emit += vec3(1.0, 0.38, 0.08) * crack * uLava * 1.6 + vec3(0.5, 0.12, 0.02) * uLava * 0.12;
      }
    }
    if (uCloud > 0.0) {
      float c = fbm3(p * 2.3 + vec3(uTime * 0.015, 0.0, uTime * 0.01)) * 0.5 + 0.5;
      float cm = smoothstep(1.0 - uCloud * 0.9, 1.15 - uCloud * 0.7, c);
      col = mix(col, vec3(0.95, 0.94, 0.9), cm * 0.85);
      land *= 1.0 - cm;
    }
    vec3 L = normalize(-vWorld);
    float ndl = dot(normalize(vN), L);
    float day = smoothstep(-0.12, 0.3, ndl);
    // Soft wrap lighting keeps the night side readable without losing the terminator.
    vec3 lit = col * (0.1 + 1.0 * smoothstep(-0.3, 1.0, ndl) + 0.12 * max(ndl, 0.0));
    // City lights glitter on the night side.
    if (uCity > 0.0) {
      float lights = smoothstep(0.55, 0.85, snoise(n * 26.0 + uSeed) * 0.5 + 0.5) * (0.6 + 0.4 * snoise(n * 7.0 + 3.0));
      emit += vec3(1.0, 0.72, 0.36) * lights * uCity * land * (1.0 - day) * 1.3;
    }
    if (uInvade > 0.0) {
      float veins = pow(1.0 - abs(snoise(p * 4.0 + 31.0 + uTime * 0.05)), 9.0);
      emit += uInvadeCol * veins * uInvade * (0.9 + 0.3 * sin(uTime * 2.0));
      lit = mix(lit, uInvadeCol * 0.18 * day, uInvade * 0.25);
    }
    float rim = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 3.0);
    emit += vec3(1.0, 0.8, 0.45) * rim * uSel * 0.7;
    gl_FragColor = vec4(lit + emit, 1.0);
  }`;

const ATMO_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vView;
  varying vec3 vObj;
  void main() {
    vec3 N = normalize(vN);
    float fres = pow(1.0 - max(dot(N, vView), 0.0), 2.6);
    vec3 L = normalize(-vWorld);
    float day = smoothstep(-0.35, 0.4, dot(N, L));
    gl_FragColor = vec4(uColor * fres * uStrength * (0.15 + 0.85 * day), 1.0);
  }`;

const RING_VS = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const RING_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uSeed;
  uniform float uInner;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float t = (r - uInner) / (1.0 - uInner);
    if (t < 0.0 || t > 1.0) discard;
    float bands = 0.62 + 0.22 * sin(t * 19.0 + uSeed) + 0.16 * sin(t * 47.0 + uSeed * 2.0);
    float edge = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.8, t);
    float gap = 1.0 - smoothstep(0.035, 0.0, abs(t - 0.62)) * 0.85;
    float a = bands * edge * gap * 0.55;
    gl_FragColor = vec4(uColor * (0.5 + 0.5 * bands), a);
  }`;

/** A world on screen: shaded sphere, atmosphere glow and optional rings. */
export class PlanetMesh {
  group = new THREE.Group();
  body: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  atmo: THREE.Mesh;
  atmoMat: THREE.ShaderMaterial;
  ring: THREE.Mesh | null = null;
  radius = 1;
  spin: number;

  constructor(hi: boolean, seed: number) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSeed: { value: 0 },
        uRock: { value: new THREE.Vector3(0.5, 0.45, 0.4) },
        uRock2: { value: new THREE.Vector3(0.4, 0.35, 0.3) },
        uOcean: { value: 0 },
        uIce: { value: 0 },
        uVeg: { value: 0 },
        uCity: { value: 0 },
        uLava: { value: 0 },
        uCloud: { value: 0 },
        uGas: { value: 0 },
        uBand1: { value: new THREE.Vector3(0.8, 0.7, 0.5) },
        uBand2: { value: new THREE.Vector3(0.6, 0.4, 0.3) },
        uInvade: { value: 0 },
        uInvadeCol: { value: new THREE.Vector3(0.75, 0.35, 1) },
        uTime: { value: 0 },
        uSel: { value: 0 },
      },
      vertexShader: PLANET_VS,
      fragmentShader: PLANET_FS,
    });
    this.body = new THREE.Mesh(sphere(hi), this.mat);
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(0.5, 0.7, 1) }, uStrength: { value: 0.6 } },
      vertexShader: PLANET_VS,
      fragmentShader: ATMO_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.atmo = new THREE.Mesh(sphere(false), this.atmoMat);
    this.atmo.scale.setScalar(1.12);
    this.body.add(this.atmo);
    this.group.add(this.body);
    this.spin = 0.15 + new Rng(seed).next() * 0.35;
    this.body.rotation.z = (new Rng(seed ^ 9).next() - 0.5) * 0.6;
  }

  setLook(l: Look) {
    const u = this.mat.uniforms;
    u.uSeed.value = l.seed;
    u.uRock.value.set(...l.rock);
    u.uRock2.value.set(...l.rock2);
    u.uOcean.value = l.ocean;
    u.uIce.value = l.ice;
    u.uVeg.value = l.veg;
    u.uCity.value = l.city;
    u.uLava.value = l.lava;
    u.uCloud.value = l.cloud;
    u.uGas.value = l.gas;
    u.uBand1.value.set(...l.band1);
    u.uBand2.value.set(...l.band2);
    u.uInvade.value = l.invade;
    this.atmoMat.uniforms.uColor.value.set(...l.atmCol);
    this.atmoMat.uniforms.uStrength.value = l.atm;
    this.atmo.visible = l.atm > 0.04;
  }

  setInvaderHue(h: number) {
    const c = new THREE.Color().setHSL(h, 0.75, 0.6);
    this.mat.uniforms.uInvadeCol.value.set(c.r, c.g, c.b);
  }

  setRadius(r: number) {
    this.radius = r;
    this.body.scale.setScalar(r);
  }

  setRing(on: boolean, seed: number, color: RGB) {
    if (!on) {
      if (this.ring) {
        this.group.remove(this.ring);
        this.ring.geometry.dispose();
        (this.ring.material as THREE.Material).dispose();
        this.ring = null;
      }
      return;
    }
    if (this.ring) return;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(...color) }, uSeed: { value: (seed % 100) / 7 }, uInner: { value: 0.55 } },
      vertexShader: RING_VS,
      fragmentShader: RING_FS,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.ring.rotation.x = -Math.PI / 2 + 0.35;
    this.ring.rotation.y = 0.2;
    this.group.add(this.ring);
  }

  update(dt: number, time: number, selected: number) {
    this.body.rotation.y += this.spin * dt;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uSel.value = selected;
    if (this.ring) this.ring.scale.setScalar(this.radius * 2.3);
  }

  dispose() {
    this.mat.dispose();
    this.atmoMat.dispose();
    this.setRing(false, 0, [0, 0, 0]);
  }
}
