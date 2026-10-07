import type { Decision, GameState, OuterStar, PatrolState, Resources, Ship, World } from '../core/state';
import { Rng, TAU, clamp, easeInOut } from '../util';
import { worldRadius, worldXZ } from '../render/layout';
import { capName, worldName, invaderName, invaderNames } from '../content/names';
import type { Bi } from '../i18n';
import type { CivFx, CivSim } from './civ';
import { peopleOf, type PeopleFx, type PeopleSim } from './peoples';
import { addHarm } from './voices';
import { defLevel, lanceSpeed, podsPerWave, threatOf } from './threat';

/** Height of the battle barge's high orbit above the plane of the system. */
export const BARGE_Y = 6;
const ORBIT_R = 27;
/** Seconds the patrols spend at another star. */
const AWAY = 42;

export type PatrolFx =
  | { kind: 'lance'; ship?: number; world?: number }
  | { kind: 'podLand'; world: number; ship: number; pod: boolean }
  | { kind: 'deploy'; world: number };

/** What the Space Patrols need from the system. */
export interface PatrolHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  world(id: number): World | undefined;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact'): void;
  fx(f: CivFx | PeopleFx | PatrolFx): void;
  readonly peoples: PeopleSim;
  readonly civ: CivSim;
}

const BARGES: Bi[] = [
  { es: 'Ceniza Eterna', en: 'Eternal Ash' },
  { es: 'Vigilia de Hierro', en: 'Iron Vigil' },
  { es: 'Martillo del Alba', en: 'Hammer of Dawn' },
  { es: 'Fe Inquebrantable', en: 'Unbroken Faith' },
  { es: 'Furia de la Estrella', en: 'Fury of the Star' },
];

/** What a distant colony sends home every second, by how it is held. */
export const STAR_INCOME: Record<OuterStar['mode'], Resources> = {
  trade: { metal: 0.15, fuel: 0.15, water: 0.1, science: 0.3 },
  dominion: { metal: 0.6, fuel: 0.55, water: 0.3, science: 0.1 },
};
export const PATROL_COST = { help: { fuel: 50 }, relief: { fuel: 40 }, conquer: { fuel: 90, metal: 60 } };

const RES: (keyof Resources)[] = ['metal', 'fuel', 'water', 'science'];
const has = (r: Resources, c: Partial<Resources>) => RES.every((k) => r[k] >= (c[k] ?? 0));
const pay = (r: Resources, c: Partial<Resources>) => RES.forEach((k) => (r[k] -= c[k] ?? 0));

/**
 * The Space Patrols and the colonies around other stars. When invaders hold several worlds, the
 * peoples raise an order of armoured warriors with their own battle barge. They purge occupied
 * worlds with drop pods, burn invaders with the barge's lance, end wars between peoples by force
 * and, when asked, jump to defend — or conquer — the system's colonies around other stars.
 * Conquered stars pay far more than trading ones, but they make enemies.
 */
export class PatrolSim {
  private byId = new Map<number, World>();
  private tmp = { x: 0, z: 0 };
  private heldT = 0;
  private nextTrouble = 0;
  private convoyT = 25;
  /** Ships marked by the lance, and the seconds before the hit lands. */
  private marked = new Map<number, number>();

  constructor(private h: PatrolHost) {}

  get stars(): OuterStar[] {
    return (this.h.s.stars ??= []);
  }
  get patrol(): PatrolState | null {
    return this.h.s.patrol ?? null;
  }
  star(id: number | undefined) {
    return id === undefined ? undefined : this.stars.find((x) => x.id === id);
  }
  /** Ready for a new task (not away, not still rising from its shipyard). */
  get ready() {
    const p = this.patrol;
    return !!p && p.phase !== 'away' && p.phase !== 'rising';
  }
  dominions() {
    return this.stars.filter((x) => x.mode === 'dominion').length;
  }

  private pos(w: World) {
    this.byId.clear();
    for (const x of this.h.s.worlds) this.byId.set(x.id, x);
    return { ...worldXZ(w, this.byId, this.tmp) };
  }

  // ------------------------------------------------------------------ distant colonies
  /** A people settles a world around another star. */
  found(name: string, people: number, ang: number) {
    const s = this.h.s;
    const st: OuterStar = { id: this.h.nid(), name, people, mode: 'trade', ang, founded: s.time, health: 1, trouble: null, strike: null };
    this.stars.push(st);
    return st;
  }

  /** Saves from before distant colonies were kept: give the ones counted a name and a place. */
  private migrate() {
    const s = this.h.s;
    const n = s.civ?.stats.colonies ?? 0;
    const lead = this.h.peoples.leader();
    for (let k = 0; k < n; k++) this.found(worldName(this.h.rng, new Set()), lead?.id ?? 0, this.h.rng.range(0, TAU));
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    const s = this.h.s;
    if (!s.stars) {
      s.stars = [];
      this.migrate();
    }
    this.watch(dt);
    if (s.civ) {
      this.troubles(dt);
      this.income(dt);
      this.convoys(dt);
    }
    const p = this.patrol;
    if (!p) return;
    p.t += dt;
    this.move(p, dt);
    this.lance(p, dt);
    this.hits(p, dt);
    if (p.phase === 'assault') this.assault(p);
    else if (p.phase === 'orbit' && s.time >= p.next) this.think(p);
    else if (p.phase === 'away' && p.t >= AWAY) this.comeBack(p);
  }

  /** Invaders holding several worlds for a while: the peoples raise the Space Patrols. */
  private watch(dt: number) {
    const s = this.h.s;
    const held = s.worlds.filter((w) => w.invaded >= 0.6).length;
    if (held >= 2) this.heldT += dt;
    else this.heldT = Math.max(0, this.heldT - dt * 0.5);
    if (!s.patrol && s.civ && (held >= 3 || this.heldT > 90)) this.deploy();
  }

  private deploy() {
    const s = this.h.s;
    const peoples = this.h.peoples;
    const lead = peoples.leader();
    if (!lead || peoples.stage(lead) < 4) return;
    const home = peoples.home(lead) ?? peoples.worldsOf(lead)[0];
    if (!home) return;
    const q = this.pos(home);
    const barge = this.h.rng.pick(BARGES);
    s.patrol = { barge, born: s.time, phase: 'rising', t: 0, x: q.x, y: 0, z: q.z, sx: q.x, sy: 0, sz: q.z, ang: Math.atan2(q.z, q.x), next: s.time + 16, lanceT: 4, kills: 0, purges: 0, wars: 0, strikes: 0 };
    this.h.fx({ kind: 'deploy', world: home.id });
    const [al, AL] = invaderNames(s.alienSpecies);
    this.h.news(
      '⛨',
      `Ante la amenaza de los ${al}, los pueblos del sistema fundan los Space Patrols: guerreros acorazados que juran proteger la estrella. No conocerán el miedo.`,
      `Facing the threat of the ${AL}, the peoples of the system found the Space Patrols: armoured warriors sworn to protect the star. They shall know no fear.`,
      'good',
    );
    this.h.news('⛨', `La barcaza de batalla «${barge.es}» se eleva desde ${home.name}. ¡Por la Estrella!`, `The battle barge “${barge.en}” rises from ${home.name}. For the Star!`, 'good');
  }

  // ------------------------------------------------------------------ the barge
  private orbitSpot(p: PatrolState) {
    return { x: Math.cos(p.ang) * ORBIT_R, y: BARGE_Y, z: Math.sin(p.ang) * ORBIT_R };
  }

  /** Hovering just outside a world, on the far side from the star. */
  private hover(w: World) {
    const q = this.pos(w);
    const len = Math.hypot(q.x, q.z) || 1;
    const off = worldRadius(w) + 3.2;
    return { x: q.x + (q.x / len) * off, y: BARGE_Y * 0.6, z: q.z + (q.z / len) * off };
  }

  private phase(p: PatrolState, phase: PatrolState['phase']) {
    p.phase = phase;
    p.t = 0;
    p.sx = p.x;
    p.sy = p.y;
    p.sz = p.z;
  }

  private glide(p: PatrolState, to: { x: number; y: number; z: number }, dur: number) {
    const k = easeInOut(Math.min(1, p.t / dur));
    p.x = p.sx + (to.x - p.sx) * k;
    p.y = p.sy + (to.y - p.sy) * k;
    p.z = p.sz + (to.z - p.sz) * k;
    return p.t >= dur;
  }

  private move(p: PatrolState, dt: number) {
    p.ang += dt * 0.012;
    const target = p.target !== undefined ? this.h.world(p.target) : undefined;
    switch (p.phase) {
      case 'rising':
        if (this.glide(p, this.orbitSpot(p), 10)) this.phase(p, 'orbit');
        break;
      case 'orbit': {
        const o = this.orbitSpot(p);
        p.x = o.x;
        p.y = o.y + Math.sin(p.t * 0.6) * 0.25;
        p.z = o.z;
        break;
      }
      case 'approach':
        if (!target) this.phase(p, 'return');
        else if (this.glide(p, this.hover(target), 6)) {
          this.phase(p, 'assault');
          p.podsLeft = 3;
        }
        break;
      case 'assault':
        if (target) {
          const o = this.hover(target);
          p.x = o.x;
          p.y = o.y;
          p.z = o.z;
        }
        break;
      case 'return':
        if (this.glide(p, this.orbitSpot(p), 6)) {
          this.phase(p, 'orbit');
          p.target = undefined;
          p.goal = undefined;
          p.pair = undefined;
        }
        break;
    }
  }

  /** Companies of Space Patrols (the patrol defence level). */
  companies() {
    return defLevel(this.h.s, 'patrol');
  }

  /**
   * The barge's lance: invaders in flight first, then raiders of peoples at war. More companies
   * fire more often, and from three companies on one stays home on guard while the barge is away.
   */
  private lance(p: PatrolState, dt: number) {
    const P = this.companies();
    const away = p.phase === 'away';
    if (p.phase === 'rising' || (away && P < 3)) return;
    p.lanceT -= dt;
    if (p.lanceT > 0) return;
    const s = this.h.s;
    const rng = this.h.rng;
    const flying = (x: Ship) => !this.marked.has(x.id) && x.t > 0 && x.t / x.dur > 0.12 && x.t / x.dur < 0.95;
    const aliens = s.ships.filter((x) => x.alien && flying(x));
    let tgt = aliens.length ? rng.pick(aliens) : undefined;
    if (!tgt) {
      const raiders = s.ships.filter((x) => x.kind === 'raider' && flying(x));
      if (raiders.length && (p.goal === 'war' || rng.next() < 0.35)) tgt = rng.pick(raiders);
    }
    if (!tgt) {
      p.lanceT = 1;
      return;
    }
    p.lanceT = (rng.range(2.4, 4.2) / lanceSpeed(P)) * (away ? 2 : 1);
    tgt.doom = 0.5;
    this.marked.set(tgt.id, 0.5);
    if (!away) this.h.fx({ kind: 'lance', ship: tgt.id });
    else {
      // The company left on guard fires from the ground.
      const guards = this.h.civ.settled();
      if (guards.length) this.h.fx({ kind: 'laser', ship: tgt.id, world: rng.pick(guards).id });
    }
  }

  private hits(p: PatrolState, dt: number) {
    const s = this.h.s;
    for (const [id, t] of [...this.marked]) {
      const left = t - dt;
      if (left > 0) {
        this.marked.set(id, left);
        continue;
      }
      this.marked.delete(id);
      const sh = s.ships.find((x) => x.id === id);
      if (!sh) continue;
      if (sh.kind === 'mother' && (sh.hp ?? 1) > 1) {
        sh.hp = (sh.hp ?? 3) - 1;
        sh.doom = undefined;
        this.h.fx({ kind: 'boom', ship: sh.id, big: false });
        continue;
      }
      this.h.fx({ kind: 'boom', ship: sh.id, big: sh.kind === 'mother' });
      s.ships.splice(s.ships.indexOf(sh), 1);
      p.kills++;
    }
  }

  /** In orbit with nothing to do: look for trouble. */
  private think(p: PatrolState) {
    const s = this.h.s;
    const rng = this.h.rng;
    const peoples = this.h.peoples;
    // 1. Occupied worlds: purge them, peoples' worlds first.
    const occupied = s.worlds.filter((w) => w.invaded >= 0.3).sort((a, b) => b.invaded + (peopleOf(b) ? 0.5 : 0) - (a.invaded + (peopleOf(a) ? 0.5 : 0)));
    if (occupied.length) return this.strikeWorld(p, occupied[0], 'purge');
    // 2. Wars between peoples: they end them their own way.
    const war = peoples.wars().find((r) => r.warT > 18);
    if (war) {
      const raids = (id: number) => s.ships.filter((x) => x.kind === 'raider' && x.people === id).length;
      const [a, b] = raids(war.a) >= raids(war.b) ? [war.a, war.b] : [war.b, war.a];
      const pa = peoples.get(a);
      const ws = pa ? peoples.worldsOf(pa) : [];
      const colonies = ws.filter((w) => w.life?.people !== a);
      const w = colonies.length ? rng.pick(colonies) : ws[0];
      if (w) return this.strikeWorld(p, w, 'war', [a, b]);
    }
    // 3. Tension: a show of force over both peoples' worlds.
    const tense = (s.relations ?? []).filter((r) => r.state === 'tension' && r.met);
    if (tense.length && rng.next() < 0.35) {
      const r = rng.pick(tense);
      const A = peoples.get(r.a);
      const B = peoples.get(r.b);
      const wa = A && peoples.home(A);
      const wb = B && peoples.home(B);
      if (A && B && wa && wb) {
        for (const [i, w] of [wa, wb, wa, wb].entries()) this.launch(p, w, 'gunship', -i * 0.5);
        r.mood = Math.min(0, r.mood + 0.3);
        this.h.news(
          '⛨',
          `Las cañoneras de los Space Patrols sobrevuelan los mundos de los ${A.name} y los ${B.name}. Nadie se atreve a disparar.`,
          `Space Patrol gunships sweep over the worlds of the ${capName(A.name)} and the ${capName(B.name)}. Nobody dares to fire.`,
          'info',
        );
        p.next = s.time + rng.range(50, 80);
        return;
      }
    }
    p.next = s.time + 6;
  }

  private strikeWorld(p: PatrolState, w: World, goal: 'purge' | 'war', pair?: [number, number]) {
    const peoples = this.h.peoples;
    p.target = w.id;
    p.goal = goal;
    p.pair = pair;
    this.phase(p, 'approach');
    if (goal === 'purge') {
      const [al, AL] = invaderNames(this.h.s.alienSpecies);
      this.h.news('⛨', `La «${p.barge.es}» pone rumbo a ${w.name}: los ${al} serán purgados. Ningún xenos quedará en pie.`, `The “${p.barge.en}” sets course for ${w.name}: the ${AL} will be purged. No xenos shall be left standing.`, 'info');
    } else if (pair) {
      const a = peoples.get(pair[0]);
      const b = peoples.get(pair[1]);
      if (a && b)
        this.h.news(
          '⛨',
          `Los Space Patrols se hartan de la guerra entre los ${a.name} y los ${b.name}: la «${p.barge.es}» se lanza sobre ${w.name}.`,
          `The Space Patrols have had enough of the war between the ${capName(a.name)} and the ${capName(b.name)}: the “${p.barge.en}” swoops down on ${w.name}.`,
          'warn',
        );
    }
  }

  /** Drop pods in three waves, gunships with the first, the lance on the ground: more of them with every company. */
  private assault(p: PatrolState) {
    const w = p.target !== undefined ? this.h.world(p.target) : undefined;
    if (!w) return this.phase(p, 'return');
    const waves = p.podsLeft ?? 0;
    const P = this.companies();
    if (waves > 0 && p.t >= (3 - waves) * 2.2 + 0.4) {
      p.podsLeft = waves - 1;
      const pods = podsPerWave(P);
      for (let i = 0; i < pods; i++) this.launch(p, w, 'pod', -i * 0.35);
      if (waves === 3) {
        const guns = Math.min(4, 2 + Math.floor((P - 1) / 3));
        for (let i = 0; i < guns; i++) this.launch(p, w, 'gunship', -0.2 - i * 0.4);
      }
      this.h.fx({ kind: 'lance', world: w.id });
    }
    if ((p.podsLeft ?? 0) === 0 && p.t > 10.5) this.finish(p, w);
  }

  private launch(p: PatrolState, w: World, kind: 'pod' | 'gunship', t0: number) {
    const q = this.pos(w);
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    this.h.s.ships.push({ id: this.h.nid(), from: -7, to: w.id, t: t0, dur: kind === 'pod' ? 1.8 + d * 0.02 : 3 + d * 0.06, alien: false, kind, sx: p.x, sz: p.z });
  }

  /** A pod or a gunship reached its world. Returns true when handled here. */
  arrive(sh: Ship): boolean {
    if (sh.kind !== 'pod' && sh.kind !== 'gunship') return false;
    const w = this.h.world(sh.to);
    const p = this.patrol;
    if (!w) return true;
    const pod = sh.kind === 'pod';
    this.h.fx({ kind: 'podLand', world: w.id, ship: sh.id, pod });
    if (p?.goal === 'war' && p.target === w.id) {
      // Punishing the side that would not stop: their colony takes the blow.
      if (pod && w.colony > 0 && w.life?.people !== peopleOf(w)) w.colony = Math.max(0.35, w.colony - 0.1);
      else if (pod && w.life) w.life.health -= 0.015;
    } else if (w.invaded > 0) {
      const before = w.invaded;
      w.invaded = Math.max(0, w.invaded - (pod ? 0.22 : 0.08));
      if (before > 0.02 && w.invaded <= 0.02) {
        w.invaded = 0;
        if (p) p.purges++;
        const [al, AL] = invaderNames(this.h.s.alienSpecies);
        this.h.news('⛨', `${w.name} queda limpio de ${al}. Los Space Patrols plantan su estandarte entre las ruinas.`, `${w.name} is cleansed of the ${AL}. The Space Patrols plant their banner among the ruins.`, 'good');
      }
    }
    return true;
  }

  private finish(p: PatrolState, w: World) {
    const s = this.h.s;
    const rng = this.h.rng;
    if (p.goal === 'war' && p.pair) {
      const [a, b] = p.pair;
      if (this.h.peoples.enforcePeace(a, b)) p.wars++;
    } else if (w.invaded > 0.05) {
      this.h.news('⛨', `La purga de ${w.name} no ha terminado. Los Space Patrols volverán.`, `The purge of ${w.name} is not over. The Space Patrols will be back.`, 'info');
    }
    p.next = s.time + rng.range(18, 30);
    this.phase(p, 'return');
  }

  // ------------------------------------------------------------------ the stars beyond
  /** Why the patrols cannot be sent to a star right now (null: they can). */
  strikeLock(st: OuterStar, conquer: boolean): Bi | null {
    const civ = this.h.s.civ;
    const p = this.patrol;
    if (!p) return { es: 'Aún no existen los Space Patrols.', en: 'The Space Patrols do not exist yet.' };
    if (p.phase === 'away') return { es: 'Los Space Patrols están en otra estrella.', en: 'The Space Patrols are at another star.' };
    if (p.phase === 'rising') return { es: 'La barcaza aún se está elevando.', en: 'The barge is still rising.' };
    if (st.strike) return { es: 'Ya van hacia allí.', en: 'They are already on their way.' };
    if (conquer && st.mode === 'dominion') return { es: 'Ya es un dominio.', en: 'It is already a dominion.' };
    if (!civ || !has(civ.res, conquer ? PATROL_COST.conquer : PATROL_COST.help)) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  /** Sends the barge to another star: to defend a colony in trouble, or to conquer its system. */
  send(id: number, conquer: boolean) {
    const s = this.h.s;
    const st = this.star(id);
    const p = this.patrol;
    if (!st || !p || !s.civ || this.strikeLock(st, conquer)) return false;
    pay(s.civ.res, conquer ? PATROL_COST.conquer : PATROL_COST.help);
    addHarm(s, conquer ? 6 : -1);
    st.strike = { conquer };
    p.star = st.id;
    p.target = undefined;
    p.goal = undefined;
    p.strikes++;
    const dx = Math.cos(st.ang);
    const dz = Math.sin(st.ang);
    this.h.fx({ kind: 'warpOut', x: p.x, z: p.z, dx, dz, count: 1, tint: 'patrol' });
    this.phase(p, 'away');
    if (conquer)
      this.h.news('⛨', `La «${p.barge.es}» salta hacia ${st.name} para someter su sistema. ¡Por la Estrella!`, `The “${p.barge.en}” jumps to ${st.name} to bring its system to heel. For the Star!`, 'warn');
    else this.h.news('⛨', `La «${p.barge.es}» salta hacia ${st.name} en auxilio de sus colonos. ¡Por la Estrella!`, `The “${p.barge.en}” jumps to ${st.name} to aid its settlers. For the Star!`, 'good');
    return true;
  }

  /** A dominion goes back to being a free colony that only trades. */
  release(id: number) {
    const st = this.star(id);
    if (!st || st.mode !== 'dominion') return false;
    st.mode = 'trade';
    addHarm(this.h.s, -5);
    const who = this.h.peoples.get(st.people)?.name ?? '';
    this.h.news('⚖', `${st.name} vuelve a ser libre. ${who ? `Los colonos ${who}` : 'Sus colonos'} seguirán comerciando, y el sistema se gana menos enemigos.`, `${st.name} is free again. ${who ? `The ${capName(who)} settlers` : 'Its settlers'} will keep trading, and the system makes fewer enemies.`, 'info');
    return true;
  }

  private comeBack(p: PatrolState) {
    const s = this.h.s;
    const st = this.star(p.star);
    const o = this.orbitSpot(p);
    p.x = o.x;
    p.y = o.y;
    p.z = o.z;
    const len = Math.hypot(o.x, o.z) || 1;
    this.h.fx({ kind: 'warpIn', x: o.x, z: o.z, dx: -o.x / len, dz: -o.z / len, count: 1, tint: 'patrol' });
    this.phase(p, 'orbit');
    p.star = undefined;
    p.next = s.time + 8;
    if (st) this.strikeResult(p, st);
  }

  private strikeResult(p: PatrolState, st: OuterStar) {
    const rng = this.h.rng;
    const conquer = !!st.strike?.conquer;
    st.strike = null;
    const kind = st.trouble?.kind;
    // More companies win more often; a threat that has outgrown them makes every fight harder.
    const win = rng.next() < clamp((kind === 'invaders' ? 0.75 : 0.9) + 0.06 * (this.companies() - threatOf(this.h.s)), 0.3, 0.97);
    if (!win) {
      st.health = Math.max(0.15, st.health - 0.2);
      if (st.trouble) st.trouble.dur += 40;
      this.h.news('⛨', `Los Space Patrols vuelven diezmados de ${st.name}. La lucha allí sigue.`, `The Space Patrols come back battered from ${st.name}. The fight there goes on.`, 'warn');
      return;
    }
    p.kills += rng.int(4, 12);
    st.trouble = null;
    st.health = 1;
    const [al, AL] = invaderNames(this.h.s.alienSpecies);
    const lines: Record<string, Bi> = {
      pirates: { es: `Los piratas de ${st.name} ya no saquearán a nadie.`, en: `The pirates of ${st.name} will plunder no one again.` },
      natives: { es: `La revuelta de ${st.name} ha sido aplastada.`, en: `The revolt on ${st.name} has been crushed.` },
      invaders: { es: `Los ${al} huyen de ${st.name}.`, en: `The ${AL} flee from ${st.name}.` },
      plague: { es: `Los apotecarios de los Space Patrols contienen la plaga de ${st.name}.`, en: `The Space Patrol apothecaries contain the plague on ${st.name}.` },
      none: { es: `Nadie en ${st.name} pudo resistirse.`, en: `No one on ${st.name} could resist.` },
    };
    const l = lines[kind ?? 'none'];
    this.h.news('⛨', `Victoria en ${st.name}. ${l.es}`, `Victory at ${st.name}. ${l.en}`, 'good');
    if (st.mode === 'dominion') return;
    if (conquer) this.annex(st);
    else this.offerAnnex(st);
  }

  private offerAnnex(st: OuterStar) {
    const civ = this.h.s.civ;
    if (!civ || civ.decisions.length >= 3) return;
    civ.decisions.push({ id: this.h.nid(), kind: 'annex', star: st.id, left: 40, dur: 40 });
  }

  private annex(st: OuterStar) {
    const s = this.h.s;
    st.mode = 'dominion';
    this.h.news(
      '⚑',
      `${st.name} pasa a ser un dominio del sistema: sus minas y refinerías pagarán tributo… y sus vecinos no lo olvidarán.`,
      `${st.name} becomes a dominion of the system: its mines and refineries will pay tribute… and its neighbours will not forget.`,
      'warn',
    );
    // Conquest makes enemies: peace with the invaders does not last, and the next wave comes sooner.
    if (s.civ?.peace) s.invasion.next = Math.min(s.invasion.next, s.time + 420);
    else if (s.invasion.signal) s.invasion.next = Math.min(s.invasion.next, s.time + 150);
  }

  /** The player's answer about a distant colony. */
  decide(d: Decision, accept: boolean) {
    const s = this.h.s;
    const st = this.star(d.star);
    if (!st || !s.civ) return;
    const who = this.h.peoples.get(st.people)?.name;
    if (d.kind === 'annex') {
      addHarm(s, accept ? 4 : -2);
      if (accept) this.annex(st);
      else this.h.news('⚖', `Los Space Patrols dejan ${st.name} en manos de sus colonos. Seguirá siendo libre y comerciando.`, `The Space Patrols leave ${st.name} to its settlers. It will stay free and keep trading.`, 'info');
      return;
    }
    if (!st.trouble) return;
    if (!accept) {
      addHarm(s, 2);
      this.h.news('✶', `Los colonos de ${st.name} tendrán que arreglárselas solos.`, `The settlers of ${st.name} will have to fend for themselves.`, 'info');
      return;
    }
    if (this.patrol) {
      this.send(st.id, false);
      return;
    }
    // Before the patrols exist, a relief flotilla is all there is.
    if (!has(s.civ.res, PATROL_COST.relief)) return;
    pay(s.civ.res, PATROL_COST.relief);
    if (this.h.rng.next() < 0.55) {
      st.trouble = null;
      st.health = Math.min(1, st.health + 0.3);
      this.h.news('✶', `La flotilla de socorro llega a tiempo a ${st.name}.`, `The relief flotilla reaches ${st.name} in time.`, 'good');
    } else {
      st.health = Math.max(0.1, st.health - 0.1);
      this.h.news('✶', `La flotilla de socorro no basta: ${st.name} sigue en apuros${who ? ` y los ${who} piden algo más fuerte` : ''}.`, `The relief flotilla is not enough: ${st.name} is still in trouble${who ? ` and the ${capName(who)} ask for something stronger` : ''}.`, 'warn');
    }
  }

  /** Now and then, some distant colony gets into trouble — dominions far more often. */
  private troubles(dt: number) {
    const s = this.h.s;
    const civ = s.civ!;
    const rng = this.h.rng;
    for (const st of [...this.stars]) {
      if (!st.trouble) {
        st.health = Math.min(1, st.health + dt * 0.002);
        continue;
      }
      st.trouble.t += dt;
      if (!st.strike) st.health = Math.max(0, st.health - dt * (st.trouble.kind === 'plague' ? 0.005 : 0.008) * (1 + 0.08 * (threatOf(s) - 1)));
      if (st.trouble.t >= st.trouble.dur && !st.strike) this.troubleEnds(st);
    }
    if (!this.stars.length) return;
    if (!this.nextTrouble) this.nextTrouble = s.time + rng.range(50, 90);
    if (s.time < this.nextTrouble) return;
    const dom = this.dominions();
    this.nextTrouble = s.time + rng.range(110, 170) / (1 + 0.12 * this.stars.length + 0.3 * dom + 0.1 * (threatOf(s) - 1));
    const calm = this.stars.filter((x) => !x.trouble && !x.strike);
    if (!calm.length) return;
    let total = 0;
    for (const x of calm) total += x.mode === 'dominion' ? 2.5 : 1;
    let roll = rng.next() * total;
    let st = calm[0];
    for (const x of calm) {
      roll -= x.mode === 'dominion' ? 2.5 : 1;
      if (roll <= 0) {
        st = x;
        break;
      }
    }
    const r = rng.next();
    const kind: NonNullable<OuterStar['trouble']>['kind'] =
      st.mode === 'dominion' ? (r < 0.55 ? 'natives' : r < 0.75 ? 'pirates' : s.alienSpecies ? 'invaders' : 'natives') : r < 0.5 ? 'pirates' : r < 0.75 && s.alienSpecies ? 'invaders' : 'plague';
    st.trouble = { kind, t: 0, dur: 75 };
    const who = this.h.peoples.get(st.people)?.name;
    const W = who ?? '';
    const [al, AL] = invaderNames(s.alienSpecies);
    const lines: Record<string, Bi> = {
      pirates: { es: `Piratas del vacío asaltan la colonia ${W} de ${st.name}.`, en: `Void pirates raid the ${capName(W)} colony at ${st.name}.` },
      natives: { es: `Los nativos de ${st.name} se alzan contra el dominio del sistema.`, en: `The natives of ${st.name} rise against the system’s rule.` },
      invaders: { es: `Los ${al} asedian la colonia ${W} de ${st.name}.`, en: `The ${AL} besiege the ${capName(W)} colony at ${st.name}.` },
      plague: { es: `Una plaga se extiende por la colonia ${W} de ${st.name}.`, en: `A plague spreads through the ${capName(W)} colony at ${st.name}.` },
    };
    this.h.news(kind === 'plague' ? '☣' : kind === 'natives' ? '⚑' : '⚠', lines[kind].es, lines[kind].en, 'warn');
    if (civ.decisions.length < 3) civ.decisions.push({ id: this.h.nid(), kind: 'outpost', star: st.id, left: 45, dur: 45 });
    // A conquered system that rebels may call for revenge.
    if (kind === 'natives' && dom >= 2 && rng.next() < 0.35) {
      civ.peace = false;
      s.invasion.signal = 1;
      s.invasion.next = Math.min(s.invasion.next || s.time + 45, s.time + 45);
      if (!s.alienSpecies) s.alienSpecies = { ...invaderName(rng), hue: rng.range(0.78, 0.95) };
      this.h.news('⚠', `Los aliados de ${st.name} juran venganza: una flota de represalia viene hacia el sistema.`, `The allies of ${st.name} swear revenge: a reprisal fleet is heading for the system.`, 'alien');
    }
  }

  private troubleEnds(st: OuterStar) {
    const kind = st.trouble?.kind;
    st.trouble = null;
    const who = this.h.peoples.get(st.people)?.name;
    if (st.health > 0.3) {
      this.h.news('✶', `La colonia de ${st.name} resiste sola, maltrecha pero en pie.`, `The colony at ${st.name} holds out alone, battered but standing.`, 'info');
      return;
    }
    this.stars.splice(this.stars.indexOf(st), 1);
    if (st.mode === 'dominion' && kind === 'natives')
      this.h.news('⚑', `${st.name} se libera: los nativos expulsan a los colonos y cierran sus rutas.`, `${st.name} breaks free: the natives drive out the settlers and close their routes.`, 'warn');
    else this.h.news('✶', `Se pierde el contacto con la colonia${who ? ` de los ${who}` : ''} en ${st.name}.`, `Contact is lost with the${who ? ` ${capName(who)}` : ''} colony at ${st.name}.`, 'warn');
  }

  /** Trade and tribute from every distant colony. */
  private income(dt: number) {
    const civ = this.h.s.civ!;
    for (const st of this.stars) {
      const inc = STAR_INCOME[st.mode];
      const k = (st.trouble ? 0.4 : 1) * (0.5 + 0.5 * st.health);
      for (const r of RES) {
        civ.res[r] += inc[r] * k * dt;
        this.h.civ.rates[r] += inc[r] * k;
      }
    }
  }

  /** Caravans and tribute convoys warp in from the distant colonies. */
  private convoys(dt: number) {
    const s = this.h.s;
    const rng = this.h.rng;
    this.convoyT -= dt;
    if (this.convoyT > 0 || !this.stars.length || s.ships.length > 50) return;
    this.convoyT = rng.range(22, 36) / Math.min(2.5, 1 + this.stars.length * 0.15);
    const st = rng.pick(this.stars.filter((x) => !x.trouble).length ? this.stars.filter((x) => !x.trouble) : this.stars);
    const p = this.h.peoples.get(st.people);
    const ports = p ? this.h.peoples.worldsOf(p) : [];
    const pool = ports.length ? ports : this.h.civ.settled();
    if (!pool.length) return;
    const w = rng.pick(pool);
    const sx = Math.cos(st.ang) * 118;
    const sz = Math.sin(st.ang) * 118;
    const n = st.mode === 'dominion' ? 2 : 1;
    for (let k = 0; k < n; k++)
      s.ships.push({ id: this.h.nid(), from: -8, to: w.id, t: -k * 0.7, dur: 11, alien: false, kind: st.mode === 'dominion' ? 'tanker' : 'freight', sx, sz, people: st.people || undefined, star: st.id });
  }
}
