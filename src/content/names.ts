import { Rng } from '../util';

const START = ['ka', 've', 'lo', 'mi', 'sa', 'tu', 'ar', 'el', 'ny', 'ri', 'do', 'the', 'ys', 'ae', 'no', 'qua', 'zo', 'li', 'ma', 'pe', 'so', 'ki', 'ora', 'ise', 'ul', 'ba', 'cy', 'fe'];
const MID = ['ra', 've', 'lo', 'ri', 'sa', 'ne', 'mi', 'to', 'ka', 'li', 'do', 'ar', 'en', 'is', 'ol', 'ua', 'th', 'ry'];
const END = ['ra', 'ris', 'nia', 'lon', 'dra', 'vos', 'tis', 'ma', 'ne', 'ros', 'lia', 'th', 'sen', 'ka', 'dor', 'mira', 'nys', 'vel'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function worldName(rng: Rng, used: Set<string>) {
  for (let i = 0; i < 40; i++) {
    const n = cap(rng.pick(START) + (rng.next() < 0.45 ? rng.pick(MID) : '') + rng.pick(END));
    if (!used.has(n) && n.length <= 10) {
      used.add(n);
      return n;
    }
  }
  return cap(rng.pick(START) + rng.pick(END) + rng.int(2, 9));
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const moonName = (parent: string, i: number) => `${parent} ${ROMAN[i] ?? i + 1}`;

const SP_A = ['vel', 'om', 'sy', 'ka', 'thu', 'ner', 'ail', 'qo', 'lum', 'ira', 'zef', 'mor', 'eni', 'ush'];
const SP_B = ['ari', 'ine', 'ae', 'oth', 'uri', 'esh', 'ani', 'ol', 'ix', 'ena'];

/** Species name, lower case (Spanish "los velari", English "the Velari"). */
export const speciesName = (rng: Rng) => rng.pick(SP_A) + rng.pick(SP_B);
export const capName = cap;

/**
 * The invaders are not one more people: they are a faction with a name of dread, the same in
 * every swarm they send (Spanish and English).
 */
const INVADERS: { es: string; en: string }[] = [
  { es: 'Devoradores', en: 'Devourers' },
  { es: 'Segadores', en: 'Reapers' },
  { es: 'Silentes', en: 'Silent Ones' },
  { es: 'Hambrientos', en: 'Hungering' },
  { es: 'Velados', en: 'Veiled' },
  { es: 'Hijos de la Grieta', en: 'Children of the Rift' },
  { es: 'Errantes Negros', en: 'Black Wanderers' },
  { es: 'Ojos Pálidos', en: 'Pale Eyes' },
];

/** A new invader faction (avoiding the current one). */
export function invaderName(rng: Rng, current?: string) {
  const pool = INVADERS.filter((x) => x.es !== current);
  const n = rng.pick(pool);
  return { name: n.es, en: n.en };
}

/** The invaders' name in Spanish and English (older saves: a species name). */
export function invaderNames(sp: { name: string; en?: string } | null | undefined): [string, string] {
  if (!sp) return ['', ''];
  return [sp.name, sp.en ?? cap(sp.name)];
}
