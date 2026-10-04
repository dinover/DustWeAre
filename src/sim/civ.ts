import { massOf, toAU, toWorld, type CivState, type Decision, type GameState, type Resources, type Ship, type World } from '../core/state';
import { Rng, TAU, clamp } from '../util';
import { colonizable, isGiantStuff, type WorldStats } from './worlds';
import { worldXZ } from '../render/layout';
import { MISSION_COST, PROJECTS, TECHS, researchCost, type ProjectId } from '../content/projects';
import { FLAVOR } from '../content/flavor';
import { capName, speciesName, worldName } from '../content/names';
import type { Bi } from '../i18n';
import type { PeopleSim, PeopleFx } from './peoples';

export type Role = 'fuel' | 'water' | 'science' | 'metal';
export const RES_KEYS: (keyof Resources)[] = ['metal', 'fuel', 'water', 'science'];
export const RES_ICON: Record<keyof Resources, string> = { metal: '⛏', fuel: '◍', water: '❄', science: '✦' };

/** What a settled world contributes to the civilization. */
export function roleOf(w: World, st: WorldStats): Role {
  if (st.giant) return 'fuel';
  if (w.life || w.guest || st.H >= 0.5 || w.terra >= 0.5) return 'science';
  if (st.kind === 'ice' || st.kind === 'ocean') return 'water';
  return 'metal';
}

/** A world of yours: a colony, refugees you took in, or your species' home. */
export const isSettled = (w: World) => (w.colony >= 1 && !w.owner) || !!w.guest || (!!w.life?.origin && !w.life.people && w.life.stage >= 3);

export function newCiv(time: number): CivState {
  return {
    res: { metal: 30, fuel: 20, water: 20, science: 30 },
    done: {},
    building: null,
    missions: [],
    decisions: [],
    armada: null,
    rogue: null,
    nextLate: time + 70,
    nextFlavor: time + 30,
    peace: false,
    allies: [],
    artifactFound: false,
    stats: { expeditions: 0, battles: 0, trades: 0, colonies: 0, armadas: 0 },
  };
}

/** What the civilization's late game needs from the system simulation. */
export interface CivHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  world(id: number): World | undefined;
  stats(w: World): WorldStats;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact'): void;
  fx(f: CivFx | PeopleFx): void;
  readonly topStage: number;
  readonly origin: World | null;
  readonly peoples: PeopleSim;
}

export type CivFx =
  | { kind: 'laser'; ship: number; world: number }
  | { kind: 'boom'; ship: number; big: boolean }
  | { kind: 'shieldHit'; world: number; threat: number }
  | { kind: 'warpOut'; x: number; z: number; dx: number; dz: number; count: number; tint: 'own' | 'alien' }
  | { kind: 'warpIn'; x: number; z: number; dx: number; dz: number; count: number; tint: 'own' | 'alien' }
  | { kind: 'supernova' }
  | { kind: 'superflare' }
  | { kind: 'built'; id: ProjectId; world: number }
  | { kind: 'rogueCaught'; world: number };

const has = (r: Resources, c: Partial<Resources>) => RES_KEYS.every((k) => r[k] >= (c[k] ?? 0));
const pay = (r: Resources, c: Partial<Resources>) => RES_KEYS.forEach((k) => (r[k] -= c[k] ?? 0));
const gain = (r: Resources, c: Partial<Resources>) => RES_KEYS.forEach((k) => (r[k] += c[k] ?? 0));

/**
 * The late game: once a species builds cities it starts an economy. Each settled world
 * contributes according to what it is (giants give fuel, icy worlds water, rocky worlds metal,
 * living worlds science), which pays for great works, expeditions and armadas — while traders,
 * refugees, wandering planets and rival species keep visiting.
 */
export class CivSim {
  private tmp = { x: 0, z: 0 };
  private freightT = new Map<number, number>();
  private minerT = 4;
  private byId = new Map<number, World>();
  rates: Resources = { metal: 0, fuel: 0, water: 0, science: 0 };

  constructor(private h: CivHost) {}

  get civ() {
    return this.h.s.civ ?? null;
  }

  /** Is the civilization old enough for great works? */
  get spacefaring() {
    const s = this.h.s;
    return !!s.species && (this.h.topStage >= 4 || s.worlds.some((w) => w.colony >= 1));
  }

  home(): World | null {
    return this.h.origin ?? this.h.s.worlds.find((w) => w.colony >= 1) ?? null;
  }

  pos(w: World) {
    this.byId.clear();
    for (const x of this.h.s.worlds) this.byId.set(x.id, x);
    return { ...worldXZ(w, this.byId, this.tmp) };
  }

  settled() {
    return this.h.s.worlds.filter(isSettled);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    const s = this.h.s;
    if (!s.civ) {
      if (s.species && (this.h.topStage >= 3 || s.worlds.some((w) => w.colony >= 1))) s.civ = newCiv(s.time);
      else return;
    }
    const civ = s.civ!;
    this.produce(civ, dt);
    this.build(civ, dt);
    this.researching(civ, dt);
    this.traffic(civ, dt);
    this.missions(civ, dt);
    this.armada(civ, dt);
    this.flotillas(civ);
    this.defend(civ, dt);
    this.decisions(civ, dt);
    this.rogue(civ, dt);
    this.events(civ, dt);
    this.flavor(civ);
  }

  // ------------------------------------------------------------------ economy
  private produce(civ: CivState, dt: number) {
    const r: Resources = { metal: 0, fuel: 0, water: 0, science: 0 };
    const roles = new Set<Role>();
    const origin = this.h.origin;
    for (const w of this.h.s.worlds) {
      if (!isSettled(w)) continue;
      const st = this.h.stats(w);
      const role = roleOf(w, st);
      roles.add(role);
      const moon = w.parent !== null ? 0.6 : 1;
      if (role === 'fuel') {
        r.fuel += (st.kind === 'icegiant' ? 0.35 : 0.5) * (civ.done.refinery ? 2 : 1);
        if (st.kind === 'icegiant') r.water += 0.2;
      } else if (role === 'water') r.water += 0.45 * moon;
      else if (role === 'metal') r.metal += (st.kind === 'lava' ? 0.6 : 0.5) * moon;
      else {
        // Living moons warmed by their giant are treasured: twice the science.
        const parent = w.parent !== null ? this.h.world(w.parent) : null;
        const jewel = parent && isGiantStuff(parent) ? 2 : 1;
        r.science += 0.45 * moon * jewel;
      }
      if (w === origin) r.science += 0.6;
    }
    if (civ.done.mining && this.h.s.belts.length) r.metal += 0.6;
    if (civ.done.ring) r.science *= 1.5;
    // Allied peoples share their science.
    r.science *= 1 + 0.15 * (this.h.s.rivals ?? []).filter((x) => x.relation === 'alliance').length;
    const diversity = roles.size >= 4 ? 1.3 : roles.size >= 3 ? 1.15 : 1;
    const tech = 1 + 0.1 * (civ.tech ?? 0);
    for (const k of RES_KEYS) {
      r[k] *= diversity * tech;
      civ.res[k] += r[k] * dt;
    }
    this.rates = r;
  }

  /** Why a project cannot be started right now (null: it can). */
  lock(id: ProjectId): Bi | null {
    const civ = this.civ;
    const s = this.h.s;
    if (!civ) return { es: 'Primero, una civilización.', en: 'First, a civilization.' };
    if (civ.done[id]) return { es: 'Completado.', en: 'Completed.' };
    if (!this.spacefaring) return { es: 'Disponible en la era espacial.', en: 'Available in the space age.' };
    const def = PROJECTS.find((p) => p.id === id)!;
    const doneEra1 = PROJECTS.filter((p) => p.era === 1 && civ.done[p.id]).length;
    if (def.era === 2 && doneEra1 < 2) return { es: 'Necesita dos obras de la era interplanetaria.', en: 'Needs two works of the interplanetary age.' };
    if (def.era === 3 && !civ.done.warp) return { es: 'Necesita el motor de curvatura.', en: 'Needs the warp drive.' };
    if (id === 'refinery' && !s.worlds.some((w) => isSettled(w) && isGiantStuff(w)))
      return { es: 'Necesita una colonia en un gigante gaseoso o de hielo.', en: 'Needs a colony on a gas or ice giant.' };
    if (id === 'mining' && !s.belts.length) return { es: 'Tu sistema no tiene cinturones de asteroides.', en: 'Your system has no asteroid belts.' };
    if (id === 'armada' && !civ.done.fleet) return { es: 'Necesita la flota de defensa.', en: 'Needs the defence fleet.' };
    if (id === 'ark' && !s.worlds.filter(colonizable).every((w) => isSettled(w) || this.h.peoples.allied(w)))
      return { es: 'Tu especie (o tus aliados) deben habitar todos los mundos.', en: 'Your species (or your allies) must live on every world.' };
    if (id === 'ark' && this.h.peoples.atWar()) return { es: 'No se puede partir en plena guerra.', en: 'You cannot leave in the middle of a war.' };
    if (civ.building) return { es: 'Ya hay una gran obra en marcha.', en: 'A great work is already under way.' };
    return null;
  }

  canAfford(c: Partial<Resources>) {
    return !!this.civ && has(this.civ.res, c);
  }

  start(id: ProjectId) {
    const civ = this.civ;
    const def = PROJECTS.find((p) => p.id === id);
    if (!civ || !def || this.lock(id) || !has(civ.res, def.cost)) return false;
    pay(civ.res, def.cost);
    civ.building = { id, t: 0, dur: def.time };
    const sn = this.h.s.species?.name ?? '';
    this.h.news(def.icon, `Los ${sn} comienzan una gran obra: ${def.name.es.toLowerCase()}.`, `The ${capName(sn)} begin a great work: ${def.name.en.toLowerCase()}.`, 'info');
    return true;
  }

  private build(civ: CivState, dt: number) {
    const b = civ.building;
    if (!b) return;
    b.t += dt;
    if (b.t < b.dur) return;
    civ.building = null;
    civ.done[b.id] = true;
    const def = PROJECTS.find((p) => p.id === b.id)!;
    const home = this.home();
    this.h.fx({ kind: 'built', id: def.id as ProjectId, world: home?.id ?? -1 });
    const sn = this.h.s.species?.name ?? '';
    const lines: Record<ProjectId, Bi> = {
      elevator: { es: `Se inaugura el ascensor espacial de ${home?.name}: el cielo ya está a un viaje en tranvía.`, en: `The space elevator of ${home?.name} opens: the sky is now a tram ride away.` },
      mining: { es: `Los primeros mineros llegan a los cinturones de asteroides.`, en: `The first miners reach the asteroid belts.` },
      refinery: { es: `Las refinerías flotan en las nubes de los gigantes: el combustible empieza a fluir.`, en: `Refineries float in the giants’ clouds: fuel starts to flow.` },
      shield: { es: `Se encienden los escudos planetarios. Ninguna roca volverá a caer sobre una colonia.`, en: `The planetary shields come online. No rock will ever fall on a colony again.` },
      fleet: { es: `La flota de defensa de los ${sn} entra en servicio.`, en: `The defence fleet of the ${capName(sn)} enters service.` },
      ring: { es: `El anillo orbital rodea ${home?.name}: brilla de noche como una corona.`, en: `The orbital ring circles ${home?.name}: it shines at night like a crown.` },
      warp: { es: `¡Primer salto de curvatura! Las estrellas vecinas están a semanas de distancia.`, en: `First warp jump! The neighbouring stars are only weeks away.` },
      dyson: { es: `El enjambre de Dyson envuelve la estrella. Su luz ya es nuestra.`, en: `The Dyson swarm wraps the star. Its light is now ours.` },
      armada: { es: `Los astilleros entregan la armada interestelar. Espera tus órdenes.`, en: `The shipyards deliver the interstellar armada. It awaits your orders.` },
      ark: { es: `El arca estelar está lista. Los ${sn} se despiden de su estrella.`, en: `The star ark is ready. The ${capName(sn)} say farewell to their star.` },
    };
    this.h.news(def.icon, lines[def.id].es, lines[def.id].en, 'good');
    if (b.id === 'ark' && home) {
      this.h.s.ships.push({ id: this.h.nid(), from: home.id, to: home.id, t: 0, dur: 14, alien: false, ark: true, kind: 'ark' });
    }
  }

  // ------------------------------------------------------------------ research
  researchLock(): Bi | null {
    const civ = this.civ;
    if (!civ || !this.spacefaring) return { es: 'Disponible en la era espacial.', en: 'Available in the space age.' };
    if (civ.research) return { es: 'Ya hay una investigación en curso.', en: 'Research is already under way.' };
    if (!has(civ.res, researchCost(civ.tech ?? 0))) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  startResearch() {
    const civ = this.civ;
    if (!civ || this.researchLock()) return false;
    pay(civ.res, researchCost(civ.tech ?? 0));
    civ.research = { t: 0, dur: 30 + 4 * (civ.tech ?? 0) };
    return true;
  }

  private researching(civ: CivState, dt: number) {
    const r = civ.research;
    if (!r) return;
    r.t += dt;
    if (r.t < r.dur) return;
    civ.research = null;
    const lvl = civ.tech ?? 0;
    civ.tech = lvl + 1;
    const t = TECHS[lvl % TECHS.length];
    const gen = Math.floor(lvl / TECHS.length);
    const es = gen ? `${t.es} ${gen + 1}` : t.es;
    const en = gen ? `${t.en} ${gen + 1}` : t.en;
    const sn = this.h.s.species?.name ?? '';
    this.h.news('⚗', `Los ${sn} dominan una nueva tecnología: ${es}. Todo el sistema produce un poco más.`, `The ${capName(sn)} master a new technology: ${en}. The whole system produces a little more.`, 'good');
  }

  // ------------------------------------------------------------------ traffic
  private shipCount() {
    return this.h.s.ships.length;
  }

  private traffic(civ: CivState, dt: number) {
    const s = this.h.s;
    const rng = this.h.rng;
    const settled = this.settled();
    if (settled.length < 2 && !civ.done.mining) return;
    const home = this.home();
    for (const w of settled) {
      if (w.invaded > 0.5) continue;
      let t = this.freightT.get(w.id) ?? rng.range(2, 10);
      t -= dt * (civ.done.elevator ? 1.5 : 1);
      if (t <= 0) {
        t = rng.range(18, 30);
        if (this.shipCount() < 40 && settled.length >= 2) {
          const others = settled.filter((o) => o !== w);
          const to = w !== home && home && rng.next() < 0.55 ? home : rng.pick(others);
          const role = roleOf(w, this.h.stats(w));
          const a = this.pos(w);
          const b = this.pos(to);
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          s.ships.push({ id: this.h.nid(), from: w.id, to: to.id, t: 0, dur: 6 + d * 0.22, alien: false, kind: role === 'fuel' ? 'tanker' : 'freight' });
        }
      }
      this.freightT.set(w.id, t);
    }
    if (civ.done.mining && s.belts.length) {
      this.minerT -= dt;
      if (this.minerT <= 0) {
        this.minerT = rng.range(6, 10);
        const bases = settled.filter((w) => !isGiantStuff(w));
        if (bases.length && this.shipCount() < 50) {
          const w = rng.pick(bases);
          // Miners work the rocks closest to home, never the far edge of the system.
          const p = this.pos(w);
          let best = -1;
          let bd = Infinity;
          for (let k = 0; k < 16; k++) {
            const i = (rng.next() * s.belts.length) | 0;
            const b = s.belts[i];
            const th = b.th + 0.5 * Math.pow(Math.max(b.r, 0.05), -0.75) * 0.42 * s.time;
            const rw = toWorld(b.r);
            const d = Math.hypot(Math.cos(th) * rw - p.x, Math.sin(th) * rw - p.z);
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          if (best >= 0 && bd < 30) s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: 0, dur: 6 + bd * 0.2, alien: false, kind: 'miner', belt: best });
        }
      }
    }
  }

  /** A civilization ship reached its destination. Returns true when handled here. */
  arrive(sh: Ship): boolean {
    const s = this.h.s;
    const civ = this.civ;
    const k = sh.kind;
    if (!k || k === 'colony' || k === 'alien' || k === 'mother' || k === 'ark') return false;
    if (k === 'miner' && !sh.back) {
      // Back home with a hold full of ore.
      s.ships.push({ id: this.h.nid(), from: -2, to: sh.from, t: 0, dur: sh.dur, alien: false, kind: 'miner', belt: sh.belt, back: true });
    }
    if (k === 'expedition' && civ) {
      if (!sh.back) {
        const dx = sh.tx ?? 0;
        const dz = sh.tz ?? 0;
        const len = Math.hypot(dx, dz) || 1;
        this.h.fx({ kind: 'warpOut', x: dx, z: dz, dx: dx / len, dz: dz / len, count: 1, tint: 'own' });
        civ.missions.push({ id: this.h.nid(), kind: 'expedition', t: 0, dur: this.h.rng.range(40, 60), x: dx, z: dz });
      } else this.expeditionReturns(civ);
    }
    if (k === 'armada' && civ?.armada && !sh.back) civ.armada.gathered++;
    if (k === 'flotilla' && civ?.flotilla) {
      civ.flotilla.gathered++;
      if (civ.flotilla.gathered >= civ.flotilla.launched) this.flotillaJumps(civ);
    }
    if (k === 'refugee') {
      const w = this.h.world(sh.to);
      if (w && sh.back !== true) {
        const name = sh.species ?? speciesName(this.h.rng);
        w.guest = name;
        if (civ && !civ.allies.includes(name)) civ.allies.push(name);
        this.h.news('⌂', `Los ${name} se instalan en ${w.name}. Prometen compartir lo que saben.`, `The ${capName(name)} settle on ${w.name}. They promise to share what they know.`, 'good');
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ missions
  missionLock(kind: 'expedition' | 'armada'): Bi | null {
    const civ = this.civ;
    if (!civ) return { es: 'Primero, una civilización.', en: 'First, a civilization.' };
    if (kind === 'expedition') {
      if (!civ.done.warp) return { es: 'Necesita el motor de curvatura.', en: 'Needs the warp drive.' };
      if (civ.missions.filter((m) => m.kind === 'expedition').length + this.h.s.ships.filter((x) => x.kind === 'expedition').length >= 2)
        return { es: 'Ya hay dos expediciones en viaje.', en: 'Two expeditions are already travelling.' };
    } else {
      if (!civ.done.armada) return { es: 'Necesita la armada interestelar.', en: 'Needs the interstellar armada.' };
      if (civ.armada) return { es: 'La armada ya está en marcha.', en: 'The armada is already under way.' };
    }
    if (!has(civ.res, MISSION_COST[kind])) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  sendExpedition() {
    const civ = this.civ;
    const home = this.home();
    if (!civ || !home || this.missionLock('expedition')) return false;
    pay(civ.res, MISSION_COST.expedition);
    const p = this.pos(home);
    const len = Math.hypot(p.x, p.z) || 1;
    const ang = Math.atan2(p.z, p.x) + this.h.rng.range(-0.6, 0.6);
    const R = len + 26;
    this.h.s.ships.push({ id: this.h.nid(), from: home.id, to: -1, t: 0, dur: 7, alien: false, kind: 'expedition', tx: Math.cos(ang) * R, tz: Math.sin(ang) * R });
    civ.stats.expeditions++;
    const sn = this.h.s.species?.name ?? '';
    this.h.news('✶', `Una expedición de los ${sn} parte hacia las estrellas vecinas.`, `An expedition of the ${capName(sn)} sets out for the neighbouring stars.`, 'info');
    return true;
  }

  private missions(civ: CivState, dt: number) {
    for (const m of [...civ.missions]) {
      m.t += dt;
      if (m.t < m.dur) continue;
      civ.missions.splice(civ.missions.indexOf(m), 1);
      if (m.kind === 'artifact') {
        this.artifactResult(civ);
        continue;
      }
      // Warp back in and fly home.
      const home = this.home();
      const len = Math.hypot(m.x, m.z) || 1;
      this.h.fx({ kind: 'warpIn', x: m.x, z: m.z, dx: -m.x / len, dz: -m.z / len, count: 1, tint: 'own' });
      if (m.kind === 'signal') {
        this.signalResult(civ);
        continue;
      }
      if (home) this.h.s.ships.push({ id: this.h.nid(), from: -3, to: home.id, t: 0, dur: 7, alien: false, kind: 'expedition', sx: m.x, sz: m.z, back: true });
    }
  }

  private expeditionReturns(civ: CivState) {
    const rng = this.h.rng;
    const sn = this.h.s.species?.name ?? '';
    const S = capName(sn);
    const roll = rng.next();
    if (roll < 0.3) {
      const g = { metal: rng.int(60, 120), fuel: rng.int(40, 90), science: rng.int(40, 90) };
      gain(civ.res, g);
      this.h.news('✶', `La expedición vuelve con las bodegas llenas: metales raros, hielo y datos de otra estrella.`, `The expedition returns with full holds: rare metals, ice and data from another star.`, 'good');
    } else if (roll < 0.55) {
      const name = speciesName(rng);
      civ.allies.push(name);
      gain(civ.res, { science: 120 });
      this.h.news('✶', `La expedición hace contacto con los ${name}, una especie amable. Pronto llegarán sus mercaderes.`, `The expedition makes contact with the ${capName(name)}, a friendly species. Their traders will come soon.`, 'good');
    } else if (roll < 0.8) {
      civ.stats.colonies++;
      gain(civ.res, { science: 80 });
      const star = worldName(rng, new Set());
      this.h.news('✶', `Los ${sn} fundan una colonia junto a la estrella ${star}. Ya son ${civ.stats.colonies + 1} sistemas.`, `The ${S} found a colony by the star ${star}. They now span ${civ.stats.colonies + 1} systems.`, 'good');
    } else if (roll < 0.92) {
      if (civ.building) civ.building.t = Math.min(civ.building.dur, civ.building.t + civ.building.dur * 0.5);
      else gain(civ.res, { science: 200 });
      this.h.news('✶', `En una luna lejana, la expedición encuentra planos de una civilización desaparecida. Las obras avanzan más rápido.`, `On a distant moon, the expedition finds the plans of a vanished civilization. Great works speed up.`, 'good');
    } else {
      const s = this.h.s;
      if (civ.peace) civ.peace = false;
      s.invasion.next = Math.min(s.invasion.next || s.time + 40, s.time + 40);
      s.invasion.signal = 1;
      if (!s.alienSpecies) s.alienSpecies = { name: speciesName(rng), hue: rng.range(0.78, 0.95) };
      this.h.news('⚠', `La expedición regresa… seguida. Algo ha visto la luz de nuestros motores.`, `The expedition returns… followed. Something has seen the glow of our engines.`, 'alien');
    }
  }

  // ------------------------------------------------------------------ colonists to other stars
  /** Now and then, once warp travel exists, a group of colonists gathers and jumps to a new star. */
  private flotillas(civ: CivState) {
    const s = this.h.s;
    if (!civ.done.warp) return;
    if (civ.nextFlotilla === undefined) civ.nextFlotilla = s.time + 100;
    const f = civ.flotilla;
    if (f) {
      if (s.time > (civ.nextFlotilla ?? 0) - 160) this.flotillaJumps(civ);
      return;
    }
    if (s.time < civ.nextFlotilla) return;
    const rng = this.h.rng;
    civ.nextFlotilla = s.time + rng.range(240, 380);
    const home = this.home();
    const ports = this.settled();
    if (!home || !ports.length) return;
    const p = this.pos(home);
    const ang = Math.atan2(p.z, p.x) + rng.range(-0.8, 0.8);
    const R = Math.hypot(p.x, p.z) + 22;
    const x = Math.cos(ang) * R;
    const z = Math.sin(ang) * R;
    const n = Math.min(7, 3 + ports.length);
    for (let k = 0; k < n; k++) {
      const w = k < 2 ? home : rng.pick(ports);
      const q = this.pos(w);
      s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: -k * 0.8, dur: 6 + Math.hypot(q.x - x, q.z - z) * 0.18, alien: false, kind: 'flotilla', tx: x, tz: z });
    }
    civ.flotilla = { launched: n, gathered: 0, x, z, star: worldName(rng, new Set()) };
    const sn = s.species?.name ?? '';
    this.h.news('✶', `Una flotilla de colonos ${sn} se reúne para partir hacia la estrella ${civ.flotilla.star}.`, `A flotilla of ${capName(sn)} colonists gathers to leave for the star ${civ.flotilla.star}.`, 'info');
  }

  private flotillaJumps(civ: CivState) {
    const f = civ.flotilla;
    if (!f) return;
    const s = this.h.s;
    s.ships = s.ships.filter((x) => x.kind !== 'flotilla');
    const len = Math.hypot(f.x, f.z) || 1;
    this.h.fx({ kind: 'warpOut', x: f.x, z: f.z, dx: f.x / len, dz: f.z / len, count: f.launched, tint: 'own' });
    civ.stats.colonies++;
    civ.flotilla = null;
    const sn = s.species?.name ?? '';
    this.h.news('✶', `¡Salto! La flotilla llega a ${f.star}: los ${sn} ya habitan ${civ.stats.colonies + 1} sistemas.`, `Jump! The flotilla reaches ${f.star}: the ${capName(sn)} now live in ${civ.stats.colonies + 1} systems.`, 'good');
  }

  // ------------------------------------------------------------------ armada
  launchArmada() {
    const civ = this.civ;
    const home = this.home();
    const s = this.h.s;
    if (!civ || !home || this.missionLock('armada')) return false;
    pay(civ.res, MISSION_COST.armada);
    const hp = this.pos(home);
    const len = Math.hypot(hp.x, hp.z) || 1;
    const R = { x: hp.x + (hp.x / len) * 16, z: hp.z + (hp.z / len) * 16 };
    let launched = 0;
    for (const w of this.settled()) {
      const n = w === home ? 6 : isGiantStuff(w) ? 3 : 2;
      for (let i = 0; i < n && launched < 30; i++) {
        const p = this.pos(w);
        const d = Math.hypot(p.x - R.x, p.z - R.z);
        s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: -i * 0.6, dur: 5 + d * 0.16, alien: false, kind: 'armada', tx: R.x, tz: R.z });
        launched++;
      }
    }
    // A war at home comes first; then the invaders; otherwise, the unknown.
    const war = this.h.peoples.atWar();
    const vsAliens = !war && !!s.alienSpecies && !civ.peace;
    civ.armada = { phase: 'rally', t: 0, x: R.x, z: R.z, launched, gathered: 0, vsAliens, vsRival: war || undefined };
    civ.stats.armadas++;
    const sn = s.species?.name ?? '';
    this.h.news('⚔', `¡Convocatoria general! Las naves de los ${sn} se reúnen junto a ${home.name}.`, `General muster! The ships of the ${capName(sn)} gather by ${home.name}.`, 'good');
    return true;
  }

  private armada(civ: CivState, dt: number) {
    const a = civ.armada;
    if (!a) return;
    const s = this.h.s;
    a.t += dt;
    const len = Math.hypot(a.x, a.z) || 1;
    const dx = a.x / len;
    const dz = a.z / len;
    if (a.phase === 'rally' && (a.gathered >= a.launched || a.t > 60)) {
      a.phase = 'hold';
      a.t = 0;
      s.ships = s.ships.filter((x) => !(x.kind === 'armada' && !x.back));
      a.gathered = a.launched;
      this.h.news('⚔', 'La armada forma en el vacío. Los motores de curvatura se cargan…', 'The armada forms up in the void. The warp drives are charging…', 'info');
    } else if (a.phase === 'hold' && a.t > 9) {
      a.phase = 'away';
      a.t = 0;
      this.h.fx({ kind: 'warpOut', x: a.x, z: a.z, dx, dz, count: a.launched, tint: 'own' });
      const sn = s.species?.name ?? '';
      const foe = a.vsRival ? this.h.peoples.rival(a.vsRival) : undefined;
      if (foe) this.h.news('⚔', `¡Salto! La armada de los ${sn} cae sobre el mundo de los ${foe.name}.`, `Jump! The armada of the ${capName(sn)} falls upon the world of the ${capName(foe.name)}.`, 'good');
      else if (a.vsAliens && s.alienSpecies)
        this.h.news('⚔', `¡Salto! La armada de los ${sn} parte hacia la estrella de los ${s.alienSpecies.name}.`, `Jump! The armada of the ${capName(sn)} heads for the star of the ${capName(s.alienSpecies.name)}.`, 'good');
      else this.h.news('⚔', `¡Salto! La armada de los ${sn} se pierde entre las estrellas, rumbo a lo desconocido.`, `Jump! The armada of the ${capName(sn)} vanishes among the stars, bound for the unknown.`, 'good');
    } else if (a.phase === 'away' && a.vsRival && a.t > 3) {
      // Out of warp right over the enemy's home world.
      const home = this.h.peoples.home(a.vsRival);
      if (!home) {
        civ.armada = null;
        return;
      }
      const p = this.pos(home);
      const l2 = Math.hypot(p.x, p.z) || 1;
      a.x = p.x + (p.x / l2) * 5;
      a.z = p.z + (p.z / l2) * 5;
      a.phase = 'battle';
      a.t = 0;
      this.h.fx({ kind: 'warpIn', x: a.x, z: a.z, dx: -p.x / l2, dz: -p.z / l2, count: a.launched, tint: 'own' });
    } else if (a.phase === 'battle') {
      const home = a.vsRival ? this.h.peoples.home(a.vsRival) : undefined;
      if (home && Math.floor((a.t - dt) / 0.7) !== Math.floor(a.t / 0.7)) this.h.fx({ kind: 'siege', world: home.id });
      if (a.t > 10) {
        if (a.vsRival) this.h.peoples.armadaVictory(a.vsRival);
        civ.stats.battles += 10;
        gain(civ.res, { metal: 150, science: 100 });
        const ports = this.settled();
        for (let i = 0; i < a.launched && ports.length; i++) {
          const w = ports[i % ports.length];
          s.ships.push({ id: this.h.nid(), from: -4, to: w.id, t: -i * 0.25, dur: this.h.rng.range(6, 11), alien: false, kind: 'armada', sx: a.x, sz: a.z, back: true });
        }
        civ.armada = null;
      }
    } else if (a.phase === 'away' && !a.vsRival && a.t > 70) {
      this.h.fx({ kind: 'warpIn', x: a.x, z: a.z, dx: -dx, dz: -dz, count: a.launched, tint: 'own' });
      const sn = s.species?.name ?? '';
      if (a.vsAliens && s.alienSpecies) {
        civ.peace = true;
        civ.stats.battles += 12;
        s.invasion.next = s.time + 1500;
        s.ships = s.ships.filter((x) => !x.alien);
        for (const w of s.worlds) w.invaded *= 0.15;
        gain(civ.res, { science: 180, metal: 120 });
        this.h.news('⚔', `La armada vuelve victoriosa: los ${s.alienSpecies.name} firman la paz y abandonan tu sistema.`, `The armada returns victorious: the ${capName(s.alienSpecies.name)} sign a peace and leave your system.`, 'good');
      } else {
        const name = speciesName(this.h.rng);
        civ.allies.push(name);
        civ.stats.colonies += 2;
        gain(civ.res, { science: 220, fuel: 120 });
        this.h.news('⚔', `La armada regresa de un viaje de mil años: trae dos colonias nuevas y la amistad de los ${name}.`, `The armada returns from a thousand-year voyage: it brings two new colonies and the friendship of the ${capName(name)}.`, 'good');
      }
      // Back to every port.
      const ports = this.settled();
      for (let i = 0; i < a.launched && ports.length; i++) {
        const w = ports[i % ports.length];
        s.ships.push({ id: this.h.nid(), from: -4, to: w.id, t: -i * 0.25, dur: this.h.rng.range(6, 11), alien: false, kind: 'armada', sx: a.x, sz: a.z, back: true });
      }
      civ.armada = null;
    }
  }

  // ------------------------------------------------------------------ defence
  private defend(civ: CivState, dt: number) {
    const s = this.h.s;
    if (!civ.done.fleet) return;
    // Your worlds and those of your allies shoot at intruders.
    const guards = [...this.settled(), ...s.worlds.filter((w) => this.h.peoples.allied(w))];
    if (!guards.length) return;
    for (const sh of [...s.ships]) {
      if (!sh.alien) continue;
      if (sh.doom !== undefined) {
        sh.doom -= dt;
        if (sh.doom > 0) continue;
        if (sh.kind === 'mother' && (sh.hp ?? 1) > 1) {
          sh.hp = (sh.hp ?? 3) - 1;
          sh.doom = undefined;
          this.h.fx({ kind: 'boom', ship: sh.id, big: false });
          continue;
        }
        this.h.fx({ kind: 'boom', ship: sh.id, big: sh.kind === 'mother' });
        s.ships.splice(s.ships.indexOf(sh), 1);
        civ.stats.battles++;
        if (civ.stats.battles === 1 || civ.stats.battles % 6 === 0) {
          const al = s.alienSpecies?.name ?? '';
          this.h.news('⟁', `La flota de defensa intercepta a los ${al}. Ya van ${civ.stats.battles} naves derribadas.`, `The defence fleet intercepts the ${capName(al)}. ${civ.stats.battles} ships brought down so far.`, 'good');
        }
        continue;
      }
      const k = sh.t / sh.dur;
      if (k > 0.3 && k < 0.92 && this.h.rng.next() < dt * 0.7) {
        sh.doom = 1.1;
        const shooter = this.h.rng.pick(guards);
        this.h.fx({ kind: 'laser', ship: sh.id, world: shooter.id });
      }
    }
    for (const w of s.worlds) if (w.invaded > 0) w.invaded = Math.max(0, w.invaded - dt * 0.004);
  }

  /** Called by the system when an asteroid is about to hit: shields stop it. */
  shieldStops(w: World, threatId: number) {
    const civ = this.civ;
    if (!civ?.done.shield || !isSettled(w)) return false;
    if (threatId >= 0) this.h.fx({ kind: 'shieldHit', world: w.id, threat: threatId });
    this.h.news('⛨', `El escudo de ${w.name} pulveriza un asteroide antes de que toque la atmósfera.`, `The shield of ${w.name} shatters an asteroid before it touches the atmosphere.`, 'good');
    return true;
  }

  // ------------------------------------------------------------------ decisions
  decide(id: number, accept: boolean) {
    const civ = this.civ;
    const s = this.h.s;
    if (!civ) return;
    const d = civ.decisions.find((x) => x.id === id);
    if (!d) return;
    civ.decisions.splice(civ.decisions.indexOf(d), 1);
    const rng = this.h.rng;
    const sn = s.species?.name ?? '';
    if (d.kind === 'trade') {
      const w = d.world !== undefined ? this.h.world(d.world) : null;
      if (accept && d.give && has(civ.res, d.give)) {
        pay(civ.res, d.give);
        gain(civ.res, d.get ?? {});
        civ.stats.trades++;
        const tn = d.species ?? '';
        this.h.news('⚖', `Trato cerrado con los mercaderes ${tn}. Dicen que volverán.`, `Deal struck with the ${capName(tn)} traders. They say they will be back.`, 'good');
        if (d.species && !civ.allies.includes(d.species)) civ.allies.push(d.species);
      }
      this.tradersLeave(w);
    } else if (d.kind === 'refugees') {
      const w = d.world !== undefined ? this.h.world(d.world) : null;
      const name = d.species ?? speciesName(rng);
      if (accept && w) {
        const a = rng.range(0, TAU);
        s.ships.push({ id: this.h.nid(), from: -5, to: w.id, t: 0, dur: 14, alien: false, kind: 'refugee', sx: Math.cos(a) * 110, sz: Math.sin(a) * 110, species: name });
        this.h.news('⌂', `Los ${sn} ofrecen ${w.name} a los ${name}. Su nave ya se acerca.`, `The ${capName(sn)} offer ${w.name} to the ${capName(name)}. Their ship is already approaching.`, 'good');
      } else this.h.news('⌂', `Los ${name} siguen su viaje en busca de otro hogar.`, `The ${capName(name)} continue their journey in search of another home.`, 'info');
    } else if (d.kind === 'signal') {
      if (accept && has(civ.res, { fuel: 60 })) {
        pay(civ.res, { fuel: 60 });
        const home = this.home();
        if (home) {
          const p = this.pos(home);
          const len = Math.hypot(p.x, p.z) || 1;
          const x = (p.x / len) * (len + 26);
          const z = (p.z / len) * (len + 26);
          this.h.fx({ kind: 'warpOut', x, z, dx: p.x / len, dz: p.z / len, count: 3, tint: 'own' });
          civ.missions.push({ id: this.h.nid(), kind: 'signal', t: 0, dur: 45, x, z });
        }
        this.h.news('✶', `Una flotilla de socorro salta hacia la estrella que pidió ayuda.`, `A relief flotilla jumps towards the star that called for help.`, 'info');
      }
    } else if (d.kind === 'artifact') {
      if (accept && has(civ.res, { science: 40 })) {
        pay(civ.res, { science: 40 });
        civ.missions.push({ id: this.h.nid(), kind: 'artifact', t: 0, dur: 40, x: 0, z: 0 });
        this.h.news('◬', `Los sabios de los ${sn} empiezan a estudiar el artefacto.`, `The scholars of the ${capName(sn)} begin to study the artefact.`, 'info');
      } else this.h.news('◬', `El artefacto queda sellado bajo el hielo. Quizá sea mejor así.`, `The artefact stays sealed under the ice. Perhaps it is better that way.`, 'info');
    } else if (d.kind === 'rogue') {
      const r = civ.rogue;
      if (accept && r && has(civ.res, { fuel: 100, metal: 50 })) {
        pay(civ.res, { fuel: 100, metal: 50 });
        this.captureRogue(civ);
      }
    }
  }

  private tradersLeave(w: World | null | undefined) {
    const s = this.h.s;
    if (!w) return;
    const a = this.h.rng.range(0, TAU);
    s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: 0, dur: 13, alien: false, kind: 'trader', tx: Math.cos(a) * 125, tz: Math.sin(a) * 125 });
  }

  private decisions(civ: CivState, dt: number) {
    for (const d of [...civ.decisions]) {
      d.left -= dt;
      if (d.left <= 0) this.decide(d.id, false);
    }
  }

  private offer(d: Omit<Decision, 'id' | 'left' | 'dur'>, dur = 45) {
    const civ = this.civ!;
    civ.decisions.push({ ...d, id: this.h.nid(), left: dur, dur });
  }

  private artifactResult(civ: CivState) {
    const rng = this.h.rng;
    const s = this.h.s;
    const r = rng.next();
    if (r < 0.55) {
      if (civ.building) civ.building.t = civ.building.dur;
      else gain(civ.res, { science: 260 });
      this.h.news('◬', 'El artefacto era un mapa de rutas entre estrellas. Lo que parecía imposible, hoy es un plano.', 'The artefact was a map of routes between stars. What seemed impossible is now a blueprint.', 'good');
    } else if (r < 0.8) {
      gain(civ.res, { science: 160, water: 80 });
      this.h.news('◬', 'Es un archivo de una especie extinta: poemas, mapas y una advertencia que nadie entiende todavía.', 'It is the archive of an extinct species: poems, maps and a warning nobody understands yet.', 'good');
    } else {
      civ.peace = false;
      s.invasion.signal = 1;
      s.invasion.next = s.time + 25;
      if (!s.alienSpecies) s.alienSpecies = { name: speciesName(rng), hue: rng.range(0.78, 0.95) };
      this.h.news('◬', 'El artefacto era una baliza. Al despertarla, algo respondió desde la oscuridad.', 'The artefact was a beacon. When it woke, something answered from the dark.', 'alien');
    }
  }

  private signalResult(civ: CivState) {
    const name = speciesName(this.h.rng);
    civ.allies.push(name);
    gain(civ.res, { science: 150, metal: 80 });
    this.h.news('✶', `La flotilla salva a los ${name} de una estrella moribunda. En agradecimiento, comparten su ciencia.`, `The flotilla saves the ${capName(name)} from a dying star. In gratitude, they share their science.`, 'good');
  }

  // ------------------------------------------------------------------ the wandering planet
  roguePos() {
    const r = this.civ?.rogue;
    if (!r) return null;
    const k = r.t / r.dur;
    const d = toWorld(9) + r.off;
    const along = (k - 0.5) * 260;
    const nx = Math.cos(r.ang);
    const nz = Math.sin(r.ang);
    return { x: nx * d - nz * along, z: nz * d + nx * along };
  }

  private rogue(civ: CivState, dt: number) {
    const r = civ.rogue;
    if (!r) return;
    r.t += dt;
    if (!r.offered && r.t > r.dur * 0.3) {
      r.offered = true;
      if (civ.done.fleet || civ.done.warp)
        this.offer({ kind: 'rogue' }, Math.max(10, r.dur * 0.35));
    }
    if (r.t >= r.dur) {
      civ.rogue = null;
      const s = this.h.s;
      const living = s.worlds.filter((w) => w.life || w.colony >= 1);
      if (living.length) {
        const w = this.h.rng.pick(living);
        w.climate -= 12;
        this.h.news('●', `El planeta errante se aleja. Su paso sacudió las mareas de ${w.name}, que se enfría un poco.`, `The wandering planet moves away. Its passage stirred the tides of ${w.name}, which cools a little.`, 'info');
      } else this.h.news('●', 'El planeta errante se pierde de nuevo en la oscuridad.', 'The wandering planet disappears into the dark again.', 'info');
    }
  }

  private captureRogue(civ: CivState) {
    const p = this.roguePos();
    const r = civ.rogue;
    if (!p || !r) return;
    const s = this.h.s;
    const rng = new Rng(r.seed);
    const used = new Set(s.worlds.map((w) => w.name));
    const dist = Math.hypot(p.x, p.z);
    const a = clamp(toAU(dist), 7, 15);
    const w: World = {
      id: this.h.nid(),
      name: worldName(rng, used),
      seed: r.seed,
      a,
      th: Math.atan2(p.z, p.x),
      parent: null,
      metal: 0.25,
      rock: 0.6,
      water: 0.35,
      gas: 0.02,
      org: 0.03,
      atm: 0.05,
      ocean: 0.1,
      organics: 0.2,
      mag: 0.3,
      climate: 0,
      life: null,
      spark: 0,
      colony: 0,
      terra: 0,
      invaded: 0,
      sats: 0,
      ring: false,
      volcanoCd: 0,
    };
    s.worlds.push(w);
    civ.rogue = null;
    this.h.fx({ kind: 'rogueCaught', world: w.id });
    this.h.news('●', `¡La flota frena al planeta errante! ${w.name} se une al sistema en una órbita lejana.`, `The fleet slows the wandering planet! ${w.name} joins the system in a distant orbit.`, 'good');
  }

  // ------------------------------------------------------------------ visitors & events
  private events(civ: CivState, dt: number) {
    void dt;
    const s = this.h.s;
    if (!this.spacefaring || s.time < civ.nextLate) return;
    const rng = this.h.rng;
    civ.nextLate = s.time + rng.range(55, 95);
    const settled = this.settled();
    if (!settled.length) return;
    // Only worlds nobody has claimed: not yours, not your neighbours'.
    const open = s.worlds.filter((w) => colonizable(w) && w.colony <= 0 && !w.guest && !w.life && w.invaded < 0.3);
    const pool: [string, number][] = [
      ['trade', 1.8 + Math.min(1.5, civ.allies.length * 0.25)],
      ['refugees', open.length ? 1.3 : 0],
      ['signal', civ.done.warp ? 1 : 0],
      ['artifact', !civ.artifactFound ? 0.9 : 0],
      ['rogue', civ.rogue ? 0 : 0.9],
      ['supernova', 0.5],
      ['superflare', 0.7],
    ];
    let total = 0;
    for (const [, w] of pool) total += w;
    let roll = rng.next() * total;
    let pick = 'trade';
    for (const [k, w] of pool) {
      roll -= w;
      if (roll <= 0) {
        pick = k;
        break;
      }
    }
    if (civ.decisions.length >= 2 && ['trade', 'refugees', 'signal', 'artifact'].includes(pick)) pick = 'superflare';
    const sn = s.species?.name ?? '';
    if (pick === 'trade') {
      const w = rng.pick(settled);
      const name = civ.allies.length && rng.next() < 0.6 ? rng.pick(civ.allies) : speciesName(rng);
      const keys = [...RES_KEYS].sort((a, b) => civ.res[b] - civ.res[a]);
      const giveK = keys[0];
      const getK = rng.pick(keys.slice(1));
      const give = Math.max(20, Math.round(Math.min(civ.res[giveK] * 0.4, rng.range(40, 90))));
      const get = Math.round(give * rng.range(1.3, 1.8));
      const a = rng.range(0, TAU);
      s.ships.push({ id: this.h.nid(), from: -6, to: w.id, t: 0, dur: 14, alien: false, kind: 'trader', sx: Math.cos(a) * 125, sz: Math.sin(a) * 125 });
      this.offer({ kind: 'trade', world: w.id, give: { [giveK]: give }, get: { [getK]: get }, species: name });
      this.h.news('⚖', `Una caravana de los ${name} se acerca a ${w.name} con ganas de comerciar.`, `A caravan of the ${capName(name)} approaches ${w.name}, eager to trade.`, 'info');
    } else if (pick === 'refugees') {
      const w = rng.pick(open);
      this.offer({ kind: 'refugees', world: w.id, species: speciesName(rng) });
    } else if (pick === 'signal') {
      this.offer({ kind: 'signal' });
    } else if (pick === 'artifact') {
      civ.artifactFound = true;
      const w = rng.pick(settled);
      this.offer({ kind: 'artifact', world: w.id });
    } else if (pick === 'rogue') {
      civ.rogue = { t: 0, dur: 75, seed: (rng.next() * 1e9) | 0, ang: rng.range(0, TAU), off: rng.range(-6, 10), offered: false };
      this.h.news('●', 'Un planeta errante, sin estrella, cruza los confines del sistema.', 'A wandering planet, with no star of its own, crosses the edge of the system.', 'warn');
    } else if (pick === 'supernova') {
      this.h.fx({ kind: 'supernova' });
      if (civ.done.shield) this.h.news('✺', 'Una supernova estalla a pocos años luz. Los escudos resisten su radiación.', 'A supernova bursts a few light years away. The shields withstand its radiation.', 'info');
      else {
        for (const w of s.worlds) {
          if (w.life) w.life.health -= 0.12;
          w.sats = Math.floor(w.sats * 0.6);
        }
        this.h.news('✺', 'Una supernova estalla a pocos años luz: su radiación castiga la vida y los satélites.', 'A supernova bursts a few light years away: its radiation batters life and satellites.', 'warn');
      }
    } else if (pick === 'superflare') {
      this.h.fx({ kind: 'superflare' });
      s.energy = Math.min(this.energyCap, s.energy + 40);
      if (civ.done.shield) this.h.news('☀', 'La estrella lanza una superllamarada. Los escudos la desvían y su luz llena tus reservas.', 'The star throws a superflare. The shields deflect it and its light fills your stores.', 'info');
      else {
        for (const w of s.worlds) w.sats = Math.floor(w.sats * 0.5);
        this.h.news('☀', `Una superllamarada de la estrella deja sin satélites a medio sistema. Los ${sn} vuelven a empezar.`, `A superflare from the star knocks out half the satellites in the system. The ${capName(sn)} start again.`, 'warn');
      }
    }
  }

  get energyCap() {
    return this.civ?.done.dyson ? 200 : 100;
  }

  private flavor(civ: CivState) {
    const s = this.h.s;
    if (!s.species || s.time < civ.nextFlavor) return;
    const rng = this.h.rng;
    civ.nextFlavor = s.time + rng.range(38, 65);
    const settled = this.settled();
    if (!settled.length) return;
    const giants = s.worlds.filter((w) => isGiantStuff(w));
    const moons = s.worlds.filter((w) => w.parent !== null && massOf(w) > 0.001);
    const ok = FLAVOR.filter((f) => (f.needs ?? []).every((n) => (n === 'g' ? giants.length : n === 'm' ? moons.length : settled.length > 1)));
    const f = rng.pick(ok);
    const w = rng.pick(settled);
    const v = rng.pick(settled.filter((x) => x !== w).length ? settled.filter((x) => x !== w) : settled);
    const g = giants.length ? rng.pick(giants) : w;
    const m = moons.length ? rng.pick(moons) : w;
    const fill = (t: string, name: string) => t.replaceAll('{w}', w.name).replaceAll('{v}', v.name).replaceAll('{g}', g.name).replaceAll('{m}', m.name).replaceAll('{s}', name);
    this.h.news('❧', fill(f.es, s.species.name), fill(f.en, capName(s.species.name)), 'info');
  }
}
