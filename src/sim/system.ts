import { massOf, omega, toWorld, type GameState, type NewsFocus, type NewsItem, type Ship, type World } from '../core/state';
import { Rng, clamp, smoothstep } from '../util';
import { worldStats, colonizable, isGiantStuff } from './worlds';
import { CivSim, type CivFx } from './civ';
import { MAX_PEOPLES, PeopleSim, migratePeoples, peopleOf, type PeopleFx } from './peoples';
import { PatrolSim, type PatrolFx } from './patrols';
import { OrbitSim, type OrbitFx } from './orbits';
import { VoicesSim, addHarm } from './voices';
import { defLevel, shieldSlow, threatOf } from './threat';
import { capName, moonName, speciesName, invaderName, invaderNames } from '../content/names';
import { FACTS } from '../content/facts';

/** Seconds (at speed 1) each life stage needs before the next one. */
export const STAGE_TIME = [70, 90, 110, 90, 80];
export const STAGE_NAMES = [
  { es: 'Vida microbiana', en: 'Microbial life' },
  { es: 'Vida compleja', en: 'Complex life' },
  { es: 'Inteligencia', en: 'Intelligence' },
  { es: 'Civilización', en: 'Civilization' },
  { es: 'Era espacial', en: 'Space age' },
  { es: 'Era interplanetaria', en: 'Interplanetary age' },
];
/** System age advances faster while nothing is alive, slower as history gets busy (millions of years per second). */
const AGE_RATE = [12, 5, 0.6, 0.002, 0.0005, 0.0003];

export const COST = { flare: 30, flareShip: 12, volcano: 12, comets: 25, migrate: 35 };

export type Fx =
  | CivFx
  | PeopleFx
  | PatrolFx
  | OrbitFx
  | { kind: 'flare'; world: number }
  | { kind: 'flareShip'; x: number; z: number }
  | { kind: 'impact'; world: number }
  | { kind: 'volcano'; world: number }
  | { kind: 'life'; world: number }
  | { kind: 'colony'; world: number }
  | { kind: 'arkLaunch'; world: number }
  | { kind: 'arkWarp'; ship: number };

/** Everything after formation: climate, life, civilization, colonies and visitors. */
export class SystemSim {
  onNews: (n: NewsItem) => void = () => {};
  onFx: (f: Fx) => void = () => {};
  rng: Rng;
  civ: CivSim;
  peoples: PeopleSim;
  patrols: PatrolSim;
  orbits: OrbitSim;
  voices: VoicesSim;
  private shipTimers = new Map<number, number>();
  private alienTimers = new Map<number, number>();
  private factT = 40;
  private wildT = 140;

  constructor(public s: GameState) {
    this.rng = new Rng(s.seed ^ 0x9e3779b9 ^ Math.floor(s.time));
    migratePeoples(s);
    this.civ = new CivSim(this);
    this.peoples = new PeopleSim(this);
    this.patrols = new PatrolSim(this);
    this.orbits = new OrbitSim(this);
    this.voices = new VoicesSim(this);
  }

  fx(f: CivFx | PeopleFx | PatrolFx | OrbitFx) {
    this.onFx(f);
  }

  foundStar(name: string, people: number, ang: number) {
    this.patrols.found(name, people, ang);
  }

  /** A choice made by the player on one of the pending decisions. */
  decide(id: number, accept: boolean) {
    const civ = this.s.civ;
    const d = civ?.decisions.find((x) => x.id === id);
    if (!civ || !d) return;
    if (d.kind === 'tension' || d.kind === 'war') {
      civ.decisions.splice(civ.decisions.indexOf(d), 1);
      this.peoples.decide(d, accept);
    } else if (d.kind === 'outpost' || d.kind === 'annex') {
      civ.decisions.splice(civ.decisions.indexOf(d), 1);
      this.patrols.decide(d, accept);
    } else if (d.kind === 'plea') {
      civ.decisions.splice(civ.decisions.indexOf(d), 1);
      this.voices.decide(d, accept);
    } else this.civ.decide(id, accept);
  }

  get worlds() {
    return this.s.worlds;
  }
  world(id: number) {
    return this.s.worlds.find((w) => w.id === id);
  }
  get L() {
    return this.s.L * this.s.dial;
  }
  stats(w: World) {
    return worldStats(w, this.s.worlds, this.L);
  }
  nid() {
    return this.s.nextId++;
  }

  news(icon: string, es: string, en: string, kind: NewsItem['kind'] = 'info', focus?: NewsFocus) {
    const item: NewsItem = { age: this.s.age, icon, es, en, kind };
    const f = focus ?? this.guessFocus(es);
    if (f) item.focus = f;
    this.s.news.push(item);
    if (this.s.news.length > 240) this.s.news.shift();
    this.onNews(item);
  }

  /** Where a piece of news happened, read from its text: a world, a distant star, the barge, the invaders, a people. */
  guessFocus(text: string): NewsFocus | undefined {
    const s = this.s;
    const has = (name: string) => {
      if (!name) return false;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, 'u').test(text);
    };
    for (const w of [...s.worlds].sort((a, b) => b.name.length - a.name.length)) if (has(w.name)) return { world: w.id };
    for (const st of s.stars ?? []) if (has(st.name)) return { star: st.id };
    if (s.patrol && s.patrol.phase !== 'away' && /Space Patrols|«/.test(text)) return { barge: true };
    if (s.alienSpecies && has(s.alienSpecies.name)) {
      const sh = s.ships.find((x) => x.kind === 'mother') ?? s.ships.find((x) => x.alien);
      if (sh) return { ship: sh.id };
    }
    for (const p of this.peoples.alive()) {
      if (!has(p.name)) continue;
      const h = this.peoples.home(p) ?? this.peoples.worldsOf(p)[0];
      if (h) return { world: h.id };
    }
    return undefined;
  }

  /** A world disappears (swallowed in a collision): nothing may keep pointing at it. */
  removeWorld(id: number) {
    const s = this.s;
    s.worlds = s.worlds.filter((w) => w.id !== id);
    s.ships = s.ships.filter((x) => x.from !== id && x.to !== id);
    s.threats = s.threats.filter((t) => t.target !== id);
    if (s.civ) s.civ.decisions = s.civ.decisions.filter((d) => d.world !== id);
    if (s.patrol?.target === id) {
      s.patrol.target = undefined;
      s.patrol.goal = undefined;
      if (s.patrol.phase === 'approach' || s.patrol.phase === 'assault') {
        s.patrol.phase = 'return';
        s.patrol.t = 0;
        s.patrol.sx = s.patrol.x;
        s.patrol.sy = s.patrol.y;
        s.patrol.sz = s.patrol.z;
      }
    }
    s.encounters = (s.encounters ?? []).filter((e) => e.a !== id && e.b !== id);
  }

  /** Highest life stage reached anywhere (−1: lifeless). */
  get topStage() {
    let st = -1;
    for (const w of this.s.worlds) if (w.life) st = Math.max(st, w.life.stage);
    return st;
  }
  /** Home world of the most advanced people (where the great works rise). */
  get origin() {
    return this.peoples.home(this.peoples.leader()) ?? null;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    const s = this.s;
    s.time += dt;
    const top = this.topStage;
    s.age += AGE_RATE[Math.max(0, top)] * dt * (top < 0 ? 1.4 : 1);
    s.L = 1 + 0.07 * (s.age / 1000);
    s.energy = Math.min(this.civ.energyCap, s.energy + dt * this.energyRate);
    for (const w of s.worlds) {
      if (w.parent === null) w.th += omega(w.a) * dt * 0.42;
      else w.th += (1.3 / (w.a + 1.5)) * dt;
      w.volcanoCd = Math.max(0, w.volcanoCd - dt);
      if (w.hot) w.hot = Math.max(0, w.hot - dt);
    }
    this.updateWorlds(dt);
    this.orbits.update(dt);
    this.updateCivilization(dt);
    this.peoples.update(dt);
    this.civ.update(dt);
    this.patrols.update(dt);
    this.voices.update(dt);
    this.updateShips(dt);
    this.updateThreats(dt);
    this.updateInvasion(dt);
    this.updateEvents(dt);
    this.wildImpacts(dt);
  }

  /** Starlight gained per second. */
  get energyRate() {
    return 0.85 * this.s.dial * (this.s.civ?.done.dyson ? 3 : 1);
  }

  private updateWorlds(dt: number) {
    const s = this.s;
    for (const w of s.worlds) {
      const st = this.stats(w);
      if (st.giant) continue;
      // Without a magnetic shield, the stellar wind slowly strips the air.
      if (w.mag < 0.25 && w.atm > 0.02) w.atm = Math.max(0, w.atm - dt * 0.0012 * (0.25 - w.mag) * 4 * s.dial);
      if (st.T > 345 && w.ocean > 0) w.ocean = Math.max(0, w.ocean - dt * 0.003);
      // Climate wanders; a civilization keeps it calmer.
      if (w.life || w.colony >= 1) {
        const calm = (w.life?.stage ?? 0) >= 3 || w.colony >= 1 ? 0.4 : 1;
        w.climate += (-w.climate * 0.03 + this.rng.gauss(0, 3.2 * calm)) * dt;
      } else w.climate *= Math.exp(-dt * 0.05);
      this.updateLife(w, st.H, dt);
    }
  }

  private updateLife(w: World, H: number, dt: number) {
    const s = this.s;
    if (!w.life) {
      if (H >= 0.62 && w.colony < 1) {
        w.spark += dt;
        if (w.spark > 30) {
          w.life = { stage: 0, progress: 0, health: 0.6, origin: true };
          w.spark = 0;
          this.onFx({ kind: 'life', world: w.id });
          this.news('❦', `En ${w.name} aparecen las primeras células. La vida ha comenzado.`, `The first cells appear on ${w.name}. Life has begun.`, 'life');
        }
      } else w.spark = Math.max(0, w.spark - dt * 2);
      return;
    }
    const life = w.life;
    const resilience = life.stage >= 3 ? 0.55 : 1;
    if (H >= 0.5) life.health = Math.min(1, life.health + (0.02 + 0.03 * H) * dt);
    else life.health -= (0.5 - H) * 0.07 * dt * resilience;
    life.health -= w.invaded * 0.025 * dt * resilience;
    if (life.health <= 0) {
      const people = this.peoples.get(life.people);
      w.life = null;
      this.news('✝', `La vida de ${w.name} se ha extinguido. Las condiciones se volvieron demasiado duras.`, `Life on ${w.name} has died out. Conditions became too harsh.`, 'warn');
      if (people && !people.gone)
        this.news('✝', `Los ${people.name} pierden su mundo natal. Lo que quede de ellos vive en sus colonias.`, `The ${capName(people.name)} lose their home world. Whatever remains of them lives on in their colonies.`, 'warn');
      return;
    }
    // Every living world keeps evolving. Worlds colonized by some people stay wild, and a system
    // holds at most a few peoples at once.
    const canRise = !w.colony && (!!life.people || this.peoples.alive().length < MAX_PEOPLES);
    const cap = canRise ? 4 : 1;
    if (life.stage >= cap) return;
    const rate = (0.4 + 0.6 * life.health) * (H >= 0.5 ? 1 : 0.4);
    life.progress += (rate * dt) / STAGE_TIME[life.stage];
    if (life.progress >= 1) this.advance(w, life.stage + 1);
  }

  private advance(w: World, stage: number) {
    const s = this.s;
    const life = w.life!;
    // Intelligence: a new people is born (unless the system is already full of them).
    if (stage === 2 && !life.people && !this.peoples.emerge(w)) return;
    life.stage = stage;
    life.progress = 0;
    if (stage === 1) this.news('❀', `La vida de ${w.name} se vuelve compleja: algas, corales y criaturas que nadan.`, `Life on ${w.name} grows complex: algae, reefs and swimming creatures.`, 'life');
    if (stage === 3 && s.civStart == null) s.civStart = s.age;
    if (stage >= 3) this.peoples.advance(w, stage);
  }

  // ------------------------------------------------------------------ civilization
  /** Every people: satellites, terraforming of its colonies, and colonists for free worlds. */
  private updateCivilization(dt: number) {
    const s = this.s;
    const crowd = 1 + 0.25 * Math.max(0, this.peoples.alive().length - 1);
    for (const w of s.worlds) {
      const pid = peopleOf(w);
      const p = this.peoples.get(pid);
      if (!p || p.gone) continue;
      const native = w.life?.people === pid;
      const settled = (w.colony >= 1 && w.owner === pid) || (native && w.life!.stage >= 3);
      if (!settled) continue;
      const stage = this.peoples.stage(p);
      const target = native ? 10 : 3;
      if (stage >= 4 && w.sats < target && this.rng.next() < dt * 0.08) w.sats++;
      if (!native && w.colony >= 1 && !isGiantStuff(w) && w.terra < 1) {
        const before = w.terra;
        // Terraforming drinks water: icy worlds and moons keep it going.
        const civ = s.civ;
        let pace = 1;
        if (civ) {
          civ.res.water = Math.max(0, civ.res.water - dt * 0.04);
          if (civ.res.water < 1) pace = 0.35;
        }
        w.terra = Math.min(1, w.terra + (dt / 260) * pace);
        if (before < 0.5 && w.terra >= 0.5) this.news('☘', `${w.name} está a medio terraformar: ya llueve en sus valles.`, `${w.name} is half terraformed: rain now falls in its valleys.`, 'good');
        if (before < 1 && w.terra >= 1) this.news('☘', `Terraformación completa: ${w.name} es un hogar verde y azul para los ${p.name}.`, `Terraforming complete: ${w.name} is a green and blue home for the ${capName(p.name)}.`, 'good');
      }
      if (stage < 4 || w.invaded > 0.5) continue;
      let t = this.shipTimers.get(w.id) ?? this.rng.range(4, 12);
      t -= dt;
      if (t <= 0) {
        t = this.rng.range(13, 22) * (s.civ?.done.elevator ? 0.6 : 1) * crowd;
        const tgt = this.pickTarget(w, false, pid);
        if (tgt) this.launch(w.id, tgt.id, false, undefined, pid);
      }
      this.shipTimers.set(w.id, t);
    }
  }

  private worldPosW(w: World) {
    const p = w.parent === null ? w : this.world(w.parent)!;
    return toWorld(p.a);
  }

  /** Nearest world still waiting for colonists (or for visitors, when `alien`): a free one, or a half-built colony of the same people. */
  private pickTarget(from: World, alien: boolean, people = 0) {
    const s = this.s;
    const fw = this.worldPosW(from);
    let best: World | null = null;
    let bd = Infinity;
    for (const w of s.worlds) {
      if (w === from || !colonizable(w)) continue;
      const ours = !alien && people > 0 && w.owner === people && w.colony > 0 && w.colony < 1 && w.invaded < 0.5;
      if (alien ? w.invaded >= 0.9 : !ours && !this.peoples.free(w)) continue;
      const inbound = s.ships.filter((x) => x.to === w.id && x.alien === alien).length;
      if (inbound >= 2) continue;
      const d = Math.abs(this.worldPosW(w) - fw) + (w.parent === from.id ? -100 : 0) + (w.parent !== null && w.parent === from.parent ? -20 : 0) + (ours ? -30 : 0);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  launch(from: number, to: number, alien: boolean, dur?: number, people?: number) {
    const s = this.s;
    const a = from >= 0 ? this.world(from) : null;
    const b = this.world(to);
    if (!b) return;
    const dist = a ? Math.abs(this.worldPosW(a) - this.worldPosW(b)) : 40;
    s.ships.push({ id: this.nid(), from, to, t: 0, dur: dur ?? 7 + dist * 0.28, alien, kind: alien ? 'alien' : 'colony', people });
  }

  private updateShips(dt: number) {
    const s = this.s;
    for (const sh of [...s.ships]) {
      sh.t += dt;
      if (sh.t < sh.dur) continue;
      s.ships.splice(s.ships.indexOf(sh), 1);
      if (sh.ark) {
        s.won = true;
        this.onFx({ kind: 'arkWarp', ship: sh.id });
        continue;
      }
      if (this.peoples.arrive(sh)) continue;
      if (this.patrols.arrive(sh)) continue;
      if (this.civ.arrive(sh)) continue;
      const w = this.world(sh.to);
      if (!w) continue;
      if (sh.alien) this.alienArrives(w, sh.kind === 'mother');
      else this.colonistsArrive(w, sh.from === -1);
    }
  }

  /** Colonists without a people of this system: the ark from your previous system. */
  private colonistsArrive(w: World, ark = false) {
    const s = this.s;
    if (!ark || !s.legacySpecies || w.colony > 0 || (w.life && w.life.stage >= 2)) return;
    const p = this.peoples.newcomers(s.legacySpecies.name, s.legacySpecies.hue, w);
    if (!p) return;
    this.onFx({ kind: 'colony', world: w.id });
    this.news('⌂', `El arca se posa en ${w.name}: los ${p.name} tienen un nuevo hogar.`, `The ark lands on ${w.name}: the ${capName(p.name)} have a new home.`, 'good');
  }

  // ------------------------------------------------------------------ threats
  private updateThreats(dt: number) {
    const s = this.s;
    for (const th of [...s.threats]) {
      th.t += dt;
      const target = this.world(th.target);
      if (target && !th.tried && th.t / th.dur > 0.8) {
        th.tried = true;
        if (this.civ.shieldStops(target, th.id)) {
          s.threats.splice(s.threats.indexOf(th), 1);
          continue;
        }
      }
      if (th.t < th.dur) continue;
      s.threats.splice(s.threats.indexOf(th), 1);
      const w = this.world(th.target);
      if (!w) continue;
      this.onFx({ kind: 'impact', world: w.id });
      w.ocean = clamp(w.ocean + 0.04);
      w.organics = clamp(w.organics + 0.05);
      if (w.life) {
        w.life.health -= w.life.stage >= 3 ? 0.2 : 0.35;
        this.news('☄', `Un asteroide golpeó ${w.name}. La vida resiste como puede.`, `An asteroid struck ${w.name}. Life holds on as best it can.`, 'warn');
      } else this.news('☄', `Un asteroide cayó sobre ${w.name} y dejó agua y compuestos orgánicos.`, `An asteroid fell on ${w.name}, leaving water and organic compounds.`, 'info');
      this.aftermath(w);
    }
  }

  /** What an impact leaves behind: a glowing scar, and sometimes a ring, a new moon or a trail of debris. */
  aftermath(w: World) {
    const s = this.s;
    const rng = this.rng;
    w.hot = 25;
    const planet = w.parent === null ? w : this.world(w.parent);
    if (!planet) return;
    const giant = isGiantStuff(planet);
    const moons = s.worlds.filter((x) => x.parent === planet.id).length;
    const roll = rng.next();
    if (roll < 0.3 && !planet.ring) {
      planet.ring = true;
      planet.debrisRing = !giant;
      this.news('◌', `Los escombros del choque quedan girando alrededor de ${planet.name}: ahora tiene un anillo.`, `The debris of the impact keeps circling ${planet.name}: it now has a ring.`, 'info');
    } else if (roll < 0.55 && moons < 5) {
      const m = massOf(planet);
      const share = giant ? 0.002 : 0.012;
      const moon: World = {
        id: this.nid(),
        name: moonName(planet.name, moons),
        seed: (rng.next() * 1e9) | 0,
        a: moons,
        th: rng.range(0, Math.PI * 2),
        parent: planet.id,
        metal: m * share * 0.2,
        rock: m * share * 0.7,
        water: m * share * 0.1,
        gas: 0,
        org: m * share * 0.01,
        atm: 0,
        ocean: 0,
        organics: 0.02,
        mag: 0,
        climate: 0,
        life: null,
        spark: 0,
        colony: 0,
        terra: 0,
        invaded: 0,
        sats: 0,
        ring: false,
        volcanoCd: 0,
        hot: 30,
      };
      s.worlds.push(moon);
      this.news('☾', `De los restos del choque se forma una pequeña luna: ${moon.name}.`, `A small moon gathers from the impact debris: ${moon.name}.`, 'good');
    } else if (roll < 0.8 && planet.parent === null) {
      for (let i = 0; i < 46; i++) s.belts.push({ r: planet.a * (1 + rng.gauss(0, 0.012)), th: planet.th - 0.05 - rng.range(0, 0.9), s: 0.0005 });
      this.news('⁘', `Una estela de escombros sigue a ${planet.name} por su órbita.`, `A trail of debris follows ${planet.name} along its orbit.`, 'info');
    }
  }

  /** Stray rocks and comets that hit any world now and then (no warning). */
  private wildImpacts(dt: number) {
    this.wildT -= dt;
    if (this.wildT > 0) return;
    this.wildT = this.rng.range(110, 190) / (1 + 0.08 * (threatOf(this.s) - 1));
    const s = this.s;
    const pool = s.worlds.filter((w) => colonizable(w));
    if (!pool.length) return;
    const w = this.rng.pick(pool);
    if (this.civ.shieldStops(w, -1)) return;
    this.onFx({ kind: 'impact', world: w.id });
    if (w.life) w.life.health -= 0.08;
    if (isGiantStuff(w)) this.news('☄', `Un cometa se hunde en las nubes de ${w.name} y deja una mancha oscura que tardará años en borrarse.`, `A comet plunges into the clouds of ${w.name}, leaving a dark scar that will take years to fade.`, 'info');
    else this.news('☄', `Un meteorito golpea ${w.name}. Desde lejos se ve el resplandor del cráter.`, `A meteorite strikes ${w.name}. The crater's glow can be seen from afar.`, 'info');
    this.aftermath(w);
  }

  // ------------------------------------------------------------------ visitors from other stars
  private updateInvasion(dt: number) {
    const s = this.s;
    const inv = s.invasion;
    const trigger = this.topStage >= 3 || s.time > 1500;
    if (!inv.signal && trigger) {
      inv.signal = 1;
      inv.next = s.time + 50;
      s.alienSpecies = { ...invaderName(this.rng, s.alienSpecies?.name), hue: this.rng.range(0.78, 0.95) };
      this.news('⚠', 'Llega una señal desde otra estrella. Algo se acerca a tu sistema.', 'A signal arrives from another star. Something is approaching your system.', 'alien');
    }
    const civ = s.civ;
    if (civ?.peace) {
      // Peace holds for a long while… until someone new arrives from farther away.
      if (s.time < inv.next) return;
      civ.peace = false;
      inv.waves = 0;
      s.alienSpecies = { ...invaderName(this.rng, s.alienSpecies?.name), hue: this.rng.range(0.78, 0.95) };
      inv.next = s.time + 45;
      this.news('⚠', `Desde el otro lado de la galaxia llega una nueva amenaza: los ${invaderNames(s.alienSpecies)[0]}.`, `A new threat arrives from the far side of the galaxy: the ${invaderNames(s.alienSpecies)[1]}.`, 'alien');
      return;
    }
    // Conquered stars make enemies, and a strong system is seen from afar: waves come sooner and bigger.
    const dominions = this.patrols.dominions();
    const L = threatOf(s);
    if (inv.signal && s.time >= inv.next) {
      inv.waves++;
      inv.next = s.time + this.rng.range(240, 360) / (1 + 0.3 * dominions + 0.12 * (L - 1));
      const n = 1 + Math.min(5, inv.waves) + Math.min(4, dominions) + Math.floor((L - 1) * 0.6);
      const targets = s.worlds.filter((w) => colonizable(w) && w.invaded < 0.9);
      targets.sort((a, b) => b.colony + (b.life ? 1 : 0) - (a.colony + (a.life ? 1 : 0)));
      const from = -1 - ((this.rng.next() * 1000) | 0);
      for (let i = 0; i < n && targets.length; i++) {
        const tg = targets[Math.min(targets.length - 1, (this.rng.next() * Math.min(3, targets.length)) | 0)];
        s.ships.push({ id: this.nid(), from, to: tg.id, t: -i * 0.8, dur: this.rng.range(18, 26), alien: true, kind: 'alien' });
      }
      const [al, AL] = invaderNames(s.alienSpecies);
      // From the third wave on, a mothership leads them, dropping out of warp — sooner, tougher
      // and in pairs when the threat is high.
      const mothers = inv.waves >= (L >= 7 ? 1 : L >= 4 ? 2 : 3) && targets.length ? (L >= 7 ? 2 : 1) : 0;
      if (mothers) {
        for (let m = 0; m < mothers; m++)
          s.ships.push({ id: this.nid(), from, to: targets[m % targets.length].id, t: -2 - m * 3, dur: 34, alien: true, kind: 'mother', hp: 3 + Math.floor((L - 1) / 2) });
        const a = (Math.abs(from) * 2.399) % (Math.PI * 2);
        this.onFx({ kind: 'warpIn', x: Math.cos(a) * 110, z: Math.sin(a) * 110, dx: -Math.cos(a), dz: -Math.sin(a), count: n + mothers, tint: 'alien' });
        if (mothers > 1) this.news('⚠', `¡Dos naves nodriza de los ${al} salen de la curvatura, escoltadas por ${n} naves!`, `Two ${AL} motherships drop out of warp, escorted by ${n} ships!`, 'alien');
        else this.news('⚠', `¡Una nave nodriza de los ${al} sale de la curvatura, escoltada por ${n} naves!`, `A ${AL} mothership drops out of warp, escorted by ${n} ships!`, 'alien');
      } else this.news('⚠', `Naves de los ${al} entran en tu sistema. Buscan mundos donde quedarse.`, `Ships of the ${AL} enter your system. They are looking for worlds to settle.`, 'alien');
    }
    // The peoples fight back on their own, slowly; a flare, the defence fleet or the Space Patrols are much faster.
    const held = s.worlds.filter((w) => w.invaded >= 0.6).length;
    for (const w of s.worlds) {
      if (w.invaded <= 0) continue;
      const p = this.peoples.get(peopleOf(w));
      if (p && this.peoples.stage(p) >= 4) w.invaded = Math.max(0, w.invaded - dt * 0.0016);
      // Under a long occupation, the natives suffer.
      if (w.life && w.invaded >= 0.6 && held >= 2) w.life.health -= dt * 0.0012;
    }
    // Settled visitors spread to nearby worlds — faster the more they hold.
    for (const w of s.worlds) {
      if (w.invaded < 0.6 || s.won) continue;
      let t = this.alienTimers.get(w.id) ?? this.rng.range(20, 35);
      t -= dt;
      if (t <= 0) {
        t = this.rng.range(28, 40) / (held >= 3 ? 1.5 : 1);
        const tg = this.pickTarget(w, true);
        if (tg) this.launch(w.id, tg.id, true);
      }
      this.alienTimers.set(w.id, t);
      if (w.colony > 0) w.colony = Math.max(0, w.colony - w.invaded * 0.004 * dt);
    }
  }

  private alienArrives(w: World, mother = false) {
    const s = this.s;
    const before = w.invaded;
    // Bolder invaders when the threat is high; shields slow them down over settled worlds.
    const L = threatOf(s);
    const S = this.civ.settled().includes(w) ? defLevel(s, 'shield') : 0;
    const k = (1 + 0.06 * (L - 1)) * (S ? shieldSlow(S, L) : 1);
    w.invaded = Math.min(1, w.invaded + (mother ? 0.85 : 0.4) * k);
    const [al, AL] = invaderNames(this.s.alienSpecies);
    if (before < 0.5 && w.invaded >= 0.5)
      this.news('⚠', `Los ${al} se asientan en ${w.name}. Una llamarada solar podría expulsarlos.`, `The ${AL} settle on ${w.name}. A solar flare could drive them out.`, 'alien');
  }

  // ------------------------------------------------------------------ random events & facts
  private updateEvents(dt: number) {
    const s = this.s;
    this.factT -= dt;
    if (this.factT <= 0) {
      this.factT = this.rng.range(80, 130);
      const f = this.rng.pick(FACTS);
      this.news('✦', `¿Sabías que…? ${f.es}`, `Did you know…? ${f.en}`, 'fact');
    }
    if (s.time < s.nextEvent) return;
    s.nextEvent = s.time + this.rng.range(75, 130);
    const living = s.worlds.filter((w) => w.life || w.colony >= 1);
    if (!living.length) return;
    const w = this.rng.pick(living);
    const roll = this.rng.next();
    if (roll < 0.3) {
      w.climate -= 28;
      this.news('❄', `Comienza una era glacial en ${w.name}. Un poco más de luz o de atmósfera ayudaría.`, `An ice age begins on ${w.name}. A little more light or atmosphere would help.`, 'warn');
    } else if (roll < 0.55) {
      w.climate += 26;
      this.news('☀', `${w.name} se calienta: el efecto invernadero se intensifica.`, `${w.name} is warming up: its greenhouse effect is growing stronger.`, 'warn');
    } else if (roll < 0.75) {
      w.climate -= 14;
      w.atm += 0.08;
      this.news('⛰', `Grandes erupciones en ${w.name}: la ceniza oscurece el cielo durante siglos.`, `Huge eruptions on ${w.name}: ash darkens the sky for centuries.`, 'warn');
    } else {
      s.threats.push({ id: this.nid(), target: w.id, t: 0, dur: 45, angle: this.rng.range(0, Math.PI * 2) });
      this.news('☄', `Un asteroide se dirige hacia ${w.name}. Una llamarada solar puede desviarlo.`, `An asteroid is heading for ${w.name}. A solar flare can deflect it.`, 'warn');
    }
  }

  /** Brings the legacy species (from a previous system) into this one. */
  arriveLegacy() {
    const s = this.s;
    if (!s.legacySpecies) return;
    let best: World | null = null;
    let bh = -1;
    for (const w of s.worlds) {
      if (!colonizable(w) || isGiantStuff(w)) continue;
      const h = this.stats(w).H + (w.ocean + w.organics) * 0.05;
      if (h > bh) {
        bh = h;
        best = w;
      }
    }
    if (!best) return;
    s.ships.push({ id: this.nid(), from: -1, to: best.id, t: 0, dur: 18, alien: false });
    this.news('✧', `Un arca de los ${s.legacySpecies.name} llega desde la estrella que dejaste atrás.`, `An ark of the ${capName(s.legacySpecies.name)} arrives from the star you left behind.`, 'good');
  }

  // ------------------------------------------------------------------ player actions
  canAfford(c: number) {
    return this.s.energy >= c;
  }

  flare(w: World) {
    const s = this.s;
    if (!this.canAfford(COST.flare)) return false;
    s.energy -= COST.flare;
    this.onFx({ kind: 'flare', world: w.id });
    const had = w.invaded;
    // Burning a world where people live (not to drive invaders out) is a cruelty they remember.
    if (had < 0.3 && !s.threats.some((t) => t.target === w.id)) {
      if (peopleOf(w)) addHarm(s, 4);
      else if (w.life) addHarm(s, 1);
    }
    w.invaded = Math.max(0, w.invaded - 0.75);
    if (!isGiantStuff(w)) w.atm = Math.max(0, w.atm - 0.05 * (1 - w.mag));
    if (w.life) w.life.health -= 0.12;
    const threats = s.threats.filter((t) => t.target === w.id);
    for (const t of threats) s.threats.splice(s.threats.indexOf(t), 1);
    s.ships = s.ships.filter((sh) => !(sh.alien && sh.to === w.id && sh.t / sh.dur > 0.6));
    if (threats.length) this.news('☀', `Tu llamarada desvió el asteroide que amenazaba ${w.name}.`, `Your flare deflected the asteroid threatening ${w.name}.`, 'good');
    else if (had >= 0.3 && w.invaded < 0.3) this.news('☀', `La llamarada expulsó a los visitantes de ${w.name}.`, `The flare drove the visitors away from ${w.name}.`, 'good');
    return true;
  }

  flareShip(sh: Ship) {
    if (!sh.alien || !this.canAfford(COST.flareShip)) return false;
    this.s.energy -= COST.flareShip;
    this.s.ships.splice(this.s.ships.indexOf(sh), 1);
    return true;
  }

  volcano(w: World) {
    const m = massOf(w);
    if (isGiantStuff(w) || m < 0.03 || w.volcanoCd > 0 || !this.canAfford(COST.volcano)) return false;
    this.s.energy -= COST.volcano;
    if (w.life && w.life.stage >= 3) addHarm(this.s, 1);
    w.volcanoCd = 25;
    w.atm += 0.25 * smoothstep(0.03, 1, m) + 0.04;
    w.organics = clamp(w.organics + 0.03);
    w.climate += 5;
    this.onFx({ kind: 'volcano', world: w.id });
    return true;
  }

  applyComets(w: World, d: { water: number; org: number; atm: number; metal: number }, cost = true) {
    if (cost) this.s.energy -= COST.comets;
    w.ocean = clamp(w.ocean + d.water);
    w.water += d.water * massOf(w) * 0.05;
    w.organics = clamp(w.organics + d.org);
    w.atm += d.atm;
    w.mag = clamp(w.mag + d.metal);
    if (d.water + d.org + d.atm > 0.05) this.news('☄', `Una lluvia de cometas enriquece ${w.name}.`, `A shower of comets enriches ${w.name}.`, 'good');
  }

  migrate(w: World, factor: number, cost = true) {
    if (cost) this.s.energy -= COST.migrate;
    if (w.parent !== null) return;
    const before = w.a;
    w.a = clamp(w.a * factor, 0.3, 16);
    if (Math.abs(w.a - before) > 0.001) this.news('↻', `${w.name} cambió de órbita: ahora está a ${w.a.toFixed(2).replace('.', ',')} UA de su estrella.`, `${w.name} moved to a new orbit: now ${w.a.toFixed(2)} AU from its star.`, 'info');
  }
}
