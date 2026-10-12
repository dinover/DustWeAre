import { massOf, type Decision, type DigSite, type FaithState, type GameState, type People, type Resources, type Ship, type World } from '../core/state';
import { clamp, type Rng } from '../util';
import type { Bi } from '../i18n';
import { capName, invaderName } from '../content/names';
import { colonizable, isGiantStuff } from './worlds';
import { travel, worldXZ } from '../render/layout';
import type { PeopleSim } from './peoples';
import type { CivSim } from './civ';
import type { PatrolSim } from './patrols';
import { MAX_LEVEL, defLevel } from './threat';

/**
 * Faith in the star. Every people believes a little; the star's mercies (deflected asteroids,
 * sheltered natives, truces, answered prayers, blessings) make them believe more. Cruelty does not
 * erase belief — it poisons it into dread, which only feeds the star's fear. Devout believers bring
 * the star blessings by tiers; when enough of them, from at least two peoples, pray together, they
 * found the Order of the Star. The Order reads the heavens, finds the Precursors' sites on the moons,
 * digs up their relics — and with that ancient technology forges the Space Patrols.
 */

export type FaithFx = { kind: 'bless'; world: number } | { kind: 'relic'; world: number };

/** Faith a new people starts with (below the first tier: the star has to earn it). */
export const FAITH_START = 0.12;
/** Faith drifts back to this when nothing happens (higher for the Order's faithful). */
const FLOOR = 0.1;
const FLOOR_ORDER = 0.35;
/** Faith a people needs to found (or join) the Order; members drop out below `STAY`. */
export const FOUND = 0.5;
const STAY = 0.3;

/**
 * Benefit tiers, by the share of everyone alive who believes out of love: it rewards how the star
 * behaves, not how big the system is.
 */
export const FAITH_TIERS: { share: number; name: Bi; gift: Bi }[] = [
  { share: 0.2, name: { es: 'Susurros', en: 'Whispers' }, gift: { es: '+10 % de luz estelar.', en: '+10% starlight.' } },
  { share: 0.35, name: { es: 'Templos', en: 'Temples' }, gift: { es: '+20 % de luz estelar y +25 de tope.', en: '+20% starlight and +25 to its cap.' } },
  {
    share: 0.55,
    name: { es: 'Peregrinaciones', en: 'Pilgrimages' },
    gift: { es: '+30 % de luz, +50 de tope, acciones un 15 % más baratas; los mundos fieles sanan antes y sus plagas duran la mitad.', en: '+30% light, +50 cap, actions 15% cheaper; faithful worlds heal faster and their plagues last half as long.' },
  },
  {
    share: 0.75,
    name: { es: 'Comunión', en: 'Communion' },
    gift: { es: '+40 % de luz, +75 de tope, acciones un 25 % más baratas y +10 % de producción.', en: '+40% light, +75 cap, actions 25% cheaper and +10% production.' },
  },
];
export const GRACE = [0, 0.1, 0.2, 0.3, 0.4];
export const CAP_BONUS = [0, 0, 25, 50, 75];
export const DISCOUNT = [0, 0, 0, 0.15, 0.25];

/** What founding the Order of the Star takes. */
export const ORDER = { share: 0.45, solo: 0.7, harm: 32, hold: 30 };
export const STUDY_COST: Partial<Resources> = { science: 220, metal: 60 };
export const STUDY_TIME = 60;
export const DIG_COST: Partial<Resources> = { fuel: 40, science: 30 };
export const DIG_TIME = 40;
export const FORGE_COST: Partial<Resources> = { metal: 220, fuel: 120, science: 160 };
export const FORGE_TIME = 75;
/** Starlight it takes to answer the Order with a sign. */
export const SIGN_COST = 30;
/** Relics needed at most (fewer if the heavens show fewer sites). */
export const RELICS_NEEDED = 3;

/** The Precursors' relics, in the order they are found. */
export const RELICS: { name: Bi; desc: Bi }[] = [
  {
    name: { es: 'la Armadura del Alba', en: 'the Dawn Armour' },
    desc: { es: 'placas azules y doradas que ninguna mano de este sistema forjó', en: 'blue and gold plates no hand of this system forged' },
  },
  {
    name: { es: 'la Lanza de Luz', en: 'the Lance of Light' },
    desc: { es: 'un arma que bebe directamente de la luz de la estrella', en: 'a weapon that drinks straight from the light of the star' },
  },
  {
    name: { es: 'el Corazón de la Barcaza', en: 'the Barge Heart' },
    desc: { es: 'el núcleo dormido de una nave de guerra inmensa', en: 'the sleeping core of an immense warship' },
  },
];

const RES: (keyof Resources)[] = ['metal', 'fuel', 'water', 'science'];
const has = (r: Resources, c: Partial<Resources>) => RES.every((k) => r[k] >= (c[k] ?? 0));
const pay = (r: Resources, c: Partial<Resources>) => RES.forEach((k) => (r[k] -= c[k] ?? 0));

/** Faith of a people (old saves had none). */
export const faithOf = (p: People | undefined) => p?.faith ?? FAITH_START;

/** More (or less) faith for some peoples — or for all of them. */
export function addFaith(s: GameState, who: number[] | 'all', n: number) {
  for (const p of s.peoples ?? []) {
    if (p.gone || (who !== 'all' && !who.includes(p.id))) continue;
    p.faith = clamp(faithOf(p) + n);
  }
}

/** How much of the peoples' belief has turned to dread (0..1): cruelty poisons faith. */
export const dreadOf = (s: GameState) => clamp(((s.harm ?? 0) - 15) / 45);

/** Everyone of a people (millions): natives on their home world and settlers on their colonies. */
export function popOf(s: GameState, p: People) {
  let n = 0;
  for (const w of s.worlds) {
    if (w.life?.people === p.id && w.life.stage >= 2) n += w.life.pop ?? 0;
    if (w.owner === p.id && w.colony > 0) n += w.cpop ?? 0;
  }
  return n;
}

export const faithTier = (s: GameState) => s.faith?.tier ?? 0;
/** Peoples that belong to the Order of the Star. */
export const inOrder = (s: GameState, id: number) => !!s.faith?.order?.members.includes(id);

/** What faith needs from the system. */
export interface FaithHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  world(id: number): World | undefined;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact' | 'voice'): void;
  fx(f: FaithFx): void;
  readonly peoples: PeopleSim;
  readonly civ: CivSim;
  readonly patrols: PatrolSim;
}

export class FaithSim {
  private byId = new Map<number, World>();
  private tmp = { x: 0, z: 0 };

  constructor(private h: FaithHost) {}

  get state(): FaithState | null {
    return this.h.s.faith ?? null;
  }

  /** The Order exists, but none of its peoples believes enough any more: its work stops. */
  get silent() {
    const o = this.state?.order;
    return !!o && !o.members.length;
  }

  /** Starlight the star gains on top, by tier. */
  grace() {
    return GRACE[faithTier(this.h.s)];
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    const s = this.h.s;
    const alive = this.h.peoples.alive();
    if (!alive.length) return;
    const f = (s.faith ??= { tier: 0, believers: 0, devout: 0, sites: [], digs: [], relics: 0 });
    // Faith drifts slowly back to a quiet floor (higher among the Order's faithful).
    for (const p of alive) {
      const v = faithOf(p);
      const floor = f.order?.members.includes(p.id) ? FLOOR_ORDER : FLOOR;
      p.faith = v + (floor - v) * Math.min(1, dt / 1500);
    }
    let total = 0;
    let believers = 0;
    for (const p of alive) {
      const n = popOf(s, p);
      total += n;
      believers += n * faithOf(p);
    }
    f.believers = believers;
    f.devout = believers * (1 - dreadOf(s));
    const share = total > 0 ? f.devout / total : 0;
    let tier = 0;
    FAITH_TIERS.forEach((t, i) => {
      if (share >= t.share) tier = i + 1;
    });
    // A tier reached for the first time is news; falling back and rising again is not.
    if (tier > (f.peak ?? 0)) {
      f.peak = tier;
      const t = FAITH_TIERS[tier - 1];
      this.h.news('❂', `La fe en la estrella crece: ${t.name.es}. ${t.gift.es}`, `Faith in the star grows: ${t.name.en}. ${t.gift.en}`, 'good');
    }
    f.tier = tier;
    this.order(f, alive, share, dt);
    this.research(f, dt);
    this.digging(f, dt);
    this.forging(f, dt);
    this.signs(f);
  }

  // ------------------------------------------------------------------ the Order of the Star
  private order(f: FaithState, alive: People[], share: number, dt: number) {
    const s = this.h.s;
    if (f.order) {
      // Those who joined stay while their faith holds; others join once they believe enough.
      const was = f.order.members;
      f.order.members = alive.filter((p) => faithOf(p) >= (was.includes(p.id) ? STAY : FOUND)).map((p) => p.id);
      return;
    }
    const faithful = alive.filter((p) => faithOf(p) >= FOUND);
    const peace = faithful.every((a) => faithful.every((b) => a === b || this.h.peoples.relation(a.id, b.id)?.state !== 'war'));
    const together = alive.length === 1 ? faithOf(alive[0]) >= ORDER.solo && this.h.peoples.worldsOf(alive[0]).length >= 2 : faithful.length >= 2 && peace;
    const ok = !!s.civ && (s.harm ?? 0) < ORDER.harm && share >= ORDER.share && together;
    f.formT = ok ? (f.formT ?? 0) + dt : 0;
    if (f.formT >= ORDER.hold) this.found(f, faithful.length ? faithful : alive);
  }

  /** What still stands in the way of the Order (for the Projects panel). */
  orderNeeds(): { es: string; en: string; ok: boolean }[] {
    const s = this.h.s;
    const f = this.state;
    const alive = this.h.peoples.alive();
    let total = 0;
    for (const p of alive) total += popOf(s, p);
    const devout = f?.devout ?? 0;
    const share = total > 0 ? devout / total : 0;
    const faithful = alive.filter((p) => faithOf(p) >= FOUND);
    const solo = alive.length === 1;
    const peace = faithful.every((a) => faithful.every((b) => a === b || this.h.peoples.relation(a.id, b.id)?.state !== 'war'));
    const pct = Math.round(share * 100);
    return [
      { es: `Que el ${Math.round(ORDER.share * 100)} % de todos crea por amor (ahora: ${pct} %)`, en: `${Math.round(ORDER.share * 100)}% of everyone believing out of love (now: ${pct}%)`, ok: share >= ORDER.share },
      solo
        ? { es: `Su único pueblo, con fe del ${Math.round(ORDER.solo * 100)} % y al menos dos mundos`, en: `Its only people, with ${Math.round(ORDER.solo * 100)}% faith and at least two worlds`, ok: !!alive[0] && faithOf(alive[0]) >= ORDER.solo && this.h.peoples.worldsOf(alive[0]).length >= 2 }
        : { es: `Dos pueblos con fe del ${Math.round(FOUND * 100)} % o más (hay ${faithful.length}), en paz entre ellos`, en: `Two peoples with ${Math.round(FOUND * 100)}% faith or more (there are ${faithful.length}), at peace with each other`, ok: faithful.length >= 2 && peace },
      { es: 'Que la estrella no sea temida', en: 'A star that is not feared', ok: (s.harm ?? 0) < ORDER.harm },
    ];
  }

  private found(f: FaithState, members: People[]) {
    const s = this.h.s;
    f.order = { born: s.time, members: members.map((p) => p.id) };
    f.formT = 0;
    f.nextSign = s.time + this.h.rng.range(480, 720);
    for (const r of s.relations ?? []) {
      if (!f.order.members.includes(r.a) || !f.order.members.includes(r.b)) continue;
      r.mood = clamp(r.mood + 0.3, -1, 1);
      if (r.state === 'tension') r.state = 'peace';
    }
    const names = members.map((p) => p.name);
    const es = names.length > 1 ? `Los ${names.slice(0, -1).join(', los ')} y los ${names[names.length - 1]}` : `Los ${names[0]}`;
    const en = names.length > 1 ? `The ${names.slice(0, -1).map(capName).join(', the ')} and the ${capName(names[names.length - 1])}` : `The ${capName(names[0])}`;
    this.h.news(
      '❂',
      `${es} rezan juntos a la misma estrella: nace la Orden de la Estrella. Sus sabios quieren leer en el cielo lo que la estrella intenta decirles.`,
      `${en} pray together to the same star: the Order of the Star is born. Its sages want to read in the sky what the star is trying to tell them.`,
      'good',
    );
    const home = this.h.peoples.home(members[0]);
    if (home) this.h.fx({ kind: 'bless', world: home.id });
  }

  /** Now and then the Order asks the star for a sign. */
  private signs(f: FaithState) {
    const s = this.h.s;
    if (!f.order || this.silent || !s.civ || s.time < (f.nextSign ?? 0)) return;
    f.nextSign = s.time + this.h.rng.range(480, 720);
    if (s.civ.decisions.length < 3 && !s.civ.decisions.some((d) => d.kind === 'sign')) s.civ.decisions.push({ id: this.h.nid(), kind: 'sign', left: 45, dur: 45 });
  }

  /** The star's answer to the Order's request for a sign (silence when it expires). */
  decide(d: Decision, accept: boolean) {
    void d;
    const s = this.h.s;
    const f = this.state;
    if (!f?.order) return;
    const members = f.order.members;
    if (accept && s.energy >= SIGN_COST) {
      s.energy -= SIGN_COST;
      addFaith(s, members, 0.08);
      if (f.study) f.study.t = Math.min(f.study.dur, f.study.t + f.study.dur * 0.25);
      if (f.forge) f.forge.t = Math.min(f.forge.dur, f.forge.t + f.forge.dur * 0.25);
      const lead = this.h.peoples.get(members[0]);
      const home = lead && this.h.peoples.home(lead);
      if (home) this.h.fx({ kind: 'bless', world: home.id });
      this.h.news('❂', 'Un halo dorado rodea la estrella durante una noche entera. La Orden lo toma como una señal y trabaja con más fervor.', 'A golden halo rings the star for a whole night. The Order takes it as a sign and works with greater fervour.', 'good');
    } else {
      addFaith(s, members, -0.05);
      this.h.news('❂', 'La estrella guarda silencio. En los templos de la Orden, alguien empieza a dudar.', 'The star keeps silent. In the Order’s temples, someone begins to doubt.', 'info');
    }
  }

  // ------------------------------------------------------------------ reading the heavens
  /** Why the Order cannot start reading the heavens (null: it can). */
  studyLock(): Bi | null {
    const f = this.state;
    const civ = this.h.s.civ;
    if (!f?.order) return { es: 'Primero, la Orden de la Estrella.', en: 'First, the Order of the Star.' };
    if (this.silent) return { es: 'La Orden calla: a sus pueblos les falta fe.', en: 'The Order is silent: its peoples lack faith.' };
    if (f.read) return { es: 'Los cielos ya están leídos.', en: 'The heavens have been read.' };
    if (f.study) return { es: 'Ya están leyendo los cielos.', en: 'They are already reading the heavens.' };
    if (!this.h.civ.spacefaring) return { es: 'Disponible en la era espacial.', en: 'Available in the space age.' };
    if (!civ || !has(civ.res, STUDY_COST)) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  study() {
    const f = this.state;
    const civ = this.h.s.civ;
    if (!f || !civ || this.studyLock()) return false;
    pay(civ.res, STUDY_COST);
    f.study = { t: 0, dur: STUDY_TIME };
    this.h.news('❂', 'Los astrónomos de la Orden apuntan sus telescopios a las lunas que nadie miraba.', 'The Order’s astronomers turn their telescopes on the moons nobody watched.', 'info');
    return true;
  }

  private research(f: FaithState, dt: number) {
    if (!f.study || this.silent) return;
    f.study.t += dt;
    if (f.study.t < f.study.dur) return;
    f.study = null;
    f.read = true;
    this.reveal(f);
  }

  /** The sites: moons first (where the Precursors hid), bare rocks if the moons are too few. */
  private reveal(f: FaithState) {
    const s = this.h.s;
    const rng = this.h.rng;
    const moons = rng.shuffle(s.worlds.filter((w) => w.parent !== null && colonizable(w) && w.invaded < 0.3));
    const picks = moons.slice(0, 5);
    if (picks.length < 3) {
      const rocks = rng.shuffle(s.worlds.filter((w) => w.parent === null && !isGiantStuff(w) && !w.life && massOf(w) < 0.3 && colonizable(w)));
      picks.push(...rocks.slice(0, 3 - picks.length));
    }
    f.sites = picks.map((w) => ({ world: w.id, state: 'open', tries: 0 }));
    f.need = Math.min(RELICS_NEEDED, f.sites.length);
    if (picks.length)
      this.h.news(
        '◬',
        `Los astrónomos de la Orden ven, en lunas que nadie miraba, simetrías que ninguna roca tiene: ${picks.map((w) => w.name).join(', ')}. Alguien estuvo allí antes que nosotros.`,
        `The Order’s astronomers see, on moons nobody watched, symmetries no rock should have: ${picks.map((w) => w.name).join(', ')}. Someone was there before us.`,
        'good',
      );
    else this.h.news('◬', 'Los cielos no esconden nada más: la Orden tendrá que forjar con lo que sabe.', 'The heavens hide nothing more: the Order will have to forge with what it knows.', 'info');
  }

  // ------------------------------------------------------------------ digs
  /** A spacefaring people's home, where pilgrims set out from. */
  private port() {
    const L = this.h.peoples.leader();
    if (!L || this.h.peoples.stage(L) < 4) return undefined;
    const w = this.h.peoples.home(L) ?? this.h.peoples.worldsOf(L)[0];
    return w ? { w, people: L.id } : undefined;
  }

  private pilgrims() {
    return this.h.s.ships.filter((x) => x.kind === 'pilgrim');
  }

  /** Digs under way, pilgrims on the road included. */
  active() {
    return (this.state?.digs.length ?? 0) + this.pilgrims().length;
  }

  busy(id: number) {
    return !!this.state?.digs.some((d) => d.world === id) || this.pilgrims().some((x) => x.to === id);
  }

  /** Why the pilgrims cannot dig there right now (null: they can). */
  digLock(id: number): Bi | null {
    const f = this.state;
    const civ = this.h.s.civ;
    const site = f?.sites.find((x) => x.world === id);
    const w = this.h.world(id);
    if (!f?.order || !site || !w) return { es: 'No hay nada que excavar.', en: 'There is nothing to dig.' };
    if (this.silent) return { es: 'La Orden calla: a sus pueblos les falta fe.', en: 'The Order is silent: its peoples lack faith.' };
    if (site.state === 'done') return { es: 'Su reliquia ya fue hallada.', en: 'Its relic has been found.' };
    if (this.busy(id)) return { es: 'Los peregrinos ya están allí.', en: 'The pilgrims are already there.' };
    if (this.active() >= 2) return { es: 'Ya hay dos excavaciones en marcha.', en: 'Two digs are already under way.' };
    if (w.invaded >= 0.3) return { es: 'Los invasores ocupan el yacimiento.', en: 'Invaders hold the site.' };
    if (!this.port()) return { es: 'Ningún pueblo puede viajar hasta allí.', en: 'No people can travel there.' };
    if (!civ || !has(civ.res, DIG_COST)) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  /** Pilgrims of the Order set out to dig a site. */
  dig(id: number) {
    const s = this.h.s;
    const civ = s.civ;
    const w = this.h.world(id);
    const from = this.port();
    if (!civ || !w || !from || this.digLock(id)) return false;
    pay(civ.res, DIG_COST);
    this.byId.clear();
    for (const x of s.worlds) this.byId.set(x.id, x);
    const a = { ...worldXZ(from.w, this.byId, this.tmp) };
    const b = worldXZ(w, this.byId, this.tmp);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    s.ships.push({ id: this.h.nid(), from: from.w.id, to: w.id, t: 0, dur: 6 + travel(d) * 0.22, alien: false, kind: 'pilgrim', people: from.people });
    this.h.news('◬', `Peregrinos de la Orden parten hacia ${w.name} con palas, lámparas y cánticos.`, `Pilgrims of the Order set out for ${w.name} with shovels, lamps and hymns.`, 'info');
    return true;
  }

  /** A pilgrim ship reached its site: the dig begins. Returns true when handled here. */
  arrive(sh: Ship): boolean {
    if (sh.kind !== 'pilgrim') return false;
    const f = this.state;
    const site = f?.sites.find((x) => x.world === sh.to);
    if (f && site && site.state !== 'done' && !f.digs.some((d) => d.world === sh.to)) f.digs.push({ world: sh.to, t: 0, dur: DIG_TIME });
    return true;
  }

  private digging(f: FaithState, dt: number) {
    for (const d of [...f.digs]) {
      const w = this.h.world(d.world);
      const site = f.sites.find((x) => x.world === d.world);
      if (!w || !site) {
        f.digs.splice(f.digs.indexOf(d), 1);
        continue;
      }
      if (w.invaded >= 0.5) {
        f.digs.splice(f.digs.indexOf(d), 1);
        this.h.news('◬', `Los invasores caen sobre la excavación de ${w.name}: los peregrinos huyen.`, `Invaders fall on the dig at ${w.name}: the pilgrims flee.`, 'warn');
        continue;
      }
      d.t += dt;
      if (d.t < d.dur) continue;
      f.digs.splice(f.digs.indexOf(d), 1);
      this.unearth(f, site, w);
    }
  }

  /** What a dig turns up: a relic, an archive that shows the way, or a beacon that wakes something up. */
  private unearth(f: FaithState, site: DigSite, w: World) {
    const s = this.h.s;
    const rng = this.h.rng;
    site.tries++;
    const roll = rng.next();
    if (site.state === 'sure' || site.tries >= 3 || roll < 0.55) return this.relic(f, site, w);
    if (roll < 0.8) {
      site.state = 'sure';
      if (s.civ) s.civ.res.science += 120;
      this.h.news(
        '◬',
        `En ${w.name}, los peregrinos hallan un archivo de los Precursores, un pueblo desaparecido que también rezaba a esta estrella. Señala dónde cavar: la próxima vez no fallarán.`,
        `On ${w.name}, the pilgrims find an archive of the Precursors, a vanished people who also prayed to this star. It shows where to dig: next time they will not miss.`,
        'good',
      );
      return;
    }
    // A beacon: whoever left it is still listening.
    if (s.civ) s.civ.peace = false;
    s.invasion.signal = 1;
    s.invasion.next = Math.min(s.invasion.next || s.time + 60, s.time + 60);
    if (!s.alienSpecies) s.alienSpecies = { ...invaderName(rng), hue: rng.range(0.78, 0.95) };
    this.h.news('⚠', `Los peregrinos despiertan una baliza bajo el hielo de ${w.name}. Algo responde desde la oscuridad.`, `The pilgrims wake a beacon under the ice of ${w.name}. Something answers from the dark.`, 'alien');
  }

  private relic(f: FaithState, site: DigSite, w: World) {
    const s = this.h.s;
    site.state = 'done';
    const r = RELICS[f.relics % RELICS.length];
    f.relics++;
    addFaith(s, 'all', 0.06);
    this.h.fx({ kind: 'relic', world: w.id });
    this.h.news('◬', `¡Una reliquia! En ${w.name}, los peregrinos desentierran ${r.name.es}: ${r.desc.es}.`, `A relic! On ${w.name}, the pilgrims unearth ${r.name.en}: ${r.desc.en}.`, 'good');
    // Once the Space Patrols exist, every relic arms one more company.
    const civ = s.civ;
    if (s.patrol && civ) {
      const lvl = defLevel(s, 'patrol');
      if (lvl < MAX_LEVEL) {
        (civ.def ??= {}).patrol = lvl + 1;
        this.h.news('⛨', `Con ${r.name.es}, la Orden arma una compañía más de Space Patrols.`, `With ${r.name.en}, the Order arms one more company of Space Patrols.`, 'good');
      }
    }
  }

  // ------------------------------------------------------------------ the forge
  /** Why the Order cannot forge the Space Patrols yet (null: it can). */
  forgeLock(): Bi | null {
    const f = this.state;
    const civ = this.h.s.civ;
    if (this.h.s.patrol) return { es: 'Los Space Patrols ya existen.', en: 'The Space Patrols already exist.' };
    if (!f?.order) return { es: 'Primero, la Orden de la Estrella.', en: 'First, the Order of the Star.' };
    if (this.silent) return { es: 'La Orden calla: a sus pueblos les falta fe.', en: 'The Order is silent: its peoples lack faith.' };
    if (!f.read) return { es: 'Primero hay que leer los cielos.', en: 'The heavens must be read first.' };
    if (f.forge || f.forged) return { es: 'La forja ya está encendida.', en: 'The forge is already burning.' };
    const need = f.need ?? RELICS_NEEDED;
    if (f.relics < need) return { es: `Faltan reliquias: ${f.relics} de ${need}.`, en: `Relics missing: ${f.relics} of ${need}.` };
    if (!civ || !has(civ.res, FORGE_COST)) return { es: 'Faltan recursos.', en: 'Not enough resources.' };
    return null;
  }

  forge() {
    const f = this.state;
    const civ = this.h.s.civ;
    if (!f || !civ || this.forgeLock()) return false;
    pay(civ.res, FORGE_COST);
    f.forge = { t: 0, dur: FORGE_TIME };
    this.h.news('⛨', 'La Orden enciende la forja de los Precursores. Sus mejores hijos e hijas se preparan para el juramento.', 'The Order lights the Precursors’ forge. Its finest sons and daughters prepare for the oath.', 'good');
    return true;
  }

  private forging(f: FaithState, dt: number) {
    const s = this.h.s;
    if (f.forge && !this.silent) {
      f.forge.t += dt;
      if (f.forge.t >= f.forge.dur) {
        f.forge = null;
        f.forged = true;
        // If the invaders forced the peoples to raise them in a hurry meanwhile, the forge arms one more company.
        const civ = s.civ;
        if (s.patrol && civ) {
          f.forged = false;
          const lvl = defLevel(s, 'patrol');
          (civ.def ??= {}).patrol = Math.min(MAX_LEVEL, lvl + 1);
          this.h.news('⛨', 'La forja de los Precursores arma una compañía más de Space Patrols.', 'The Precursors’ forge arms one more company of Space Patrols.', 'good');
        }
      }
    }
    // The forge is done: the Patrols rise as soon as a spacefaring people can crew them.
    if (f.forged && !s.patrol && this.h.patrols.raise('faith', 2)) f.forged = false;
  }

  /** A world disappeared (a collision): its site and dig go with it. */
  drop(id: number) {
    const f = this.state;
    if (!f) return;
    f.sites = f.sites.filter((x) => x.world !== id);
    f.digs = f.digs.filter((x) => x.world !== id);
    if (f.read) f.need = Math.min(f.need ?? RELICS_NEEDED, f.relics + f.sites.filter((x) => x.state !== 'done').length);
  }

  /** For the debug console. */
  summary() {
    const f = this.state;
    return f && { tier: f.tier, believers: Math.round(f.believers), devout: Math.round(f.devout), order: f.order?.members, relics: f.relics, need: f.need, sites: f.sites };
  }
}
