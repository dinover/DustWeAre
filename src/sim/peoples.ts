import type { Decision, GameState, Rival, Ship, World } from '../core/state';
import { Rng, clamp } from '../util';
import { colonizable, isGiantStuff } from './worlds';
import { capName, speciesName } from '../content/names';
import { worldXZ } from '../render/layout';
import type { CivFx } from './civ';

/** What the peoples simulation needs from the system. */
export interface PeopleHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  world(id: number): World | undefined;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact'): void;
  fx(f: CivFx | PeopleFx): void;
  readonly origin: World | null;
}

export type PeopleFx = { kind: 'raid'; world: number; ship: number; hit: boolean } | { kind: 'siege'; world: number };

export const RELATION_TEXT = {
  peace: { es: 'en paz', en: 'at peace' },
  tension: { es: 'en tensión', en: 'tense' },
  war: { es: 'en guerra', en: 'at war' },
  alliance: { es: 'aliados', en: 'allied' },
};

/** Index (1-based) of the rival people owning a world, or 0. */
export function rivalOf(w: World): number {
  if (w.owner && w.colony > 0) return w.owner;
  if (w.life?.people && w.life.stage >= 2) return w.life.people;
  return 0;
}

/**
 * Other peoples of the same system. Every living world keeps evolving; when a second (or third)
 * world gives rise to intelligence, it becomes a neighbour with its own colonies and ships —
 * and with moods: they may trade, sign alliances, quarrel or go to war with your species.
 */
export class PeopleSim {
  private tmp = { x: 0, z: 0 };
  private byId = new Map<number, World>();

  constructor(private h: PeopleHost) {}

  get rivals() {
    return (this.h.s.rivals ??= []);
  }

  rival(i: number): Rival | undefined {
    return this.rivals[i - 1];
  }

  home(i: number) {
    const r = this.rival(i);
    const w = r ? this.h.world(r.home) : undefined;
    return w?.life?.people === i ? w : undefined;
  }

  private pos(w: World) {
    this.byId.clear();
    for (const x of this.h.s.worlds) this.byId.set(x.id, x);
    return { ...worldXZ(w, this.byId, this.tmp) };
  }

  /** A living world just reached intelligence while your species already exists. */
  emerge(w: World): boolean {
    if (this.rivals.length >= 2 || w.colony >= 1) return false;
    const rng = this.h.rng;
    const name = speciesName(rng);
    const hue = rng.next() < 0.5 ? rng.range(0.55, 0.66) : rng.range(0.02, 0.09);
    this.rivals.push({ name, hue, home: w.id, mood: rng.range(-0.15, 0.25), relation: 'peace', warT: 0, nextTalk: this.h.s.time + 120, nextShip: this.h.s.time + 60, nextSkirmish: 0 });
    w.life!.people = this.rivals.length;
    const mine = this.h.s.species?.name ?? '';
    this.h.news(
      '✧',
      `En ${w.name} surge otra especie que mira las estrellas: los ${name}. Los ${mine} ya no están solos en el sistema.`,
      `Another species that looks up at the stars arises on ${w.name}: the ${capName(name)}. The ${capName(mine)} are no longer alone in the system.`,
      'life',
    );
    return true;
  }

  /** Stage messages for a rival people. */
  advance(w: World, stage: number) {
    const r = this.rival(w.life?.people ?? 0);
    if (!r) return;
    const n = capName(r.name);
    if (stage === 3) this.h.news('⌂', `Los ${r.name} construyen ciudades en ${w.name}.`, `The ${n} build cities on ${w.name}.`, 'life');
    if (stage === 4) this.h.news('◎', `Los ${r.name} ponen en órbita su primer satélite.`, `The ${n} launch their first satellite.`, 'info');
    if (stage === 5) this.h.news('⇄', `Los ${r.name} ya viajan entre mundos.`, `The ${n} now travel between worlds.`, 'info');
  }

  /** A world nobody has claimed yet (for anyone's colonists). */
  free(w: World) {
    return colonizable(w) && w.colony <= 0 && !w.guest && !(w.life && w.life.stage >= 2) && w.invaded < 0.5;
  }

  update(dt: number) {
    const s = this.h.s;
    for (let k = 0; k < this.rivals.length; k++) {
      const i = k + 1;
      const r = this.rivals[k];
      const home = this.home(i);
      if (!home) continue;
      const stage = home.life!.stage;
      if (stage >= 4 && home.sats < 8 && this.h.rng.next() < dt * 0.06) home.sats++;
      // They spread to free worlds.
      if (stage >= 4 && s.time >= r.nextShip) {
        r.nextShip = s.time + this.h.rng.range(22, 34);
        const target = this.nearestFree(home);
        if (target && s.ships.filter((x) => x.people === i && x.to === target.id).length < 2) this.ship(home, target, i, 'colony');
        if (stage === 4 && s.worlds.some((w) => w.owner === i && w.colony >= 1)) {
          home.life!.stage = 5;
          this.advance(home, 5);
        }
      }
      this.relations(r, i, home, dt);
    }
  }

  private nearestFree(from: World) {
    const p = this.pos(from);
    let best: World | null = null;
    let bd = Infinity;
    for (const w of this.h.s.worlds) {
      if (!this.free(w)) continue;
      const q = this.pos(w);
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  private ship(from: World, to: World, people: number, kind: 'colony' | 'freight' | 'raider', extra: Partial<Ship> = {}) {
    const a = this.pos(from);
    const b = this.pos(to);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    this.h.s.ships.push({ id: this.h.nid(), from: from.id, to: to.id, t: 0, dur: 7 + d * 0.24, alien: false, kind, people, ...extra });
  }

  /** A ship of a rival people (or a raider of yours) reached its destination. */
  arrive(sh: Ship): boolean {
    const w = this.h.world(sh.to);
    if (!w) return !!sh.people;
    if (sh.kind === 'raider') {
      this.raidHits(sh, w);
      return true;
    }
    if (!sh.people) return false;
    if (sh.kind === 'colony') {
      if (w.colony > 0 && w.owner !== sh.people) return true;
      w.owner = sh.people;
      w.colony = Math.min(1, w.colony + 0.34);
      const r = this.rival(sh.people);
      if (w.colony >= 1 && r) this.h.news('⌂', `Los ${r.name} fundan una colonia en ${w.name}.`, `The ${capName(r.name)} found a colony on ${w.name}.`, 'info');
    }
    return true;
  }

  // ------------------------------------------------------------------ diplomacy
  private relations(r: Rival, i: number, home: World, dt: number) {
    const s = this.h.s;
    const civ = s.civ;
    if (!civ || !s.species) return;
    const rng = this.h.rng;
    const mine = s.species.name;
    if (r.relation === 'war') r.warT += dt;
    else r.mood = clamp(r.mood + (r.relation === 'alliance' ? 0.002 : -r.mood * 0.002) * dt, -1, 1);
    if (r.relation !== 'war' && r.relation !== 'alliance') r.relation = r.mood < -0.3 ? 'tension' : 'peace';
    // Allies trade with you.
    if (r.relation === 'alliance' && rng.next() < dt * 0.06) {
      const ours = this.h.origin ?? s.worlds.find((w) => w.colony >= 1 && !w.owner);
      if (ours) this.ship(rng.next() < 0.5 ? home : ours, rng.next() < 0.5 ? ours : home, i, 'freight');
    }
    // War: raids back and forth.
    if (r.relation === 'war' && s.time >= r.nextSkirmish) {
      r.nextSkirmish = s.time + rng.range(16, 26);
      this.raid(i, home);
    }
    if (s.time < r.nextTalk || civ.decisions.length >= 2) return;
    r.nextTalk = s.time + rng.range(80, 130);
    if (r.relation === 'war') {
      if (r.warT > 120 && rng.next() < 0.6) civ.decisions.push(this.decision('peace', i));
      return;
    }
    if (r.mood < -0.55) {
      this.declareWar(i, r);
      return;
    }
    const roll = rng.next();
    if (r.relation !== 'alliance' && r.mood > 0.2 && roll < 0.45) civ.decisions.push(this.decision('alliance', i));
    else if (roll < 0.75) civ.decisions.push(this.decision('incident', i));
    else {
      r.mood = clamp(r.mood + 0.08, -1, 1);
      const w = home.name;
      const pick = rng.pick([
        { es: `Los ${r.name} envían a ${w} a sus mejores músicos para tocar con los ${mine}.`, en: `The ${capName(r.name)} send their best musicians from ${w} to play with the ${capName(mine)}.` },
        { es: `Científicos ${r.name} y ${mine} estudian juntos la estrella que comparten.`, en: `${capName(r.name)} and ${capName(mine)} scientists study the star they share together.` },
        { es: `Una boda entre una diplomática ${r.name} y un piloto ${mine} es noticia en todo el sistema.`, en: `A wedding between a ${capName(r.name)} diplomat and a ${capName(mine)} pilot makes news across the system.` },
      ]);
      this.h.news('❧', pick.es, pick.en, 'info');
    }
  }

  private decision(kind: 'incident' | 'alliance' | 'peace', rival: number): Decision {
    return { id: this.h.nid(), kind, rival, left: 45, dur: 45 };
  }

  decide(d: Decision, accept: boolean) {
    const r = this.rival(d.rival ?? 0);
    const s = this.h.s;
    const civ = s.civ;
    if (!r || !civ) return;
    const mine = s.species?.name ?? '';
    const R = capName(r.name);
    if (d.kind === 'incident') {
      if (accept) {
        // Calm things down: costs a little science (an embassy, a gift).
        if (civ.res.science >= 30) civ.res.science -= 30;
        r.mood = clamp(r.mood + 0.18, -1, 1);
        this.h.news('⚖', `Los diplomáticos calman los ánimos: los ${r.name} aceptan las disculpas.`, `The diplomats calm things down: the ${R} accept the apology.`, 'good');
      } else {
        r.mood = clamp(r.mood - 0.25, -1, 1);
        this.h.news('⚠', `Los ${mine} exigen explicaciones. Los ${r.name} retiran a su embajador.`, `The ${capName(mine)} demand an explanation. The ${R} recall their ambassador.`, 'warn');
        if (r.mood < -0.4 && this.h.rng.next() < 0.5) this.declareWar(d.rival!, r);
      }
    } else if (d.kind === 'alliance') {
      if (accept) {
        r.relation = 'alliance';
        r.mood = clamp(r.mood + 0.3, -1, 1);
        this.h.news('⚭', `Los ${mine} y los ${r.name} firman una alianza: comparten ciencia, rutas y defensa.`, `The ${capName(mine)} and the ${R} sign an alliance: they share science, routes and defence.`, 'good');
      } else {
        r.mood = clamp(r.mood - 0.1, -1, 1);
        this.h.news('⚖', `Los ${mine} rechazan la alianza. Los ${r.name} se sienten desairados.`, `The ${capName(mine)} turn down the alliance. The ${R} feel snubbed.`, 'info');
      }
    } else if (d.kind === 'peace') {
      if (accept) this.makePeace(d.rival!, r, false);
      else this.h.news('⚔', `Los ${mine} rechazan la paz. La guerra con los ${r.name} continúa.`, `The ${capName(mine)} reject peace. The war with the ${R} goes on.`, 'warn');
    }
  }

  private declareWar(i: number, r: Rival) {
    r.relation = 'war';
    r.warT = 0;
    r.nextSkirmish = this.h.s.time + 8;
    const mine = this.h.s.species?.name ?? '';
    this.h.news('⚔', `¡Guerra! Los ${r.name} declaran la guerra a los ${mine}.`, `War! The ${capName(r.name)} declare war on the ${capName(mine)}.`, 'alien');
    void i;
  }

  makePeace(i: number, r: Rival, victory: boolean) {
    r.relation = 'peace';
    r.warT = 0;
    r.mood = victory ? 0.15 : 0.05;
    const mine = this.h.s.species?.name ?? '';
    if (victory) this.h.news('⚔', `Los ${r.name} se rinden ante la armada de los ${mine}. Hay paz, y los vencidos ceden sus colonias.`, `The ${capName(r.name)} surrender to the armada of the ${capName(mine)}. There is peace, and they cede their colonies.`, 'good');
    else this.h.news('☮', `Los ${mine} y los ${r.name} firman la paz. Las naves vuelven a casa.`, `The ${capName(mine)} and the ${capName(r.name)} sign a peace. The ships head home.`, 'good');
    this.h.s.ships = this.h.s.ships.filter((x) => x.kind !== 'raider');
    if (victory) for (const w of this.h.s.worlds) if (w.owner === i && w.colony >= 1) w.owner = 0;
  }

  /** Raiders leave from one side to strike a world of the other. */
  private raid(i: number, home: World) {
    const s = this.h.s;
    const rng = this.h.rng;
    const mine = s.worlds.filter((w) => (w.colony >= 1 && !w.owner) || (w.life && !w.life.people && w.life.stage >= 3));
    const theirs = s.worlds.filter((w) => w.owner === i || w === home);
    if (!mine.length || !theirs.length) return;
    // Both sides strike; the attacker this time is picked at random.
    const theyAttack = rng.next() < 0.5;
    const from = theyAttack ? rng.pick(theirs) : rng.pick(mine);
    const to = theyAttack ? rng.pick(mine) : rng.pick(theirs);
    for (let k = 0; k < 3; k++) this.ship(from, to, theyAttack ? i : 0, 'raider', { t: -k * 0.6 });
  }

  private raidHits(sh: Ship, w: World) {
    const s = this.h.s;
    const civ = s.civ;
    const attacker = sh.people ?? 0;
    const defenderRival = rivalOf(w);
    // Defence: guards, shields, and how advanced each side is.
    const defence = defenderRival ? 0.4 + 0.05 * Math.max(0, (this.home(defenderRival)?.life?.stage ?? 3) - 3) : 0.35 + (civ?.done.fleet ? 0.3 : 0) + (civ?.done.shield ? 0.1 : 0);
    const hit = this.h.rng.next() > defence;
    this.h.fx({ kind: 'raid', world: w.id, ship: sh.id, hit });
    if (!hit) return;
    if (w.life && (w.life.people || !w.colony) && w.life.stage >= 3 && !w.owner) {
      w.life.health -= 0.02;
      return;
    }
    w.colony = Math.max(0, w.colony - 0.15);
    if (w.colony <= 0.001) {
      // The colony falls: the attackers raise their own flag.
      w.colony = 0.4;
      w.owner = attacker || 0;
      const att = attacker ? this.rival(attacker) : null;
      const def = defenderRival ? this.rival(defenderRival) : null;
      const an = att ? att.name : s.species?.name ?? '';
      const dn = def ? def.name : s.species?.name ?? '';
      this.h.news('⚔', `${w.name} cae en manos de los ${an}. Los ${dn} la han perdido.`, `${w.name} falls to the ${capName(an)}. The ${capName(dn)} have lost it.`, attacker ? 'warn' : 'good');
    }
  }

  /** Armada strike on a rival's home: resolves the war in your favour. */
  armadaVictory(i: number) {
    const r = this.rival(i);
    if (r) this.makePeace(i, r, true);
  }

  atWar() {
    return this.rivals.findIndex((r) => r.relation === 'war') + 1;
  }

  allied(w: World) {
    const i = rivalOf(w);
    return !!i && this.rival(i)?.relation === 'alliance';
  }

  /** A flare hit one of their worlds: they don't like it. */
  flared(w: World) {
    const i = rivalOf(w);
    const r = i ? this.rival(i) : undefined;
    if (!r || r.relation === 'war') return;
    r.mood = clamp(r.mood - 0.15, -1, 1);
    this.h.news('⚠', `Los ${r.name} protestan: tu llamarada abrasó el cielo de ${w.name}.`, `The ${capName(r.name)} protest: your flare scorched the sky of ${w.name}.`, 'warn');
  }

  isGiant(w: World) {
    return isGiantStuff(w);
  }
}
