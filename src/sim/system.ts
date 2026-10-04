import { massOf, omega, toWorld, type GameState, type NewsItem, type Ship, type World } from '../core/state';
import { Rng, clamp, smoothstep } from '../util';
import { worldStats, colonizable, isGiantStuff } from './worlds';
import { CivSim, type CivFx } from './civ';
import { PeopleSim, rivalOf, type PeopleFx } from './peoples';
import { capName, moonName, speciesName } from '../content/names';
import { FACTS } from '../content/facts';

/** Seconds (at speed 1) each life stage needs before the next one. */
export const STAGE_TIME = [70, 90, 110, 90, 80];
export const STAGE_NAMES = [
  { es: 'Vida microbiana', en: 'Microbial life' },
  { es: 'Vida compleja', en: 'Complex life' },
  { es: 'Inteligencia', en: 'Intelligence' },
  { es: 'Civilización', en: 'Civilization' },
  { es: 'Era espacial', en: 'Space age' },
  { es: 'Especie interplanetaria', en: 'Interplanetary species' },
];
/** System age advances faster while nothing is alive, slower as history gets busy (millions of years per second). */
const AGE_RATE = [12, 5, 0.6, 0.002, 0.0005, 0.0003];

export const COST = { flare: 30, flareShip: 12, volcano: 12, comets: 25, migrate: 35 };

export type Fx =
  | CivFx
  | PeopleFx
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
  private shipTimers = new Map<number, number>();
  private alienTimers = new Map<number, number>();
  private factT = 40;
  private wildT = 140;

  constructor(public s: GameState) {
    this.rng = new Rng(s.seed ^ 0x9e3779b9 ^ Math.floor(s.time));
    this.civ = new CivSim(this);
    this.peoples = new PeopleSim(this);
  }

  fx(f: CivFx | PeopleFx) {
    this.onFx(f);
  }

  /** A choice made by the player on one of the pending decisions. */
  decide(id: number, accept: boolean) {
    const civ = this.s.civ;
    const d = civ?.decisions.find((x) => x.id === id);
    if (!civ || !d) return;
    if (d.kind === 'incident' || d.kind === 'alliance' || d.kind === 'peace') {
      civ.decisions.splice(civ.decisions.indexOf(d), 1);
      this.peoples.decide(d, accept);
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

  news(icon: string, es: string, en: string, kind: NewsItem['kind'] = 'info') {
    const item: NewsItem = { age: this.s.age, icon, es, en, kind };
    this.s.news.push(item);
    if (this.s.news.length > 80) this.s.news.shift();
    this.onNews(item);
  }

  /** Highest life stage reached anywhere (−1: lifeless). */
  get topStage() {
    let st = -1;
    for (const w of this.s.worlds) if (w.life) st = Math.max(st, w.life.stage);
    return st;
  }
  /** Home world of your species. */
  get origin() {
    return this.s.worlds.find((w) => w.life?.origin && w.life.stage >= 2 && !w.life.people) ?? null;
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
    this.updateCivilization(dt);
    this.peoples.update(dt);
    this.civ.update(dt);
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
      const wasSpecies = life.stage >= 2 && !life.people && s.species;
      const rival = life.people ? s.rivals?.[life.people - 1] : undefined;
      w.life = null;
      this.news('✝', `La vida de ${w.name} se ha extinguido. Las condiciones se volvieron demasiado duras.`, `Life on ${w.name} has died out. Conditions became too harsh.`, 'warn');
      if (rival) {
        rival.relation = 'peace';
        this.news('✝', `Los ${rival.name} pierden su mundo natal. Sus colonias quedan a la deriva.`, `The ${capName(rival.name)} lose their home world. Their colonies are left adrift.`, 'warn');
      }
      if (wasSpecies && !s.worlds.some((x) => x.colony >= 1 && !x.owner)) {
        this.news('✝', `Los ${s.species!.name} ya no existen. Quizá la vida vuelva a intentarlo.`, `The ${capName(s.species!.name)} are gone. Perhaps life will try again.`, 'warn');
        s.species = null;
      }
      return;
    }
    // Every living world keeps evolving. Worlds already colonized by someone stay wild, and a
    // system holds at most three peoples (yours and two neighbours).
    const primaryHome = life.origin && !life.people && life.stage >= 2;
    const canRise = !w.colony && (primaryHome || !!life.people || !s.species || (s.rivals?.length ?? 0) < 2);
    const cap = canRise ? 4 : 1;
    if (life.stage >= cap) {
      if (life.stage === 4 && primaryHome && s.worlds.some((x) => x.colony >= 1 && !x.owner)) this.advance(w, 5);
      return;
    }
    const rate = (0.4 + 0.6 * life.health) * (H >= 0.5 ? 1 : 0.4);
    life.progress += (rate * dt) / STAGE_TIME[life.stage];
    if (life.progress >= 1) this.advance(w, life.stage + 1);
  }

  private advance(w: World, stage: number) {
    const s = this.s;
    const life = w.life!;
    const n = w.name;
    // A second intelligent species: a neighbour, not yours.
    if (stage === 2 && s.species && !life.people && !this.origin?.life?.people && this.origin !== w) {
      if (!this.peoples.emerge(w)) return;
    }
    life.stage = stage;
    life.progress = 0;
    if (life.people) {
      if (stage >= 3) this.peoples.advance(w, stage);
      return;
    }
    if (stage === 1) this.news('❀', `La vida de ${n} se vuelve compleja: algas, corales y criaturas que nadan.`, `Life on ${n} grows complex: algae, reefs and swimming creatures.`, 'life');
    if (stage === 2) {
      if (!s.species) {
        const name = s.legacySpecies?.name ?? speciesName(this.rng);
        s.species = { name, hue: s.legacySpecies?.hue ?? this.rng.range(0.24, 0.42) };
      }
      const sp = s.species;
      this.news('✧', `En ${n} surge una especie que se pregunta por las estrellas: los ${sp.name}.`, `A species that wonders about the stars arises on ${n}: the ${capName(sp.name)}.`, 'life');
    }
    if (stage === 3 && s.civStart == null) s.civStart = s.age;
    if (stage === 3) this.news('⌂', `Los ${s.species?.name ?? ''} construyen ciudades: sus luces ya se ven desde el espacio.`, `The ${capName(s.species?.name ?? '')} build cities: their lights can now be seen from space.`, 'life');
    if (stage === 4) this.news('◎', `Los ${s.species?.name ?? ''} ponen en órbita su primer satélite alrededor de ${n}.`, `The ${capName(s.species?.name ?? '')} launch their first satellite around ${n}.`, 'good');
    if (stage === 5) this.news('⇄', `Los ${s.species?.name ?? ''} ya son una especie interplanetaria.`, `The ${capName(s.species?.name ?? '')} have become an interplanetary species.`, 'good');
  }

  // ------------------------------------------------------------------ civilization
  private updateCivilization(dt: number) {
    const s = this.s;
    const origin = this.origin;
    if (!s.species) return;
    const spacefaring = origin ? origin.life!.stage >= 4 : s.worlds.some((w) => w.colony >= 1);
    for (const w of s.worlds) {
      const settled = (w.colony >= 1 && !w.owner) || (w === origin && w.life!.stage >= 4);
      if (settled) {
        const target = w === origin ? 12 : 3;
        if (w.sats < target && this.rng.next() < dt * 0.08) w.sats++;
        if (w.colony >= 1 && !isGiantStuff(w) && w.terra < 1) {
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
          if (before < 1 && w.terra >= 1) this.news('☘', `Terraformación completa: ${w.name} es un hogar verde y azul.`, `Terraforming complete: ${w.name} is a green and blue home.`, 'good');
        }
      }
      if (!spacefaring || !settled || w.invaded > 0.5) continue;
      let t = this.shipTimers.get(w.id) ?? this.rng.range(4, 12);
      t -= dt;
      if (t <= 0) {
        t = this.rng.range(13, 22) * (s.civ?.done.elevator ? 0.6 : 1);
        const target = this.pickTarget(w, false);
        if (target) this.launch(w.id, target.id, false);
      }
      this.shipTimers.set(w.id, t);
    }
  }

  private worldPosW(w: World) {
    const p = w.parent === null ? w : this.world(w.parent)!;
    return toWorld(p.a);
  }

  /** Nearest world still waiting for colonists (or for visitors, when `alien`). */
  private pickTarget(from: World, alien: boolean) {
    const s = this.s;
    const fw = this.worldPosW(from);
    let best: World | null = null;
    let bd = Infinity;
    for (const w of s.worlds) {
      if (w === from || !colonizable(w)) continue;
      if (alien ? w.invaded >= 0.9 : w.colony >= 1 || (w.colony > 0 && !!w.owner) || (w.life && w.life.stage >= 2) || !!w.guest) continue;
      const inbound = s.ships.filter((x) => x.to === w.id && x.alien === alien).length;
      if (inbound >= 2) continue;
      const d = Math.abs(this.worldPosW(w) - fw) + (w.parent === from.id ? -100 : 0) + (w.parent !== null && w.parent === from.parent ? -20 : 0);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  private launch(from: number, to: number, alien: boolean, dur?: number) {
    const s = this.s;
    const a = from >= 0 ? this.world(from) : null;
    const b = this.world(to);
    if (!b) return;
    const dist = a ? Math.abs(this.worldPosW(a) - this.worldPosW(b)) : 40;
    s.ships.push({ id: this.nid(), from, to, t: 0, dur: dur ?? 7 + dist * 0.28, alien, kind: alien ? 'alien' : 'colony' });
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
      if (this.civ.arrive(sh)) continue;
      const w = this.world(sh.to);
      if (!w) continue;
      if (sh.alien) this.alienArrives(w, sh.kind === 'mother');
      else this.colonistsArrive(w, sh.from === -1);
    }
  }

  private colonistsArrive(w: World, ark = false) {
    const s = this.s;
    if (w.colony >= 1 || (w.owner && w.colony > 0)) return;
    w.owner = 0;
    // The ark from your previous system brings the whole species at once.
    if (ark && !s.species && s.legacySpecies) s.species = { ...s.legacySpecies };
    w.colony = Math.min(1, w.colony + (ark ? 1 : 0.34));
    w.invaded = Math.max(0, w.invaded - 0.15);
    if (w.colony >= 1) {
      const first = s.worlds.filter((x) => x.colony >= 1).length === 1;
      this.onFx({ kind: 'colony', world: w.id });
      const sp = s.species?.name ?? '';
      const giant = isGiantStuff(w);
      if (giant) this.news('⌂', `Los ${sp} levantan ciudades flotantes en las nubes de ${w.name}.`, `The ${capName(sp)} raise floating cities in the clouds of ${w.name}.`, 'good');
      else if (w.parent !== null) this.news('⌂', `Primera colonia en la luna ${w.name}.`, `First colony on the moon ${w.name}.`, 'good');
      else this.news('⌂', `Los ${sp} fundan una colonia en ${w.name}${first ? ': su primer hogar fuera de casa' : ''}.`, `The ${capName(sp)} found a colony on ${w.name}${first ? ': their first home away from home' : ''}.`, 'good');
    }
  }

  // ------------------------------------------------------------------ threats
  private updateThreats(dt: number) {
    const s = this.s;
    for (const th of [...s.threats]) {
      th.t += dt;
      const target = this.world(th.target);
      if (target && th.t / th.dur > 0.8 && this.civ.shieldStops(target, th.id)) {
        s.threats.splice(s.threats.indexOf(th), 1);
        continue;
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
    this.wildT = this.rng.range(110, 190);
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
      s.alienSpecies = { name: speciesName(this.rng), hue: this.rng.range(0.78, 0.95) };
      this.news('⚠', 'Llega una señal desde otra estrella. Algo se acerca a tu sistema.', 'A signal arrives from another star. Something is approaching your system.', 'alien');
    }
    const civ = s.civ;
    if (civ?.peace) {
      // Peace holds for a long while… until someone new arrives from farther away.
      if (s.time < inv.next) return;
      civ.peace = false;
      inv.waves = 0;
      s.alienSpecies = { name: speciesName(this.rng), hue: this.rng.range(0.78, 0.95) };
      inv.next = s.time + 45;
      this.news('⚠', `Desde el otro lado de la galaxia llega una nueva amenaza: los ${s.alienSpecies.name}.`, `A new threat arrives from the far side of the galaxy: the ${capName(s.alienSpecies.name)}.`, 'alien');
      return;
    }
    if (inv.signal && s.time >= inv.next) {
      inv.waves++;
      inv.next = s.time + this.rng.range(240, 360);
      const n = 1 + Math.min(5, inv.waves);
      const targets = s.worlds.filter((w) => colonizable(w) && w.invaded < 0.9);
      targets.sort((a, b) => b.colony + (b.life ? 1 : 0) - (a.colony + (a.life ? 1 : 0)));
      const from = -1 - ((this.rng.next() * 1000) | 0);
      for (let i = 0; i < n && targets.length; i++) {
        const tg = targets[Math.min(targets.length - 1, (this.rng.next() * Math.min(3, targets.length)) | 0)];
        s.ships.push({ id: this.nid(), from, to: tg.id, t: -i * 0.8, dur: this.rng.range(18, 26), alien: true, kind: 'alien' });
      }
      const al = s.alienSpecies!.name;
      // From the third wave on, a mothership leads them, dropping out of warp.
      if (inv.waves >= 3 && targets.length) {
        s.ships.push({ id: this.nid(), from, to: targets[0].id, t: -2, dur: 34, alien: true, kind: 'mother', hp: 3 });
        const a = (Math.abs(from) * 2.399) % (Math.PI * 2);
        this.onFx({ kind: 'warpIn', x: Math.cos(a) * 110, z: Math.sin(a) * 110, dx: -Math.cos(a), dz: -Math.sin(a), count: n + 1, tint: 'alien' });
        this.news('⚠', `¡Una nave nodriza de los ${al} sale de la curvatura, escoltada por ${n} naves!`, `A ${capName(al)} mothership drops out of warp, escorted by ${n} ships!`, 'alien');
      } else this.news('⚠', `Naves de los ${al} entran en tu sistema. Buscan mundos donde quedarse.`, `Ships of the ${capName(al)} enter your system. They are looking for worlds to settle.`, 'alien');
    }
    // Settled visitors spread to nearby worlds.
    for (const w of s.worlds) {
      if (w.invaded < 0.6 || s.won) continue;
      let t = this.alienTimers.get(w.id) ?? this.rng.range(20, 35);
      t -= dt;
      if (t <= 0) {
        t = this.rng.range(28, 40);
        const tg = this.pickTarget(w, true);
        if (tg) this.launch(w.id, tg.id, true);
      }
      this.alienTimers.set(w.id, t);
      if (w.colony > 0) w.colony = Math.max(0, w.colony - w.invaded * 0.004 * dt);
    }
  }

  private alienArrives(w: World, mother = false) {
    const before = w.invaded;
    w.invaded = Math.min(1, w.invaded + (mother ? 0.85 : 0.4));
    const al = this.s.alienSpecies?.name ?? '';
    if (before < 0.5 && w.invaded >= 0.5)
      this.news('⚠', `Los ${al} se asientan en ${w.name}. Una llamarada solar podría expulsarlos.`, `The ${capName(al)} settle on ${w.name}. A solar flare could drive them out.`, 'alien');
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
    this.peoples.flared(w);
    const had = w.invaded;
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
