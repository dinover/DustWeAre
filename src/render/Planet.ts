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
  cloudCol: RGB;
  gas: number;
  band1: RGB;
  band2: RGB;
  band3: RGB;
  bandFreq: number;
  turb: number;
  storm: number;
  /** Night side of a scorching giant glows like embers. */
  hotGlow: number;
  crater: number;
  /** Reddish cracks across an icy crust (like Europa). */
  crack: number;
  invade: number;
  atm: number;
  atmCol: RGB;
}

export interface RingStyle {
  c1: RGB;
  c2: RGB;
  inner: number;
  outer: number;
  freq: number;
  alpha: number;
  gap: number;
  tilt: number;
}

const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tint = (c: RGB, r: Rng): RGB => [clamp(c[0] * r.range(0.9, 1.1)), clamp(c[1] * r.range(0.9, 1.1)), clamp(c[2] * r.range(0.9, 1.1))];

const GAS_PALETTES: [RGB, RGB, RGB][] = [
  [[0.9, 0.82, 0.66], [0.72, 0.52, 0.36], [0.62, 0.34, 0.22]], // jovian cream and rust
  [[0.93, 0.85, 0.64], [0.8, 0.67, 0.44], [0.97, 0.92, 0.78]], // pale saturnine gold
  [[0.88, 0.9, 0.93], [0.68, 0.74, 0.8], [0.52, 0.58, 0.68]], // ammonia white-blue
  [[0.76, 0.6, 0.8], [0.55, 0.4, 0.64], [0.88, 0.76, 0.86]], // violet haze
  [[0.76, 0.76, 0.5], [0.56, 0.58, 0.34], [0.86, 0.83, 0.6]], // sulfur olive
  [[0.88, 0.57, 0.3], [0.6, 0.34, 0.2], [0.96, 0.82, 0.6]], // stormy orange
  [[0.7, 0.62, 0.55], [0.48, 0.4, 0.36], [0.86, 0.78, 0.7]], // dusky taupe
];
const ICE_PALETTES: [RGB, RGB, RGB][] = [
  [[0.26, 0.44, 0.86], [0.18, 0.3, 0.66], [0.52, 0.68, 0.96]], // deep neptunian blue
  [[0.62, 0.86, 0.88], [0.52, 0.78, 0.82], [0.74, 0.92, 0.93]], // pale uranian cyan
  [[0.36, 0.7, 0.64], [0.24, 0.54, 0.54], [0.56, 0.86, 0.76]], // teal
  [[0.48, 0.56, 0.86], [0.36, 0.4, 0.7], [0.7, 0.76, 0.95]], // periwinkle
];
const HOT_PALETTE: [RGB, RGB, RGB] = [[0.32, 0.14, 0.12], [0.55, 0.2, 0.13], [0.18, 0.07, 0.09]];

const ROCK_PALETTES: [RGB, RGB][] = [
  [[0.58, 0.47, 0.36], [0.72, 0.62, 0.48]], // sandstone
  [[0.46, 0.44, 0.42], [0.3, 0.28, 0.27]], // moon grey
  [[0.62, 0.32, 0.2], [0.78, 0.5, 0.32]], // rust
  [[0.22, 0.2, 0.2], [0.38, 0.34, 0.32]], // basalt
  [[0.82, 0.78, 0.7], [0.62, 0.58, 0.52]], // salt flats
  [[0.8, 0.7, 0.3], [0.6, 0.4, 0.2]], // sulfur
  [[0.42, 0.46, 0.34], [0.58, 0.56, 0.42]], // olivine
  [[0.66, 0.48, 0.5], [0.5, 0.36, 0.38]], // rose clay
];

/** Colours, bands and storms of a giant: no two giants look alike. */
function giantLook(seed: number, icy: boolean, hot: boolean) {
  const r = new Rng(seed ^ 0x51ab);
  const pal = hot ? HOT_PALETTE : icy ? r.pick(ICE_PALETTES) : r.pick(GAS_PALETTES);
  return {
    band1: tint(pal[0], r),
    band2: tint(pal[1], r),
    band3: tint(pal[2], r),
    bandFreq: icy ? r.range(5, 11) : r.range(9, 24),
    turb: icy ? r.range(0.4, 1.6) : r.range(1.4, 4.6),
    storm: r.next() < 0.65 ? r.range(0.35, 1) : 0,
    hotGlow: hot ? 1 : 0,
  };
}

function rockColors(s: Stuff, seed: number, T: number, prefer?: number[]): [RGB, RGB] {
  const m = Math.max(1e-6, massOf(s));
  const metal = s.metal / m;
  const org = s.org / m;
  const r = new Rng(seed);
  const idx = prefer ? r.pick(prefer) : r.int(0, ROCK_PALETTES.length - 1);
  const [p1, p2] = ROCK_PALETTES[idx];
  const dark: RGB = [0.2, 0.17, 0.15];
  let a = tint(p1, r);
  let b = tint(p2, r);
  if (T > 250 && T < 450 && r.next() < 0.3) a = mix3(a, [0.62, 0.32, 0.2], 0.3);
  a = mix3(a, dark, clamp(metal * 0.6 + org * 1.2));
  b = mix3(b, dark, clamp(metal * 0.4 + org * 0.8));
  return [a, b];
}

const baseLook = (seed: number): Look => ({
  seed: (seed % 1000) / 37,
  rock: [0.5, 0.45, 0.4],
  rock2: [0.4, 0.35, 0.3],
  ocean: 0,
  ice: 0,
  veg: 0,
  city: 0,
  lava: 0,
  cloud: 0,
  cloudCol: [0.95, 0.94, 0.9],
  gas: 0,
  band1: [0.8, 0.7, 0.5],
  band2: [0.6, 0.4, 0.3],
  band3: [0.9, 0.8, 0.6],
  bandFreq: 14,
  turb: 3,
  storm: 0,
  hotGlow: 0,
  crater: 0,
  crack: 0,
  invade: 0,
  atm: 0,
  atmCol: [0.5, 0.7, 1],
});
export { baseLook };

/** Appearance of a growing body during formation. */
export function lookOfBody(s: Stuff, seed: number, T: number, hot: number): Look {
  const m = Math.max(1e-6, massOf(s));
  const gasFrac = s.gas / m;
  const waterFrac = s.water / m;
  const [rock, rock2] = rockColors(s, seed, T);
  const giant = gasFrac > 0.3 && m > 4;
  const icy = waterFrac > 0.3;
  const g = giantLook(seed, icy && !giant ? true : waterFrac > gasFrac, false);
  return {
    ...baseLook(seed),
    ...g,
    rock,
    rock2,
    ice: icy ? 1 : T < 200 ? clamp(waterFrac * 4) * 0.6 : 0,
    lava: clamp(hot),
    cloud: giant ? 0 : clamp(gasFrac * 3) * 0.6,
    gas: smoothstep(0.15, 0.4, gasFrac) * (m > 3 ? 1 : 0.4),
    crater: hot < 0.2 && gasFrac < 0.1 ? 0.6 : 0,
    atm: clamp(gasFrac * 2 + 0.15),
    atmCol: icy ? [0.5, 0.75, 1] : [1, 0.75, 0.5],
  };
}

/** Appearance of a finished world, from its physical state and what lives there. */
export function lookOfWorld(w: World, st: WorldStats): Look {
  const r = new Rng(w.seed ^ 77);
  const kind = st.kind;
  const prefer = kind === 'desert' ? [0, 2, 5, 7] : kind === 'barren' ? [1, 3, 4, 6] : kind === 'scorched' ? [2, 5, 3] : undefined;
  const [rock, rock2] = rockColors(w, w.seed, st.T, prefer);
  const life = w.life;
  const stage = life ? life.stage : -1;
  const veg = Math.max(stage >= 1 ? 0.55 + 0.1 * stage : stage === 0 ? 0.18 : 0, w.terra * 0.9);
  const city = Math.max(stage >= 3 && life?.origin ? 0.7 + 0.1 * (stage - 3) : 0, w.colony >= 1 ? 0.55 : w.colony * 0.3);
  const ice = kind === 'ice' ? 0.95 : st.T < 255 ? 0.55 : st.T < 280 ? 0.25 : st.T < 300 ? 0.12 : 0;
  const icegiant = kind === 'icegiant';
  const g = giantLook(w.seed, icegiant, st.giant && st.T > 420);
  let atmCol: RGB = [0.45, 0.68, 1];
  if (kind === 'desert' || kind === 'barren') atmCol = [0.95, 0.66, 0.42];
  if (kind === 'lava') atmCol = [1, 0.42, 0.18];
  if (kind === 'scorched') atmCol = [1, 0.72, 0.42];
  if (st.giant) atmCol = mix3(g.band1, [1, 1, 1], 0.2);
  if (kind === 'ice') atmCol = [0.75, 0.88, 1];
  // Very thick air hides the ground under yellow clouds (like Venus).
  const thick = !st.giant && st.atm > 4;
  const airless = !st.giant && st.atm < 0.08;
  return {
    ...baseLook(w.seed),
    ...g,
    rock,
    rock2,
    ocean: st.giant ? 0 : clamp(st.ocean),
    ice,
    veg: clamp(veg) * (st.giant ? 0 : 1),
    city,
    lava: Math.max(kind === 'lava' ? 1 : w.volcanoCd > 15 ? 0.6 : 0, clamp((w.hot ?? 0) / 25) * 0.8),
    cloud: st.giant ? 0 : thick ? 1 : clamp(st.atm * 0.35) * (st.ocean > 0.1 ? 1 : 0.5),
    cloudCol: thick ? [0.93, 0.82, 0.56] : [0.95, 0.94, 0.9],
    gas: st.giant ? 1 : 0,
    crater: airless ? 0.9 : kind === 'desert' && st.atm < 0.5 ? 0.45 : 0,
    crack: kind === 'ice' && r.next() < 0.7 ? r.range(0.5, 1) : 0,
    invade: clamp(w.invaded),
    atm: st.giant ? 0.7 : thick ? 0.9 : clamp(Math.sqrt(st.atm) * 0.6),
    atmCol,
  };
}

/** Ring colours and shape for a world (impact debris rings are thin and grey). */
export function ringStyleOf(w: World, icegiant: boolean): RingStyle {
  const r = new Rng(w.seed ^ 0x2468);
  if (w.debrisRing) return { c1: [0.5, 0.46, 0.42], c2: [0.66, 0.6, 0.52], inner: 0.74, outer: 2.0, freq: 22, alpha: 0.5, gap: 2, tilt: r.range(0.2, 0.5) };
  const kind = icegiant ? 0 : r.int(0, 3);
  const cols: [RGB, RGB][] = [
    [[0.7, 0.8, 0.86], [0.9, 0.94, 0.97]], // ice
    [[0.82, 0.72, 0.52], [0.95, 0.88, 0.7]], // gold
    [[0.6, 0.48, 0.38], [0.78, 0.66, 0.52]], // dust
    [[0.62, 0.6, 0.6], [0.85, 0.83, 0.8]], // grey
  ];
  const [c1, c2] = cols[kind];
  return { c1, c2, inner: r.range(0.45, 0.66), outer: r.range(2.0, 2.8), freq: r.range(10, 34), alpha: r.range(0.45, 0.8), gap: r.range(0.45, 0.75), tilt: r.range(0.15, 0.55) };
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
  uniform vec3 uCloudCol;
  uniform float uGas;
  uniform vec3 uBand1;
  uniform vec3 uBand2;
  uniform vec3 uBand3;
  uniform float uBandFreq;
  uniform float uTurb;
  uniform float uStorm;
  uniform float uHot;
  uniform float uCrater;
  uniform float uCrack;
  uniform float uInvade;
  uniform vec3 uInvadeCol;
  uniform float uTime;
  uniform float uSel;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vView;
  ${NOISE}
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  float worley(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d = 1.0;
    for (int x = -1; x <= 1; x++)
      for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 r = g + hash3(i + g) - f;
          d = min(d, dot(r, r));
        }
    return sqrt(d);
  }
  // Bowl-shaped crater: dark floor, bright rim.
  float crater(float d, float r) {
    float floorM = 1.0 - smoothstep(r * 0.65, r, d);
    float rim = smoothstep(r * 0.7, r, d) * (1.0 - smoothstep(r, r * 1.3, d));
    return -floorM * 0.32 + rim * 0.28;
  }
  void main() {
    vec3 n = normalize(vObj);
    vec3 p = n * 1.6 + vec3(uSeed, uSeed * 0.37, -uSeed * 0.71);
    vec3 N = normalize(vN);
    vec3 L = normalize(-vWorld);
    float ndl = dot(N, L);
    float day = smoothstep(-0.12, 0.3, ndl);
    float h = fbm(p) * 0.5 + 0.5;
    float lat = abs(n.y);
    vec3 col;
    float land = 1.0;
    vec3 emit = vec3(0.0);
    if (uGas > 0.5) {
      float warp = fbm3(p * vec3(0.8, 2.6, 0.8) + vec3(uTime * 0.01, 0.0, 0.0));
      float b1 = sin(n.y * uBandFreq + warp * uTurb + uSeed);
      float b2 = sin(n.y * uBandFreq * 2.3 + warp * uTurb * 1.7 + uSeed * 1.7);
      col = mix(uBand1, uBand2, b1 * 0.5 + 0.5);
      col = mix(col, uBand3, smoothstep(0.35, 0.95, b2 * 0.5 + 0.5) * 0.6);
      // Great storms and small eddies.
      if (uStorm > 0.0) {
        vec3 sp = normalize(vec3(cos(uSeed * 3.0), sin(uSeed * 1.3) * 0.45, sin(uSeed * 3.0)));
        float d = distance(n, sp) * (1.0 + 0.35 * snoise(p * 5.0));
        float storm = 1.0 - smoothstep(0.08 * uStorm, 0.2 * uStorm, d);
        col = mix(col, uBand2 * 0.75 + vec3(0.14, 0.04, 0.0), storm * 0.85);
        float eddies = smoothstep(0.78, 0.95, snoise(p * 3.2 + 11.0) * 0.5 + 0.5);
        col = mix(col, uBand3, eddies * 0.5 * uStorm);
      }
      col *= 0.9 + 0.2 * snoise(p * 9.0);
      // A fresh comet scar: a dark bruise in the clouds.
      if (uLava > 0.0) {
        vec3 sc = normalize(vec3(sin(uSeed * 5.0), -0.3, cos(uSeed * 5.0)));
        float bruise = 1.0 - smoothstep(0.02, 0.16, distance(n, sc) * (1.0 + 0.4 * snoise(p * 8.0)));
        col = mix(col, vec3(0.12, 0.08, 0.07), bruise * min(1.0, uLava * 1.3));
      }
      emit += vec3(1.0, 0.32, 0.1) * uHot * (1.0 - day) * (0.25 + 0.45 * (b1 * 0.5 + 0.5));
      land = 0.0;
    } else {
      float d = fbm3(p * 3.4 + 7.0) * 0.5 + 0.5;
      col = mix(uRock, uRock2, smoothstep(0.35, 0.72, d));
      col *= 0.85 + 0.3 * (h - 0.5);
      if (uCrater > 0.0) {
        float c = crater(worley(p * 2.4), 0.34) + 0.7 * crater(worley(p * 6.0 + 3.1), 0.3);
        col *= 1.0 + uCrater * c;
      }
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
      if (uCrack > 0.0) {
        float c = pow(1.0 - abs(snoise(p * 4.5 + 9.0)), 14.0) + 0.6 * pow(1.0 - abs(snoise(p * 10.0)), 18.0);
        col = mix(col, vec3(0.58, 0.34, 0.24), clamp(c * uCrack, 0.0, 0.8) * iceMask);
      }
      // Molten crust: dark rock with glowing cracks.
      if (uLava > 0.0) {
        float crack = pow(1.0 - abs(snoise(p * 3.5 + uTime * 0.02)), 7.0);
        col = mix(col, vec3(0.13, 0.09, 0.08), uLava * 0.75);
        emit += vec3(1.0, 0.38, 0.08) * crack * uLava * 1.6 + vec3(0.5, 0.12, 0.02) * uLava * 0.12;
      }
    }
    if (uCloud > 0.0) {
      float c = fbm3(p * 2.3 + vec3(uTime * 0.015, 0.0, uTime * 0.01)) * 0.5 + 0.5;
      float cm = uCloud >= 0.99 ? 0.85 + 0.15 * c : smoothstep(1.0 - uCloud * 0.9, 1.15 - uCloud * 0.7, c);
      col = mix(col, uCloudCol * (0.9 + 0.15 * c), cm * 0.9);
      land *= 1.0 - cm;
    }
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
    float rim = pow(1.0 - max(dot(N, vView), 0.0), 3.0);
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
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform float uSeed;
  uniform float uInner;
  uniform float uFreq;
  uniform float uAlpha;
  uniform float uGap;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float t = (r - uInner) / (1.0 - uInner);
    if (t < 0.0 || t > 1.0) discard;
    float bands = 0.6 + 0.25 * sin(t * uFreq + uSeed) + 0.15 * sin(t * uFreq * 2.7 + uSeed * 2.0);
    float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.82, t);
    float gap = 1.0 - smoothstep(0.035, 0.0, abs(t - uGap)) * 0.88;
    vec3 col = mix(uC1, uC2, smoothstep(0.1, 0.9, t + 0.15 * sin(t * uFreq * 0.4 + uSeed)));
    float a = bands * edge * gap * uAlpha;
    gl_FragColor = vec4(col * (0.55 + 0.45 * bands), a);
  }`;

const v3 = (c: RGB) => new THREE.Vector3(c[0], c[1], c[2]);

/** A world on screen: shaded sphere, atmosphere glow and optional rings. */
export class PlanetMesh {
  group = new THREE.Group();
  body: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  atmo: THREE.Mesh;
  atmoMat: THREE.ShaderMaterial;
  ring: THREE.Mesh | null = null;
  private ringOuter = 2.3;
  private ringKey = '';
  radius = 1;
  spin: number;

  constructor(hi: boolean, seed: number) {
    const L = baseLook(seed);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSeed: { value: 0 },
        uRock: { value: v3(L.rock) },
        uRock2: { value: v3(L.rock2) },
        uOcean: { value: 0 },
        uIce: { value: 0 },
        uVeg: { value: 0 },
        uCity: { value: 0 },
        uLava: { value: 0 },
        uCloud: { value: 0 },
        uCloudCol: { value: v3(L.cloudCol) },
        uGas: { value: 0 },
        uBand1: { value: v3(L.band1) },
        uBand2: { value: v3(L.band2) },
        uBand3: { value: v3(L.band3) },
        uBandFreq: { value: 14 },
        uTurb: { value: 3 },
        uStorm: { value: 0 },
        uHot: { value: 0 },
        uCrater: { value: 0 },
        uCrack: { value: 0 },
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
    const r = new Rng(seed);
    this.spin = 0.15 + r.next() * 0.35;
    // Most worlds lean a little; a few roll on their side.
    const tilt = new Rng(seed ^ 9).next();
    this.body.rotation.z = tilt < 0.12 ? (tilt < 0.06 ? 1.35 : -1.35) : (tilt - 0.5) * 0.6;
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
    u.uCloudCol.value.set(...l.cloudCol);
    u.uGas.value = l.gas;
    u.uBand1.value.set(...l.band1);
    u.uBand2.value.set(...l.band2);
    u.uBand3.value.set(...l.band3);
    u.uBandFreq.value = l.bandFreq;
    u.uTurb.value = l.turb;
    u.uStorm.value = l.storm;
    u.uHot.value = l.hotGlow;
    u.uCrater.value = l.crater;
    u.uCrack.value = l.crack;
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

  setRing(style: RingStyle | null) {
    const key = style ? JSON.stringify(style) : '';
    if (key === this.ringKey) return;
    this.ringKey = key;
    if (this.ring) {
      this.group.remove(this.ring);
      this.ring.geometry.dispose();
      (this.ring.material as THREE.Material).dispose();
      this.ring = null;
    }
    if (!style) return;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uC1: { value: v3(style.c1) },
        uC2: { value: v3(style.c2) },
        uSeed: { value: (this.spin * 1000) % 7 },
        uInner: { value: style.inner },
        uFreq: { value: style.freq },
        uAlpha: { value: style.alpha },
        uGap: { value: style.gap },
      },
      vertexShader: RING_VS,
      fragmentShader: RING_FS,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.ring.rotation.x = -Math.PI / 2 + style.tilt;
    this.ring.rotation.y = style.tilt * 0.6;
    this.ringOuter = style.outer;
    this.group.add(this.ring);
  }

  update(dt: number, time: number, selected: number) {
    this.body.rotation.y += this.spin * dt;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uSel.value = selected;
    if (this.ring) this.ring.scale.setScalar(this.radius * this.ringOuter);
  }

  dispose() {
    this.mat.dispose();
    this.atmoMat.dispose();
    this.setRing(null);
  }
}
