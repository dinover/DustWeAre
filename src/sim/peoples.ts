import type { Decision, GameState, People, Relation, Ship, World } from '../core/state';
import { Rng, clamp } from '../util';
import { colonizable } from './worlds';
import { capName, speciesName } from '../content/names';
import { worldXZ } from '../render/layout';
import type { CivFx } from './civ';
import { addHarm } from './voices';

/** What the peoples simulation needs from the system. */
export interface PeopleHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  world(id: number): World | undefined;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact'): void;
  fx(f: CivFx | PeopleFx): void;
}

export type PeopleFx =
  | { kind: 'raid'; world: number; ship: number; hit: boolean }
  | { kind: 'truce'; a: number; b: number }
  | { kind: 'settled'; world: number };

export const RELATION_TEXT = {
  peace: { es: 'en paz', en: 'at peace' },
  tension: { es: 'en tensión', en: 'tense' },
  war: { es: 'en guerra', en: 'at war' },
  alliance: { es: 'aliados', en: 'allied' },
};
export const RELATION_ICON = { peace: '·', tension: '⚡', war: '⚔', alliance: '⚭' };

/** Hues for peoples, far from the visitors' gold, teal and violet. */
const PEOPLE_HUES = [0.0, 0.31, 0.56, 0.64, 0.06, 0.21];

/** At most this many peoples share a system. */
export const MAX_PEOPLES = 4;

/** Id of the people living on a world (as natives or as a colony), or 0. */
export function peopleOf(w: World): number {
  if (w.owner && w.colony > 0) return w.owner;
  if (w.life?.people && w.life.stage >= 2) return w.life.people;
  return 0;
}

/** Two names woven into one, for a people born of two cultures. */
function blendNames(a: string, b: string) {
  const head = a.slice(0, Math.ceil(a.length / 2));
  const tail = b.slice(Math.floor(b.length / 2));
  return (head + tail).replace(/(.)\1\1+/g, '$1$1');
}

/**
 * The peoples of a system, all equal: the player is none of them. Every living world may give
 * rise to a people; they spread to other worlds, trade, quarrel, ally, mix into new peoples and
 * go to war — on their own. The player only watches, and may step in when asked.
 */
export class PeopleSim {
  private tmp = { x: 0, z: 0 };
  private byId = new Map<number, World>();

  constructor(private h: PeopleHost) {}

  get list(): People[] {
    return (this.h.s.peoples ??= []);
  }
  get relations(): Relation[] {
    return (this.h.s.relations ??= []);
  }
  alive() {
    return this.list.filter((p) => !p.gone);
  }
  get(id: number | undefined) {
    return id ? this.list.find((p) => p.id === id) : undefined;
  }

  /** Home world: the native world while life there lives, otherwise their first colony. */
  home(p: People | undefined) {
    if (!p) return undefined;
    const w = this.h.world(p.home);
    if (w && ((w.life?.people === p.id && w.life.stage >= 2) || (w.owner === p.id && w.colony > 0))) return w;
    return undefined;
  }

  /** Worlds where they live (home and colonies). */
  worldsOf(p: People) {
    return this.h.s.worlds.filter((w) => (w.life?.people === p.id && w.life.stage >= 2) || (w.owner === p.id && w.colony >= 1));
  }

  /** How far they have come: the stage of their home world (arrivals are already spacefaring). */
  stage(p: People) {
    const h = this.home(p);
    if (h?.life?.people === p.id) return h.life.stage;
    return p.arrived || p.parents ? 5 : 4;
  }

  /** The most advanced people (it builds the great works the player inspires). */
  leader() {
    let best: People | undefined;
    let score = -1;
    for (const p of this.alive()) {
      const sc = this.stage(p) * 100 + this.worldsOf(p).length;
      if (sc > score) {
        score = sc;
        best = p;
      }
    }
    return best;
  }

  relation(a: number, b: number) {
    return this.relations.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  }

  private pos(w: World) {
    this.byId.clear();
    for (const x of this.h.s.worlds) this.byId.set(x.id, x);
    return { ...worldXZ(w, this.byId, this.tmp) };
  }

  private add(p: Omit<People, 'id' | 'born' | 'nextShip'>) {
    const s = this.h.s;
    const id = this.list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    const people: People = { ...p, id, born: s.time, nextShip: s.time + 50 };
    for (const o of this.alive()) {
      this.relations.push({ a: o.id, b: id, mood: this.h.rng.range(-0.2, 0.3), state: 'peace', warT: 0, nextTalk: s.time + this.h.rng.range(60, 120), nextSkirmish: 0 });
    }
    this.list.push(people);
    return people;
  }

  /**
   * A colour far from the other peoples': red, green, sky, blue, orange or lime. Gold (traders),
   * teal (refugees) and violet (invaders) are kept for visitors.
   */
  private hue() {
    const used = this.alive().map((p) => p.hue);
    const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    let best = PEOPLE_HUES[0];
    let bd = -1;
    for (const h of this.h.rng.shuffle([...PEOPLE_HUES])) {
      const d = used.length ? Math.min(...used.map((u) => dist(u, h))) : 1;
      if (d > bd + 1e-6) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** A living world just reached intelligence: a new people is born. */
  emerge(w: World): boolean {
    if (this.alive().length >= MAX_PEOPLES || w.colony >= 1) return false;
    const legacy = this.h.s.legacySpecies;
    const name = legacy && !this.list.length ? legacy.name : speciesName(this.h.rng);
    const p = this.add({ name, hue: this.hue(), home: w.id });
    w.life!.people = p.id;
    const n = this.alive().length;
    if (n > 1)
      this.h.news(
        '✧',
        `En ${w.name} surge otro pueblo que mira las estrellas: los ${name}. Ya son ${n} pueblos en el sistema.`,
        `Another people that looks up at the stars arises on ${w.name}: the ${capName(name)}. There are now ${n} peoples in the system.`,
        'life',
      );
    else this.h.news('✧', `En ${w.name} surge un pueblo que se pregunta por las estrellas: los ${name}.`, `A people that wonders about the stars arises on ${w.name}: the ${capName(name)}.`, 'life');
    return true;
  }

  /** A people arriving from another star (an ark, refugees) settles a world. */
  newcomers(name: string, hue: number | null, w: World) {
    if (this.alive().length >= MAX_PEOPLES) return null;
    const p = this.add({ name, hue: hue ?? this.hue(), home: w.id, arrived: true });
    w.owner = p.id;
    w.colony = 1;
    return p;
  }

  /** Stage messages for a people. */
  advance(w: World, stage: number) {
    const p = this.get(w.life?.people);
    if (!p) return;
    const n = capName(p.name);
    if (stage === 3) this.h.news('⌂', `Los ${p.name} construyen ciudades en ${w.name}: sus luces ya se ven desde el espacio.`, `The ${n} build cities on ${w.name}: their lights can now be seen from space.`, 'life');
    if (stage === 4) this.h.news('◎', `Los ${p.name} ponen en órbita su primer satélite.`, `The ${n} launch their first satellite.`, 'good');
    if (stage === 5) this.h.news('⇄', `Los ${p.name} ya viajan entre mundos.`, `The ${n} now travel between worlds.`, 'good');
  }

  /** A world nobody has claimed yet. */
  free(w: World) {
    return colonizable(w) && w.colony <= 0 && !w.guest && !(w.life && w.life.stage >= 2) && w.invaded < 0.5;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    for (const p of this.alive()) {
      const worlds = this.worldsOf(p);
      if (!worlds.length) {
        // Not even a half-built colony left: the people is gone.
        if (this.h.s.worlds.some((w) => w.owner === p.id && w.colony > 0)) continue;
        p.gone = true;
        for (const r of this.relations) if (r.a === p.id || r.b === p.id) r.state = 'peace';
        this.h.news('✝', `Los ${p.name} desaparecen como pueblo. Su memoria queda en los archivos de otros.`, `The ${capName(p.name)} vanish as a people. Their memory lives on in the archives of others.`, 'warn');
        continue;
      }
      // Lost their home: the oldest colony takes its place.
      if (!this.home(p)) p.home = worlds[0].id;
      const h = this.home(p);
      if (h?.life?.people === p.id && h.life.stage === 4 && worlds.some((w) => w.owner === p.id && w.colony >= 1)) {
        h.life.stage = 5;
        this.advance(h, 5);
      }
    }
    for (const r of this.relations) this.relate(r, dt);
  }

  // ------------------------------------------------------------------ diplomacy among peoples
  private relate(r: Relation, dt: number) {
    const s = this.h.s;
    const a = this.get(r.a);
    const b = this.get(r.b);
    if (!a || !b || a.gone || b.gone) return;
    // They only meet once both can cross space.
    if (!r.met) {
      if (this.stage(a) < 4 || this.stage(b) < 4) return;
      r.met = true;
      r.nextTalk = s.time + this.h.rng.range(50, 90);
      this.h.news('✶', `Los ${a.name} y los ${b.name} se encuentran por primera vez entre los mundos.`, `The ${capName(a.name)} and the ${capName(b.name)} meet for the first time between the worlds.`, 'info');
      return;
    }
    const rng = this.h.rng;
    if (r.state === 'war') r.warT += dt;
    else r.mood = clamp(r.mood + (r.state === 'alliance' ? 0.0025 : -r.mood * 0.002) * dt, -1, 1);
    if (r.state !== 'war' && r.state !== 'alliance') r.state = r.mood < -0.3 ? 'tension' : 'peace';
    // Allies trade all the time.
    if (r.state === 'alliance' && rng.next() < dt * 0.05) this.tradeShip(a, b);
    if (r.state === 'war' && s.time >= r.nextSkirmish) {
      r.nextSkirmish = s.time + rng.range(16, 26);
      this.raid(a, b);
    }
    if (s.time < r.nextTalk) return;
    r.nextTalk = s.time + rng.range(70, 120);
    const civ = s.civ;
    const ask = (d: Decision) => {
      if (civ && civ.decisions.length < 2) civ.decisions.push(d);
    };
    const A = capName(a.name);
    const B = capName(b.name);
    if (r.state === 'war') {
      if (r.warT > 150 && rng.next() < 0.5) this.peace(r, a, b, false);
      return;
    }
    if (r.mood < -0.6) {
      this.war(r, a, b);
      ask({ id: this.h.nid(), kind: 'war', pair: [a.id, b.id], left: 40, dur: 40 });
      return;
    }
    const roll = rng.next();
    if (roll < 0.35) {
      r.mood = clamp(r.mood - rng.range(0.15, 0.3), -1, 1);
      const pick = rng.pick([
        { es: `Una nave de los ${a.name} y otra de los ${b.name} chocan en una ruta disputada. Cada uno culpa al otro.`, en: `A ${A} ship and a ${B} ship collide on a disputed route. Each blames the other.` },
        { es: `Los ${a.name} acusan a los ${b.name} de espiar sus astilleros.`, en: `The ${A} accuse the ${B} of spying on their shipyards.` },
        { es: `Una disputa por el hielo de un cometa enfrenta a los ${a.name} y los ${b.name}.`, en: `A dispute over a comet's ice sets the ${A} against the ${B}.` },
      ]);
      this.h.news('⚡', pick.es, pick.en, 'warn');
      if (r.mood < -0.25 && rng.next() < 0.6) ask({ id: this.h.nid(), kind: 'tension', pair: [a.id, b.id], left: 40, dur: 40 });
    } else if (roll < 0.72) {
      r.mood = clamp(r.mood + rng.range(0.1, 0.2), -1, 1);
      const pick = rng.pick([
        { es: `Músicos ${a.name} y ${b.name} tocan juntos a través del vacío.`, en: `${A} and ${B} musicians play together across the void.` },
        { es: `Científicos ${a.name} y ${b.name} estudian juntos la estrella que comparten.`, en: `${A} and ${B} scientists study the star they share, together.` },
        { es: `Una boda entre una diplomática ${a.name} y un piloto ${b.name} es noticia en todo el sistema.`, en: `A wedding between an ${A} diplomat and a ${B} pilot makes news across the system.` },
        { es: `Los ${a.name} aprenden a cocinar como los ${b.name}. Nadie se pone de acuerdo con las especias.`, en: `The ${A} learn to cook like the ${B}. Nobody agrees on the spices.` },
      ]);
      this.h.news('❧', pick.es, pick.en, 'info');
    } else if (r.state === 'peace' && r.mood > 0.4) {
      r.state = 'alliance';
      r.mood = clamp(r.mood + 0.15, -1, 1);
      this.h.news('⚭', `Los ${a.name} y los ${b.name} firman una alianza: comparten rutas, ciencia y defensa.`, `The ${A} and the ${B} sign an alliance: they share routes, science and defence.`, 'good');
    } else if (r.state === 'alliance' && r.mood > 0.5 && !r.mixed && this.alive().length < MAX_PEOPLES) {
      this.mix(r, a, b);
    }
  }

  /** Two peoples who have lived side by side long enough give rise to a new one. */
  private mix(r: Relation, a: People, b: People) {
    const candidates = [...this.worldsOf(a), ...this.worldsOf(b)].filter((w) => w.colony >= 1 && w.owner && w.id !== a.home && w.id !== b.home);
    if (!candidates.length) return;
    const w = this.h.rng.pick(candidates);
    r.mixed = true;
    const name = blendNames(a.name, b.name);
    const p = this.add({ name, hue: this.hue(), home: w.id, parents: [a.id, b.id] });
    w.owner = p.id;
    w.colony = 1;
    for (const id of [a.id, b.id]) {
      const rel = this.relation(p.id, id);
      if (rel) {
        rel.mood = 0.55;
        rel.state = 'alliance';
        rel.met = true;
      }
    }
    this.h.news(
      '❦',
      `En ${w.name}, ${a.name} y ${b.name} conviven desde hace siglos. De esa mezcla nace un pueblo nuevo: los ${name}.`,
      `On ${w.name}, the ${capName(a.name)} and the ${capName(b.name)} have lived together for centuries. From that blend a new people is born: the ${capName(name)}.`,
      'life',
    );
  }

  private war(r: Relation, a: People, b: People) {
    r.state = 'war';
    r.warT = 0;
    r.nextSkirmish = this.h.s.time + 8;
    this.h.news('⚔', `¡Guerra! Los ${a.name} y los ${b.name} toman las armas.`, `War! The ${capName(a.name)} and the ${capName(b.name)} take up arms.`, 'alien');
  }

  private peace(r: Relation, a: People, b: People, imposed: boolean) {
    r.state = 'peace';
    r.warT = 0;
    r.ignored = false;
    r.mood = imposed ? -0.15 : 0.05;
    this.h.s.ships = this.h.s.ships.filter((x) => !(x.kind === 'raider' && (x.people === a.id || x.people === b.id)));
    if (imposed) {
      this.h.fx({ kind: 'truce', a: a.id, b: b.id });
      this.h.news('☀', `La estrella brilla con furia entre los ${a.name} y los ${b.name}: sus flotas se retiran. Hay tregua, por ahora.`, `The star blazes between the ${capName(a.name)} and the ${capName(b.name)}: their fleets pull back. There is a truce, for now.`, 'good');
    } else this.h.news('☮', `Los ${a.name} y los ${b.name} firman la paz. Las naves vuelven a casa.`, `The ${capName(a.name)} and the ${capName(b.name)} sign a peace. The ships head home.`, 'good');
  }

  /** The Space Patrols end a war their own way. Returns false when there was no war to end. */
  enforcePeace(ia: number, ib: number) {
    const a = this.get(ia);
    const b = this.get(ib);
    const r = this.relation(ia, ib);
    if (!a || !b || !r || r.state !== 'war') return false;
    r.state = 'peace';
    r.warT = 0;
    r.ignored = false;
    r.mood = -0.25;
    this.h.s.ships = this.h.s.ships.filter((x) => !(x.kind === 'raider' && (x.people === a.id || x.people === b.id)));
    this.h.fx({ kind: 'truce', a: a.id, b: b.id });
    this.h.news(
      '⛨',
      `Los Space Patrols imponen la paz entre los ${a.name} y los ${b.name} a punta de bólter. Nadie se atreve a protestar… todavía.`,
      `The Space Patrols impose peace between the ${capName(a.name)} and the ${capName(b.name)} at bolter-point. Nobody dares to complain… yet.`,
      'warn',
    );
    return true;
  }

  /** Every war ends at once: the star's light forces a truce on all of them. */
  truceAll() {
    let n = 0;
    for (const r of this.wars()) {
      const a = this.get(r.a);
      const b = this.get(r.b);
      if (!a || !b) continue;
      this.peace(r, a, b, true);
      n++;
    }
    return n;
  }

  /** The player's answer to a request to step in. */
  decide(d: Decision, accept: boolean) {
    const s = this.h.s;
    const [ia, ib] = d.pair ?? [0, 0];
    const a = this.get(ia);
    const b = this.get(ib);
    const r = a && b ? this.relation(a.id, b.id) : undefined;
    if (r && !accept) {
      // Choosing to let a war run its course weighs on the player.
      if (d.kind === 'war') {
        r.ignored = true;
        addHarm(s, 5);
      } else addHarm(s, 1.5);
    }
    if (r && accept) addHarm(s, d.kind === 'war' ? -5 : -2);
    if (!a || !b || !r || !accept) return;
    if (d.kind === 'tension' && s.energy >= 25) {
      s.energy -= 25;
      r.mood = clamp(r.mood + 0.35, -1, 1);
      this.h.news('☀', `Una aurora inesperada ilumina a los ${a.name} y los ${b.name}. Lo toman como una señal y se calman.`, `An unexpected aurora lights up the ${capName(a.name)} and the ${capName(b.name)}. They take it as a sign and calm down.`, 'good');
    } else if (d.kind === 'war' && s.energy >= 40 && r.state === 'war') {
      s.energy -= 40;
      this.peace(r, a, b, true);
    }
  }

  // ------------------------------------------------------------------ ships between peoples
  private ship(from: World, to: World, people: number, kind: 'freight' | 'raider', extra: Partial<Ship> = {}) {
    const a = this.pos(from);
    const b = this.pos(to);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    this.h.s.ships.push({ id: this.h.nid(), from: from.id, to: to.id, t: 0, dur: 7 + d * 0.24, alien: false, kind, people, ...extra });
  }

  private tradeShip(a: People, b: People) {
    const wa = this.worldsOf(a);
    const wb = this.worldsOf(b);
    if (!wa.length || !wb.length || this.h.s.ships.length > 44) return;
    const fromA = this.h.rng.next() < 0.5;
    this.ship(fromA ? this.h.rng.pick(wa) : this.h.rng.pick(wb), fromA ? this.h.rng.pick(wb) : this.h.rng.pick(wa), fromA ? a.id : b.id, 'freight');
  }

  /** Raiders leave from one side to strike a world of the other. */
  private raid(a: People, b: People) {
    const rng = this.h.rng;
    const att = rng.next() < 0.5 ? a : b;
    const def = att === a ? b : a;
    const from = this.worldsOf(att);
    const to = this.worldsOf(def);
    if (!from.length || !to.length) return;
    const src = rng.pick(from);
    const dst = rng.pick(to);
    for (let k = 0; k < 3; k++) this.ship(src, dst, att.id, 'raider', { t: -k * 0.6 });
  }

  /** A people's colony ship reached its target. Returns true when handled here. */
  arrive(sh: Ship): boolean {
    const w = this.h.world(sh.to);
    if (sh.kind === 'raider') {
      if (w) this.raidHits(sh, w);
      return true;
    }
    if ((sh.kind ?? 'colony') !== 'colony' || sh.alien || !w) return false;
    const pid = sh.people ?? this.leader()?.id;
    const p = this.get(pid);
    if (!p) return false;
    if (w.colony >= 1 || (w.colony > 0 && w.owner !== p.id) || (w.life && w.life.stage >= 2)) return true;
    w.owner = p.id;
    w.colony = Math.min(1, w.colony + 0.34);
    w.invaded = Math.max(0, w.invaded - 0.15);
    if (w.colony >= 1) {
      this.h.fx({ kind: 'settled', world: w.id });
      const first = this.h.s.worlds.filter((x) => x.owner === p.id && x.colony >= 1).length === 1;
      if (w.gas / Math.max(1e-6, w.metal + w.rock + w.water + w.gas + w.org) > 0.3)
        this.h.news('⌂', `Los ${p.name} levantan ciudades flotantes en las nubes de ${w.name}.`, `The ${capName(p.name)} raise floating cities in the clouds of ${w.name}.`, 'good');
      else
        this.h.news(
          '⌂',
          `Los ${p.name} fundan una colonia en ${w.name}${first ? ': su primer hogar fuera de casa' : ''}.`,
          `The ${capName(p.name)} found a colony on ${w.name}${first ? ': their first home away from home' : ''}.`,
          'good',
        );
    }
    return true;
  }

  private raidHits(sh: Ship, w: World) {
    const s = this.h.s;
    const att = this.get(sh.people);
    const defId = peopleOf(w);
    const def = this.get(defId);
    if (!att || !def || defId === att.id) return;
    const defence = 0.4 + 0.05 * Math.max(0, this.stage(def) - 4) + (s.civ?.done.shield ? 0.08 : 0);
    const hit = this.h.rng.next() > defence;
    this.h.fx({ kind: 'raid', world: w.id, ship: sh.id, hit });
    if (!hit) return;
    // A native home world is not taken: its people suffer, but hold.
    if (w.life?.people === defId) {
      w.life.health -= 0.02;
      return;
    }
    w.colony = Math.max(0, w.colony - 0.15);
    if (w.colony <= 0.001) {
      w.colony = 0.4;
      w.owner = att.id;
      this.h.news('⚔', `${w.name} cae en manos de los ${att.name}. Los ${def.name} la han perdido.`, `${w.name} falls to the ${capName(att.name)}. The ${capName(def.name)} have lost it.`, 'warn');
    }
  }

  wars() {
    return this.relations.filter((r) => r.state === 'war' && !this.get(r.a)?.gone && !this.get(r.b)?.gone);
  }
}

/** Saves from before the peoples were equals: turn "your species" and the "rivals" into peoples. */
export function migratePeoples(s: GameState) {
  if (s.peoples) return;
  s.peoples = [];
  s.relations = [];
  const rivals = s.rivals ?? [];
  const shift = s.species ? 1 : 0;
  for (const w of s.worlds) {
    if (w.owner) w.owner += shift;
    else if (w.colony > 0 && s.species) w.owner = 1;
    if (w.life?.people) w.life.people += shift;
  }
  if (s.species) {
    const home = s.worlds.find((w) => w.life?.origin && !w.life.people && w.life.stage >= 2) ?? s.worlds.find((w) => w.owner === 1 && w.colony >= 1);
    if (home?.life && !home.life.people && home.life.stage >= 2) home.life.people = 1;
    s.peoples.push({ id: 1, name: s.species.name, hue: s.species.hue, home: home?.id ?? -1, born: 0, nextShip: 0, arrived: !home?.life });
  }
  rivals.forEach((r, i) => {
    const id = i + 1 + shift;
    s.peoples!.push({ id, name: r.name, hue: r.hue, home: r.home, born: 0, nextShip: r.nextShip });
    if (s.species) s.relations!.push({ a: 1, b: id, mood: r.mood, state: r.relation, warT: r.warT, nextTalk: r.nextTalk, nextSkirmish: r.nextSkirmish, met: true });
  });
  s.rivals = undefined;
  for (const sh of s.ships) if (!sh.people && !sh.alien && s.species) sh.people = 1;
  if (s.civ) s.civ.decisions = s.civ.decisions.filter((d) => d.kind !== 'incident' && d.kind !== 'alliance' && d.kind !== 'peace');
}
