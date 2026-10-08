import type { GameState, OuterStar, Resources, Risk, WingSize, WingsState } from '../core/state';
import { clamp, type Rng } from '../util';
import type { Bi } from '../i18n';
import type { CivFx, CivSim } from './civ';
import type { PeopleFx, PeopleSim } from './peoples';
import { RISK_RANK, troubleRisk, type PatrolFx, type PatrolSim } from './patrols';

export const WING_SIZES: WingSize[] = ['S', 'M', 'L'];
/** Ships in a sortie of each size, and the fuel it burns to jump. */
export const WING_UNITS: Record<WingSize, number> = { S: 6, M: 12, L: 20 };
export const WING_COST: Record<WingSize, Partial<Resources>> = { S: { fuel: 20 }, M: { fuel: 35 }, L: { fuel: 55 } };
const SIZE_RANK: Record<WingSize, number> = { S: 1, M: 2, L: 3 };
/** Seconds of peace that triple the wings' recruiting. */
const PEACE_FULL = 1200;
/** Developing the Freedom Wings, a technology that needs the warp drive. */
export const WINGS_TECH: Partial<Resources> = { science: 450, metal: 150, fuel: 120 };
/** Ships in a batch bought with science, and its price: dear, and dearer with every batch. */
export const BUY_SHIPS = 5;
export const buyCost = (bought: number): Partial<Resources> => ({ science: Math.round((260 * Math.pow(1.22, bought)) / 5) * 5 });

/**
 * What a sortie of this size can expect against this risk: S for low risks, M for medium, L for
 * high. A bigger fleet than needed wins sooner and loses fewer ships; a smaller one may not come back.
 */
export function wingOdds(size: WingSize, risk: Risk) {
  const d = SIZE_RANK[size] - RISK_RANK[risk];
  return {
    diff: d,
    win: d >= 1 ? 0.97 : d === 0 ? 0.85 : d === -1 ? 0.4 : 0.1,
    /** Share of the sortie lost when it wins, and when it loses. */
    lossWin: d >= 2 ? 0.04 : d === 1 ? 0.1 : d === 0 ? 0.22 : d === -1 ? 0.45 : 0.7,
    lossLose: d >= 0 ? 0.4 : d === -1 ? 0.7 : 1,
    /** Seconds the fight lasts. */
    dur: 45 - 10 * Math.max(0, d),
  };
}

/** What the Freedom Wings need from the system. */
export interface WingsHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact'): void;
  fx(f: CivFx | PeopleFx | PatrolFx): void;
  readonly peoples: PeopleSim;
  readonly civ: CivSim;
  readonly patrols: PatrolSim;
}

const RES: (keyof Resources)[] = ['metal', 'fuel', 'water', 'science'];
const has = (r: Resources, c: Partial<Resources>) => RES.every((k) => r[k] >= (c[k] ?? 0));
const pay = (r: Resources, c: Partial<Resources>) => RES.forEach((k) => (r[k] -= c[k] ?? 0));

/**
 * The Freedom Wings: squadrons of volunteers from every people, apart from the Space Patrols. A
 * technology to develop once warp travel exists; from then on ships gather on their own — a trickle
 * from every people, more for every living world, far more while the peoples are at peace — and
 * more can be bought with science, at a steep price. They defend the distant colonies: won battles
 * bring new volunteers, lost ones cost ships, and a small sortie sent against a great danger may
 * never come back.
 */
export class WingsSim {
  constructor(private h: WingsHost) {}

  get wings(): WingsState | null {
    return this.h.s.wings ?? null;
  }

  /** Worlds with life: where the volunteers come from. */
  living() {
    return this.h.s.worlds.filter((w) => w.life).length;
  }

  /** New ships per minute right now: a trickle from every people, more for each living world, up to three times as many after a long peace. */
  rate() {
    const g = this.wings;
    if (!g) return 0;
    const war = this.h.peoples.wars().length > 0;
    return (1 + this.living() * 0.6) * (war ? 0.25 : 1 + Math.min(2, (2 * g.peace) / PEACE_FULL));
  }

  /** The most ships the system can keep. */
  cap() {
    return 30 + 10 * this.living();
  }

  update(dt: number) {
    const s = this.h.s;
    if (!s.civ || !s.wings) return;
    const g = s.wings;
    if (this.h.peoples.wars().length) g.peace = 0;
    else g.peace += dt;
    if (g.units < this.cap()) {
      g.grow += (this.rate() / 60) * dt;
      while (g.grow >= 1) {
        g.grow -= 1;
        g.units = Math.min(this.cap(), g.units + 1);
      }
    } else g.grow = 0;
    for (const o of [...g.sorties]) {
      o.t += dt;
      if (o.t >= o.dur) this.back(o);
    }
  }

  /** Why the Freedom Wings cannot be developed right now (null: they can). */
  unlockLock(): Bi | null {
    const civ = this.h.s.civ;
    if (this.wings) return { es: 'Ya están en servicio.', en: 'Already in service.' };
    if (!civ) return { es: 'Primero, una civilización.', en: 'First, a civilization.' };
    if (!civ.done.warp) return { es: 'Necesita el motor de curvatura.', en: 'Needs the warp drive.' };
    if (!has(civ.res, WINGS_TECH)) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  /** Develops the technology: the shipyards start gathering squadrons. */
  unlock() {
    const s = this.h.s;
    if (!s.civ || this.unlockLock()) return false;
    pay(s.civ.res, WINGS_TECH);
    s.wings = { units: 0, born: s.time, peace: 0, grow: 0, won: 0, lost: 0, bought: 0, sorties: [] };
    this.h.news(
      '✈',
      'Nacen las Freedom Wings: astilleros libres arman escuadrillas con voluntarios de todos los pueblos para defender las colonias lejanas. Cada mundo con vida y cada año de paz sumarán naves.',
      'The Freedom Wings are born: free shipyards build squadrons with volunteers from every people to defend the distant colonies. Every living world and every year of peace will add ships.',
      'good',
    );
    return true;
  }

  /** Why ships cannot be bought right now (null: they can). */
  buyLock(): Bi | null {
    const g = this.wings;
    const civ = this.h.s.civ;
    if (!g || !civ) return { es: 'Primero hay que desarrollar las Freedom Wings.', en: 'The Freedom Wings must be developed first.' };
    if (g.units >= this.cap()) return { es: 'Los hangares están llenos.', en: 'The hangars are full.' };
    if (!has(civ.res, buyCost(g.bought ?? 0))) return { es: 'Falta ciencia.', en: 'Not enough science.' };
    return null;
  }

  /** Buys a batch of ships with science. */
  buy() {
    const g = this.wings;
    const civ = this.h.s.civ;
    if (!g || !civ || this.buyLock()) return false;
    pay(civ.res, buyCost(g.bought ?? 0));
    g.bought = (g.bought ?? 0) + 1;
    g.units = Math.min(this.cap(), g.units + BUY_SHIPS);
    return true;
  }

  /** Why a sortie of this size cannot leave for that star (null: it can). */
  lock(st: OuterStar, size: WingSize): Bi | null {
    const g = this.wings;
    const civ = this.h.s.civ;
    if (!g) return { es: 'Aún no existen las Freedom Wings: llegan con el motor de curvatura.', en: 'The Freedom Wings do not exist yet: they come with the warp drive.' };
    if (!st.trouble) return { es: 'Esa colonia está en calma.', en: 'That colony is calm.' };
    if (st.wing) return { es: 'Ya hay una escuadrilla luchando allí.', en: 'A squadron is already fighting there.' };
    if (st.strike) return { es: 'Los Space Patrols ya van hacia allí.', en: 'The Space Patrols are already on their way.' };
    const n = WING_UNITS[size];
    if (g.units < n) return { es: `Faltan naves: hacen falta ${n} y hay ${g.units}.`, en: `Not enough ships: it takes ${n} and there are ${g.units}.` };
    if (!civ || !has(civ.res, WING_COST[size])) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  /** Where the squadrons take off from and come back to. */
  private base() {
    const home = this.h.civ.home();
    return home ? this.h.civ.pos(home) : { x: 30, z: 0 };
  }

  send(id: number, size: WingSize) {
    const s = this.h.s;
    const g = this.wings;
    const st = this.h.patrols.star(id);
    if (!g || !st || !s.civ || this.lock(st, size)) return false;
    const risk = troubleRisk(st) ?? 'low';
    const n = WING_UNITS[size];
    pay(s.civ.res, WING_COST[size]);
    g.units -= n;
    g.sorties.push({ id: this.h.nid(), star: st.id, size, units: n, t: 0, dur: wingOdds(size, risk).dur });
    st.wing = { size, units: n };
    const b = this.base();
    this.h.fx({ kind: 'warpOut', x: b.x, z: b.z, dx: Math.cos(st.ang), dz: Math.sin(st.ang), count: Math.min(8, Math.ceil(n / 3)), tint: 'wings' });
    this.h.news('✈', `Una escuadrilla ${size} de las Freedom Wings (${n} naves) salta hacia ${st.name}.`, `A size ${size} Freedom Wings squadron (${n} ships) jumps to ${st.name}.`, 'info');
    return true;
  }

  /** A sortie comes home: how many ships, and with what news. */
  private back(o: WingsState['sorties'][number]) {
    const g = this.wings!;
    const rng = this.h.rng;
    g.sorties.splice(g.sorties.indexOf(o), 1);
    const st = this.h.patrols.star(o.star);
    if (st) st.wing = null;
    const b = this.base();
    const len = Math.hypot(b.x, b.z) || 1;
    this.h.fx({ kind: 'warpIn', x: b.x, z: b.z, dx: -b.x / len, dz: -b.z / len, count: Math.min(8, Math.ceil(o.units / 3)), tint: 'wings' });
    const risk = st ? troubleRisk(st) : null;
    if (!st || !risk) {
      g.units += o.units;
      this.h.news('✈', `La escuadrilla de las Freedom Wings vuelve sin combatir: ya no había nada que defender.`, `The Freedom Wings squadron comes back without a fight: there was nothing left to defend.`, 'info');
      return;
    }
    const odds = wingOdds(o.size, risk);
    const win = rng.next() < odds.win;
    const share = win ? odds.lossWin : odds.lossLose;
    const lost = share >= 1 ? o.units : clamp(Math.round(o.units * share * rng.range(0.8, 1.2)), 0, o.units);
    const home = o.units - lost;
    if (win) {
      const recruits = RISK_RANK[risk] * 2 + rng.int(0, 2);
      g.units += home + recruits;
      g.won++;
      this.h.patrols.liberate(st);
      this.h.news(
        '✈',
        `Las Freedom Wings vencen en ${st.name}: ${lost ? `pierden ${lost} ${lost === 1 ? 'nave' : 'naves'}, pero` : 'sin bajas, y'} ${recruits} voluntarios liberados se suman a sus filas.`,
        `The Freedom Wings win at ${st.name}: ${lost ? `they lose ${lost} ${lost === 1 ? 'ship' : 'ships'}, but` : 'with no losses, and'} ${recruits} freed volunteers join their ranks.`,
        'good',
      );
      return;
    }
    g.units += home;
    g.lost++;
    st.health = Math.max(0.1, st.health - 0.2);
    if (st.trouble) st.trouble.dur += 30;
    if (home)
      this.h.news('✈', `Las Freedom Wings son derrotadas en ${st.name}: solo vuelven ${home} de ${o.units} naves.`, `The Freedom Wings are beaten at ${st.name}: only ${home} of ${o.units} ships come back.`, 'warn');
    else this.h.news('✈', `La escuadrilla de las Freedom Wings no vuelve de ${st.name}: se pierden sus ${o.units} naves.`, `The Freedom Wings squadron never comes back from ${st.name}: all ${o.units} ships are lost.`, 'warn');
  }
}
