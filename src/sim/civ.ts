import { massOf, toAU, toWorld, type CivState, type Decision, type GameState, type Resources, type Ship, type World } from '../core/state';
import { Rng, TAU, clamp } from '../util';
import { colonizable, isGiantStuff, type WorldStats } from './worlds';
import { worldXZ } from '../render/layout';
import { MISSION_COST, PROJECTS, TECHS, researchCost, type ProjectId } from '../content/projects';
import { FLAVOR } from '../content/flavor';
import { capName, speciesName, worldName, invaderName, invaderNames } from '../content/names';
import type { Bi } from '../i18n';
import type { PeopleSim, PeopleFx } from './peoples';
import { addHarm } from './voices';
import { DEFENCES, MAX_LEVEL, defLevel, fleetCatch, levelFor, powerOf, shieldStop, threatOf, upgradeCost, type DefenceId } from './threat';

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

/** A world where some people lives: a colony, refugees taken in, or a people's home with cities. */
export const isSettled = (w: World) => (w.colony >= 1 && !!w.owner) || !!w.guest || (!!w.life?.people && w.life.stage >= 3);

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
  /** A people settles around another star (direction `ang` on the sky). */
  foundStar(name: string, people: number, ang: number): void;
}

export type CivFx =
  | { kind: 'laser'; ship: number; world: number }
  | { kind: 'boom'; ship: number; big: boolean }
  | { kind: 'shieldHit'; world: number; threat: number }
  | { kind: 'warpOut'; x: number; z: number; dx: number; dz: number; count: number; tint: 'own' | 'alien' | 'patrol'; people?: number }
  | { kind: 'warpIn'; x: number; z: number; dx: number; dz: number; count: number; tint: 'own' | 'alien' | 'patrol'; people?: number }
  | { kind: 'supernova' }
  | { kind: 'superflare' }
  | { kind: 'built'; id: ProjectId; world: number }
  | { kind: 'rogueCaught'; world: number };

const has = (r: Resources, c: Partial<Resources>) => RES_KEYS.every((k) => r[k] >= (c[k] ?? 0));
const pay = (r: Resources, c: Partial<Resources>) => RES_KEYS.forEach((k) => (r[k] -= c[k] ?? 0));
const gain = (r: Resources, c: Partial<Resources>) => RES_KEYS.forEach((k) => (r[k] += c[k] ?? 0));

/**
 * The late game: once the peoples of the system build cities, an economy appears. Each settled world
 * contributes according to what it is (giants give fuel, icy worlds water, rocky worlds metal,
 * living worlds science), which pays for great works, expeditions and armadas — while traders,
 * refugees, wandering planets and invaders keep visiting. The player inspires; the peoples build.
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
  get state() {
    return this.h.s;
  }

  /** Is the civilization old enough for great works? */
  get spacefaring() {
    const s = this.h.s;
    const L = this.h.peoples.leader();
    return !!L && (this.h.peoples.stage(L) >= 4 || s.worlds.some((w) => w.colony >= 1));
  }

  home(): World | null {
    return this.h.origin ?? this.h.s.worlds.find((w) => w.colony >= 1) ?? null;
  }

  /** Name of the people that leads the way (lower case: Spanish style, capitalised in English texts). */
  leaderName() {
    return this.h.peoples.leader()?.name ?? '';
  }

  /** Id of the people living on a world (0: nobody). */
  private ownerOf(w: World) {
    if (w.owner && w.colony > 0) return w.owner;
    return w.life?.people ?? 0;
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
      if (this.h.peoples.alive().length && (this.h.topStage >= 3 || s.worlds.some((w) => w.colony >= 1))) s.civ = newCiv(s.time);
      else return;
    }
    const civ = s.civ!;
    this.threat();
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

  // ------------------------------------------------------------------ threat & defences
  /** The system's power sets how dangerous the galaxy becomes for it. */
  private threat() {
    const s = this.h.s;
    const power = powerOf(s, this.settled().length);
    const t = (s.threat ??= { level: levelFor(power), power });
    t.power = power;
    const want = levelFor(power);
    // It rises at once, and only falls back once the power has clearly shrunk.
    if (want > t.level) {
      t.level = want;
      const behind = DEFENCES.some((id) => defLevel(s, id) > 0 && defLevel(s, id) < want);
      this.h.news(
        '⚠',
        `Tu sistema brilla cada vez más y se ve desde lejos: la amenaza sube a nivel ${want}. Las invasiones llegarán antes y con más naves.${behind ? ' Conviene reforzar las defensas en Proyectos.' : ''}`,
        `Your system shines ever brighter and can be seen from afar: the threat rises to level ${want}. Invasions will come sooner and with more ships.${behind ? ' Your defences should be raised in Projects.' : ''}`,
        'alien',
      );
    } else if (levelFor(power + 3) < t.level) t.level = levelFor(power + 3);
  }

  /** Why a defence cannot be raised right now (null: it can). */
  defenceLock(id: DefenceId): Bi | null {
    const civ = this.civ;
    const s = this.h.s;
    if (!civ) return { es: 'Primero, una civilización.', en: 'First, a civilization.' };
    const lvl = defLevel(s, id);
    if (!lvl)
      return id === 'fleet'
        ? { es: 'Necesita la gran obra «Flota de defensa».', en: 'Needs the great work “Defence fleet”.' }
        : id === 'shield'
          ? { es: 'Necesita la gran obra «Escudo planetario».', en: 'Needs the great work “Planetary shield”.' }
          : { es: 'Aún no existen: los pueblos los fundan cuando los invasores dominan varios mundos.', en: 'They do not exist yet: the peoples found them when invaders hold several worlds.' };
    if (lvl >= MAX_LEVEL) return { es: 'Nivel máximo.', en: 'Maximum level.' };
    if (!has(civ.res, upgradeCost(id, lvl))) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  /** Raises a defence one level. */
  upgrade(id: DefenceId) {
    const civ = this.civ;
    const s = this.h.s;
    if (!civ || this.defenceLock(id)) return false;
    const lvl = defLevel(s, id);
    pay(civ.res, upgradeCost(id, lvl));
    const n = lvl + 1;
    (civ.def ??= {})[id] = n;
    const lines: Record<DefenceId, Bi> = {
      fleet: { es: `La flota de defensa crece hasta el nivel ${n}: más guardianes vigilan cada mundo habitado.`, en: `The defence fleet grows to level ${n}: more guardians watch over every settled world.` },
      shield: { es: `Los escudos planetarios se refuerzan hasta el nivel ${n}.`, en: `The planetary shields are reinforced to level ${n}.` },
      patrol: { es: `Una nueva compañía jura ante la estrella: los Space Patrols ya son ${n} compañías.`, en: `A new company takes its oath before the star: the Space Patrols now number ${n} companies.` },
    };
    this.h.news(id === 'fleet' ? '⟁' : '⛨', lines[id].es, lines[id].en, 'good');
    return true;
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
      if (w.life?.people && w.life.stage >= 3) r.science += 0.6;
    }
    if (civ.done.mining && this.h.s.belts.length) r.metal += 0.6;
    if (civ.done.ring) r.science *= 1.5;
    // Allied peoples share their science.
    r.science *= 1 + 0.1 * (this.h.s.relations ?? []).filter((x) => x.state === 'alliance').length;
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
    if (id === 'ark' && !s.worlds.filter(colonizable).every((w) => isSettled(w)))
      return { es: 'Todos los mundos deben estar habitados por algún pueblo.', en: 'Every world must be home to some people.' };
    if (id === 'ark' && this.h.peoples.wars().length) return { es: 'No puede partir con el sistema en guerra.', en: 'It cannot leave while the system is at war.' };
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
    const sn = this.leaderName();
    this.h.news(def.icon, `Inspirados por la estrella, los ${sn} comienzan una gran obra: ${def.name.es.toLowerCase()}.`, `Inspired by the star, the ${capName(sn)} begin a great work: ${def.name.en.toLowerCase()}.`, 'info');
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
    const sn = this.leaderName();
    const lines: Record<ProjectId, Bi> = {
      elevator: { es: `Se inaugura el ascensor espacial de ${home?.name}: el cielo ya está a un viaje en tranvía.`, en: `The space elevator of ${home?.name} opens: the sky is now a tram ride away.` },
      mining: { es: `Los primeros mineros llegan a los cinturones de asteroides.`, en: `The first miners reach the asteroid belts.` },
      refinery: { es: `Las refinerías flotan en las nubes de los gigantes: el combustible empieza a fluir.`, en: `Refineries float in the giants’ clouds: fuel starts to flow.` },
      shield: { es: `Se encienden los escudos planetarios. Ninguna roca volverá a caer sobre una colonia.`, en: `The planetary shields come online. No rock will ever fall on a colony again.` },
      fleet: { es: `Entra en servicio una flota de guardianes: vigilará el sistema contra los invasores, sea cual sea el pueblo.`, en: `A fleet of guardians enters service: it will watch the system against invaders, whatever the people.` },
      ring: { es: `El anillo orbital rodea ${home?.name}: brilla de noche como una corona.`, en: `The orbital ring circles ${home?.name}: it shines at night like a crown.` },
      warp: { es: `¡Primer salto de curvatura! Las estrellas vecinas están a semanas de distancia.`, en: `First warp jump! The neighbouring stars are only weeks away.` },
      dyson: { es: `El enjambre de Dyson envuelve la estrella. Su luz ya es nuestra.`, en: `The Dyson swarm wraps the star. Its light is now ours.` },
      armada: { es: `Los astilleros de todos los pueblos entregan la armada interestelar. Espera una señal de la estrella.`, en: `The shipyards of every people deliver the interstellar armada. It awaits a sign from the star.` },
      ark: { es: `El arca estelar está lista. Los pueblos del sistema se despiden de su estrella.`, en: `The star ark is ready. The peoples of the system say farewell to their star.` },
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
    const sn = this.leaderName();
    this.h.news('⚗', `Los pueblos del sistema dominan una nueva tecnología: ${es}. Todos producen un poco más.`, `The peoples of the system master a new technology: ${en}. Everyone produces a little more.`, 'good');
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
        // Each people's freighters run between its own worlds (and those of its allies).
        const people = this.ownerOf(w);
        const partners = settled.filter((o) => {
          if (o === w) return false;
          const op = this.ownerOf(o);
          if (op === people) return true;
          const rel = people && op ? this.h.peoples.relation(people, op) : undefined;
          return rel?.state === 'alliance';
        });
        if (this.shipCount() < 40 && partners.length) {
          const same = partners.filter((o) => this.ownerOf(o) === people);
          const to = same.length && rng.next() < 0.75 ? rng.pick(same) : rng.pick(partners);
          const role = roleOf(w, this.h.stats(w));
          const a = this.pos(w);
          const b = this.pos(to);
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          s.ships.push({ id: this.h.nid(), from: w.id, to: to.id, t: 0, dur: 6 + d * 0.22, alien: false, kind: role === 'fuel' ? 'tanker' : 'freight', people: people || undefined });
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
          if (best >= 0 && bd < 30) s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: 0, dur: 6 + bd * 0.2, alien: false, kind: 'miner', belt: best, people: this.ownerOf(w) || undefined });
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
      s.ships.push({ id: this.h.nid(), from: -2, to: sh.from, t: 0, dur: sh.dur, alien: false, kind: 'miner', belt: sh.belt, back: true, people: sh.people });
    }
    if (k === 'expedition' && civ) {
      if (!sh.back) {
        const dx = sh.tx ?? 0;
        const dz = sh.tz ?? 0;
        const len = Math.hypot(dx, dz) || 1;
        this.h.fx({ kind: 'warpOut', x: dx, z: dz, dx: dx / len, dz: dz / len, count: 1, tint: 'own', people: sh.people });
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
        // Refugees become one more people of the system (or guests, if there is no room).
        if (!(w.colony > 0) && !this.h.peoples.newcomers(name, null, w)) w.guest = name;
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
    this.h.s.ships.push({ id: this.h.nid(), from: home.id, to: -1, t: 0, dur: 7, alien: false, kind: 'expedition', tx: Math.cos(ang) * R, tz: Math.sin(ang) * R, people: this.ownerOf(home) || undefined });
    civ.stats.expeditions++;
    const sn = this.leaderName();
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
      this.h.fx({ kind: 'warpIn', x: m.x, z: m.z, dx: -m.x / len, dz: -m.z / len, count: 1, tint: 'own', people: home ? this.ownerOf(home) || undefined : undefined });
      if (m.kind === 'signal') {
        this.signalResult(civ);
        continue;
      }
      if (home) this.h.s.ships.push({ id: this.h.nid(), from: -3, to: home.id, t: 0, dur: 7, alien: false, kind: 'expedition', sx: m.x, sz: m.z, back: true, people: this.ownerOf(home) || undefined });
    }
  }

  private expeditionReturns(civ: CivState) {
    const rng = this.h.rng;
    const sn = this.leaderName();
    const S = capName(sn);
    // The stronger the system, the likelier someone follows the expedition home.
    const roll = rng.next() < 0.03 * (threatOf(this.h.s) - 1) ? 1 : rng.next();
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
      this.h.foundStar(star, this.h.peoples.leader()?.id ?? 0, rng.range(0, TAU));
      this.h.news('✶', `Los ${sn} fundan una colonia junto a la estrella ${star}. La vida de este sistema ya alcanza ${civ.stats.colonies + 1} estrellas.`, `The ${S} found a colony by the star ${star}. Life from this system now reaches ${civ.stats.colonies + 1} stars.`, 'good');
    } else if (roll < 0.92) {
      if (civ.building) civ.building.t = Math.min(civ.building.dur, civ.building.t + civ.building.dur * 0.5);
      else gain(civ.res, { science: 200 });
      this.h.news('✶', `En una luna lejana, la expedición encuentra planos de una civilización desaparecida. Las obras avanzan más rápido.`, `On a distant moon, the expedition finds the plans of a vanished civilization. Great works speed up.`, 'good');
    } else {
      const s = this.h.s;
      if (civ.peace) civ.peace = false;
      s.invasion.next = Math.min(s.invasion.next || s.time + 40, s.time + 40);
      s.invasion.signal = 1;
      if (!s.alienSpecies) s.alienSpecies = { ...invaderName(rng), hue: rng.range(0.78, 0.95) };
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
    // One of the spacefaring peoples sends colonists to a new star.
    const peoples = this.h.peoples.alive().filter((p) => this.h.peoples.stage(p) >= 4 && this.h.peoples.worldsOf(p).length);
    if (!peoples.length) return;
    const who = rng.pick(peoples);
    const ports = this.h.peoples.worldsOf(who);
    const home = this.h.peoples.home(who) ?? ports[0];
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
      s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: -k * 0.8, dur: 6 + Math.hypot(q.x - x, q.z - z) * 0.18, alien: false, kind: 'flotilla', tx: x, tz: z, people: who.id });
    }
    civ.flotilla = { launched: n, gathered: 0, x, z, star: worldName(rng, new Set()), people: who.id };
    const sn = who.name;
    this.h.news('✶', `Una flotilla de colonos ${sn} se reúne para partir hacia la estrella ${civ.flotilla.star}.`, `A flotilla of ${capName(sn)} colonists gathers to leave for the star ${civ.flotilla.star}.`, 'info');
  }

  private flotillaJumps(civ: CivState) {
    const f = civ.flotilla;
    if (!f) return;
    const s = this.h.s;
    s.ships = s.ships.filter((x) => x.kind !== 'flotilla');
    const len = Math.hypot(f.x, f.z) || 1;
    this.h.fx({ kind: 'warpOut', x: f.x, z: f.z, dx: f.x / len, dz: f.z / len, count: f.launched, tint: 'own', people: f.people });
    civ.stats.colonies++;
    civ.flotilla = null;
    this.h.foundStar(f.star, f.people ?? this.h.peoples.leader()?.id ?? 0, Math.atan2(f.z, f.x));
    const sn = this.h.peoples.get(f.people)?.name ?? this.leaderName();
    this.h.news('✶', `¡Salto! La flotilla de los ${sn} llega a ${f.star}. La vida de este sistema ya alcanza ${civ.stats.colonies + 1} estrellas.`, `Jump! The flotilla of the ${capName(sn)} reaches ${f.star}. Life from this system now reaches ${civ.stats.colonies + 1} stars.`, 'good');
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
    // Every people sends ships: the armada flies many colours.
    const crew: number[] = [];
    for (const w of this.settled()) {
      const n = w === home ? 6 : isGiantStuff(w) ? 3 : 2;
      const people = this.ownerOf(w) || undefined;
      for (let i = 0; i < n && launched < 30; i++) {
        const p = this.pos(w);
        const d = Math.hypot(p.x - R.x, p.z - R.z);
        s.ships.push({ id: this.h.nid(), from: w.id, to: -1, t: -i * 0.6, dur: 5 + d * 0.16, alien: false, kind: 'armada', tx: R.x, tz: R.z, people });
        crew.push(people ?? 0);
        launched++;
      }
    }
    // Against the invaders if there are any; otherwise, into the unknown.
    const vsAliens = !!s.alienSpecies && !civ.peace;
    civ.armada = { phase: 'rally', t: 0, x: R.x, z: R.z, launched, gathered: 0, vsAliens, crew };
    civ.stats.armadas++;
    const sn = this.leaderName();
    this.h.news('⚔', `¡Convocatoria general! Naves de todos los pueblos se reúnen junto a ${home.name}.`, `General muster! Ships of every people gather by ${home.name}.`, 'good');
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
      const sn = this.leaderName();
      if (a.vsAliens && s.alienSpecies)
        this.h.news('⚔', `¡Salto! La armada de los pueblos parte hacia la estrella de los ${invaderNames(s.alienSpecies)[0]}.`, `Jump! The armada of the peoples heads for the star of the ${invaderNames(s.alienSpecies)[1]}.`, 'good');
      else this.h.news('⚔', `¡Salto! La armada de los pueblos se pierde entre las estrellas, rumbo a lo desconocido.`, `Jump! The armada of the peoples vanishes among the stars, bound for the unknown.`, 'good');
    } else if (a.phase === 'away' && a.t > 70) {
      this.h.fx({ kind: 'warpIn', x: a.x, z: a.z, dx: -dx, dz: -dz, count: a.launched, tint: 'own' });
      const sn = this.leaderName();
      if (a.vsAliens && s.alienSpecies) {
        civ.peace = true;
        civ.stats.battles += 12;
        s.invasion.next = s.time + 1500 / (1 + 0.12 * (threatOf(s) - 1));
        s.ships = s.ships.filter((x) => !x.alien);
        for (const w of s.worlds) w.invaded *= 0.15;
        gain(civ.res, { science: 180, metal: 120 });
        this.h.news('⚔', `La armada vuelve victoriosa: los ${invaderNames(s.alienSpecies)[0]} firman la paz y abandonan tu sistema.`, `The armada returns victorious: the ${invaderNames(s.alienSpecies)[1]} sign a peace and leave your system.`, 'good');
      } else {
        const name = speciesName(this.h.rng);
        civ.allies.push(name);
        civ.stats.colonies += 2;
        for (let k = 0; k < 2; k++) {
          const crew = a.crew?.length ? this.h.rng.pick(a.crew) : 0;
          this.h.foundStar(worldName(this.h.rng, new Set()), crew || (this.h.peoples.leader()?.id ?? 0), Math.atan2(a.z, a.x) + this.h.rng.range(-0.5, 0.5));
        }
        gain(civ.res, { science: 220, fuel: 120 });
        this.h.news('⚔', `La armada regresa de un viaje de mil años: trae dos colonias nuevas y la amistad de los ${name}.`, `The armada returns from a thousand-year voyage: it brings two new colonies and the friendship of the ${capName(name)}.`, 'good');
      }
      // Back to every port.
      const ports = this.settled();
      for (let i = 0; i < a.launched && ports.length; i++) {
        const w = ports[i % ports.length];
        s.ships.push({ id: this.h.nid(), from: -4, to: w.id, t: -i * 0.25, dur: this.h.rng.range(6, 11), alien: false, kind: 'armada', sx: a.x, sz: a.z, back: true, people: this.ownerOf(w) || undefined });
      }
      civ.armada = null;
    }
  }

  // ------------------------------------------------------------------ defence
  private defend(civ: CivState, dt: number) {
    const s = this.h.s;
    const F = defLevel(s, 'fleet');
    if (!F) return;
    // Every settled world, whatever its people, shoots at intruders.
    const guards = this.settled();
    if (!guards.length) return;
    // A fleet that keeps up with the threat catches nearly every intruder on its way in; one left
    // behind lets more and more of them through.
    const L = threatOf(s);
    const rate = -Math.log(1 - fleetCatch(F, L)) / 13;
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
          const [al, AL] = invaderNames(s.alienSpecies);
          this.h.news('⟁', `La flota de defensa intercepta a los ${al}. Ya van ${civ.stats.battles} naves derribadas.`, `The defence fleet intercepts the ${AL}. ${civ.stats.battles} ships brought down so far.`, 'good');
        }
        continue;
      }
      const k = sh.t / sh.dur;
      if (k > 0.3 && k < 0.92 && this.h.rng.next() < dt * rate) {
        sh.doom = 1.1;
        const shooter = this.h.rng.pick(guards);
        this.h.fx({ kind: 'laser', ship: sh.id, world: shooter.id });
      }
    }
    for (const w of s.worlds) if (w.invaded > 0) w.invaded = Math.max(0, w.invaded - dt * 0.004 * clamp(1 - 0.12 * (L - F), 0.3, 1.3));
  }

  /** Called by the system when an asteroid is about to hit: shields stop it. */
  shieldStops(w: World, threatId: number) {
    const s = this.h.s;
    const S = defLevel(s, 'shield');
    if (!S || !isSettled(w)) return false;
    // Shields behind the threat no longer catch every rock.
    if (this.h.rng.next() > shieldStop(S, threatOf(s))) {
      this.h.news('⛨', `El escudo de ${w.name} no da abasto: una roca lo atraviesa.`, `The shield of ${w.name} cannot cope: a rock gets through.`, 'warn');
      return false;
    }
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
    const sn = this.leaderName();
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
      addHarm(s, accept && w ? -1.5 : 1);
      if (accept && w) {
        const a = rng.range(0, TAU);
        s.ships.push({ id: this.h.nid(), from: -5, to: w.id, t: 0, dur: 14, alien: false, kind: 'refugee', sx: Math.cos(a) * 110, sz: Math.sin(a) * 110, species: name });
        this.h.news('⌂', `${w.name} recibirá a los ${name}. Su nave ya se acerca.`, `${w.name} will take in the ${capName(name)}. Their ship is already approaching.`, 'good');
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
          this.h.fx({ kind: 'warpOut', x, z, dx: p.x / len, dz: p.z / len, count: 3, tint: 'own', people: this.ownerOf(home) || undefined });
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
      if (!s.alienSpecies) s.alienSpecies = { ...invaderName(rng), hue: rng.range(0.78, 0.95) };
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
    const sn = this.leaderName();
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
        this.h.news('☀', `Una superllamarada de la estrella deja sin satélites a medio sistema. Los pueblos vuelven a empezar.`, `A superflare from the star knocks out half the satellites in the system. The peoples start again.`, 'warn');
      }
    }
  }

  get energyCap() {
    return this.civ?.done.dyson ? 200 : 100;
  }

  private flavor(civ: CivState) {
    const s = this.h.s;
    const peoples = this.h.peoples.alive();
    if (!peoples.length || s.time < civ.nextFlavor) return;
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
    const who = this.h.peoples.get(this.ownerOf(w)) ?? rng.pick(peoples);
    this.h.news('❧', fill(f.es, who.name), fill(f.en, capName(who.name)), 'info');
  }
}
