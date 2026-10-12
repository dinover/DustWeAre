import { massOf, type Ethos, type People, type Resources, type Use, type World } from '../core/state';
import { clamp, ramp, type Rng } from '../util';
import type { Bi } from '../i18n';
import type { WorldStats } from './worlds';

/** What a settled world contributes to the civilization. */
export type Role = 'fuel' | 'water' | 'science' | 'metal';

/*
 * What a people makes of a world it settles. Only worlds worth it are terraformed into gardens; the
 * rest become mining towns, ice wells, research outposts or fortresses, and giants carry floating
 * cities. Each people chooses by what the world is made of and by its own character.
 */
export type { Ethos, Use };

export const USES: Use[] = ['garden', 'lab', 'mine', 'ice', 'gas', 'fort'];
export const ETHOS: Ethos[] = ['science', 'industry', 'war', 'trade'];

export const USE_ROLE: Record<Use, Role> = { garden: 'science', lab: 'science', mine: 'metal', ice: 'water', gas: 'fuel', fort: 'metal' };

export const USE_INFO: Record<Use, { icon: string; name: Bi; desc: Bi }> = {
  garden: {
    icon: '☘',
    name: { es: 'Jardín terraformado', en: 'Terraformed garden' },
    desc: {
      es: 'Vale la pena: los colonos lo vuelven templado y verde, con ciudades, universidades y ciencia. Gasta agua mientras se terraforma.',
      en: 'Worth it: the settlers make it mild and green, with cities, universities and science. It uses water while it is terraformed.',
    },
  },
  lab: {
    icon: '⚗',
    name: { es: 'Puesto de investigación', en: 'Research outpost' },
    desc: { es: 'Unas pocas cúpulas de científicos estudian el mundo sin cambiarlo. Aporta algo de ciencia.', en: 'A few domes of scientists study the world without changing it. It gives some science.' },
  },
  mine: {
    icon: '⛏',
    name: { es: 'Pueblos mineros', en: 'Mining towns' },
    desc: {
      es: 'Pequeños pueblos junto a minas y fundiciones. Cuanto más metal (o más calor), mejor rinde. Ensucian el mundo: la vida que haya lo sufre.',
      en: 'Small towns by mines and foundries. The more metal (or heat), the better it yields. They foul the world: any life there suffers.',
    },
  },
  ice: {
    icon: '❄',
    name: { es: 'Pozos de hielo', en: 'Ice wells' },
    desc: {
      es: 'Perforan el hielo y los mares: agua para terraformar jardines y mantener colonias, y algo de combustible (deuterio) aunque no haya gigantes.',
      en: 'They drill the ice and the seas: water to terraform gardens and keep colonies alive, and a little fuel (deuterium) even without giants.',
    },
  },
  gas: {
    icon: '◍',
    name: { es: 'Ciudades flotantes', en: 'Floating cities' },
    desc: { es: 'Ciudades suspendidas en las nubes del gigante filtran helio-3 y deuterio: combustible.', en: 'Cities hanging in the giant’s clouds filter helium-3 and deuterium: fuel.' },
  },
  fort: {
    icon: '♜',
    name: { es: 'Fortaleza', en: 'Fortress' },
    desc: {
      es: 'Bases, cuarteles y plataformas de defensa. Aporta poco metal, pero dispara a los invasores que pasan cerca y aguanta mejor las incursiones.',
      en: 'Bases, barracks and defence platforms. It gives little metal, but it shoots at invaders passing nearby and stands up better to raids.',
    },
  },
};

export const ETHOS_INFO: Record<Ethos, { icon: string; name: Bi; desc: Bi }> = {
  science: {
    icon: '⚗',
    name: { es: 'científico', en: 'scholarly' },
    desc: { es: 'Terraforman más mundos, levantan laboratorios y cuidan la vida que encuentran.', en: 'They terraform more worlds, raise laboratories and look after the life they find.' },
  },
  industry: {
    icon: '⛏',
    name: { es: 'industrial', en: 'industrious' },
    desc: { es: 'Abren minas y pozos en todas partes y sus pueblos crecen deprisa.', en: 'They open mines and wells everywhere and their towns grow fast.' },
  },
  war: {
    icon: '⚔',
    name: { es: 'guerrero', en: 'warlike' },
    desc: { es: 'Levantan fortalezas, se ofenden con facilidad y no tienen piedad con los nativos.', en: 'They raise fortresses, take offence easily and show natives no mercy.' },
  },
  trade: {
    icon: '⚖',
    name: { es: 'mercader', en: 'mercantile' },
    desc: { es: 'Explotan lo que más le falta al sistema, comercian más y hacen amigos con facilidad.', en: 'They work whatever the system lacks most, trade more and make friends easily.' },
  },
};

/** A people's character (old saves had none: one is read from its id, so it never changes). */
export const ethosOf = (p: People | undefined): Ethos => p?.ethos ?? ETHOS[(p?.id ?? 0) % ETHOS.length];

/**
 * How well a world suits each use, from what it is made of and how far it is from mild. Terraforming
 * only pays off on worlds that are the right size, have some water and are not far too hot or cold.
 */
export function aptitudes(w: World, st: WorldStats): Record<Use, number> {
  const out: Record<Use, number> = { garden: 0, lab: 0, mine: 0, ice: 0, gas: 0, fort: 0 };
  if (st.giant) {
    out.gas = 1;
    return out;
  }
  const m = Math.max(1e-6, massOf(w));
  const metal = w.metal / m;
  const water = w.water / m;
  const T = st.T;
  const cold = ramp(255, 185, T);
  const hot = ramp(318, 372, T);
  const dry = st.ocean < 0.03 && water < 0.01 ? 0.35 : 0;
  const size = m < 0.06 ? 1 : m < 0.12 ? 0.35 : m > 10 ? 0.6 : 0;
  // A world already close to living is easy to finish.
  out.garden = clamp(1 - cold - hot - dry - size) * (w.mag >= 0.2 ? 1 : 0.75) * (0.8 + 0.25 * st.H);
  out.mine = 0.3 + 1.5 * metal + 0.5 * ramp(330, 520, T) + (st.kind === 'lava' ? 0.3 : 0) + (st.kind === 'barren' || st.kind === 'desert' ? 0.15 : 0) - (st.ocean > 0.6 ? 0.25 : 0) - (water > 0.3 ? 0.2 : 0);
  out.ice = T > 335 ? 0 : 0.15 + 1.6 * water + (st.kind === 'ice' ? 0.4 : 0) + (st.ocean > 0.8 ? 0.15 : 0);
  out.lab = 0.25 + (w.life ? 0.35 + 0.08 * w.life.stage : 0);
  out.fort = 0.1;
  return out;
}

/** What a world would most naturally be used for (before any people chooses). */
export function naturalUse(w: World, st: WorldStats): Use {
  const a = aptitudes(w, st);
  let best: Use = 'mine';
  for (const u of USES) if (a[u] > a[best]) best = u;
  return best;
}

/**
 * What a people does with a world it has just settled: by its aptitudes, the people's character and
 * what the system is short of (the peoples go where they are needed).
 */
export function chooseUse(w: World, st: WorldStats, ethos: Ethos, rates: Resources, rng: Rng): Use {
  if (st.giant) return 'gas';
  const a = aptitudes(w, st);
  const k: Record<Use, number> = { ...a };
  if (ethos === 'science') {
    k.garden *= 1.35;
    k.lab += 0.45;
    k.mine *= 0.8;
  } else if (ethos === 'industry') {
    k.mine *= 1.45;
    k.ice *= 1.2;
    k.garden *= 0.85;
  } else if (ethos === 'war') {
    k.fort += 0.65;
    k.mine *= 1.15;
    k.garden *= 0.8;
  }
  // The resource the system lacks most draws everyone a little — traders a lot.
  const short = (['metal', 'water', 'science'] as const).reduce((x, y) => (rates[y] < rates[x] ? y : x));
  if (rates.metal + rates.water + rates.science > 0) for (const u of USES) if (USE_ROLE[u] === short && a[u] > 0.2) k[u] += ethos === 'trade' ? 0.45 : 0.15;
  // Terraforming a world that is not worth it is out of the question (scholars are more patient).
  if (a.garden < (ethos === 'science' ? 0.35 : 0.5)) k.garden = 0;
  let best: Use = 'mine';
  let bv = -Infinity;
  for (const u of USES) {
    if (u === 'gas') continue;
    const v = k[u] + rng.range(-0.08, 0.08);
    if (v > bv) {
      bv = v;
      best = u;
    }
  }
  return best;
}

/** How hard a use weighs on any life that shares the world (0: not at all). */
export const USE_PRESSURE: Record<Use, number> = { garden: 0.15, lab: 0.08, mine: 0.6, ice: 0.35, gas: 0, fort: 0.55 };

/** A people's character weighs on the natives too: warriors are ruthless, scholars careful. */
export const ETHOS_PRESSURE: Record<Ethos, number> = { science: 0.75, industry: 1.1, war: 1.45, trade: 1 };
