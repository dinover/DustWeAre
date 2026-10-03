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
