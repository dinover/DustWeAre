import { int, num, tr } from '../i18n';
import type { Kind, Factors } from '../sim/worlds';

export function kindName(k: Kind) {
  switch (k) {
    case 'gas':
      return tr('Gigante gaseoso', 'Gas giant');
    case 'icegiant':
      return tr('Gigante de hielo', 'Ice giant');
    case 'lava':
      return tr('Mundo de lava', 'Lava world');
    case 'scorched':
      return tr('Mundo abrasado', 'Scorched world');
    case 'ocean':
      return tr('Mundo oceánico', 'Ocean world');
    case 'ice':
      return tr('Mundo helado', 'Ice world');
    case 'desert':
      return tr('Mundo desértico', 'Desert world');
    case 'barren':
      return tr('Roca desnuda', 'Barren rock');
    default:
      return tr('Mundo templado', 'Temperate world');
  }
}

/** Age of the system, written for people (not astronomers). */
export function fmtAge(myr: number) {
  if (myr < 1) return tr(`${int(myr * 1000)} mil años`, `${int(myr * 1000)} thousand years`);
  if (myr < 1000) {
    const v = num(myr, myr < 10 ? 1 : 0);
    return tr(`${v} millones de años`, `${v} million years`);
  }
  const v = num(myr / 1000, 2);
  return tr(`${v} mil millones de años`, `${v} billion years`);
}

export const fmtTemp = (K: number) => `${int(K - 273)} °C`;

export function tempWord(K: number) {
  const c = K - 273;
  if (c < -60) return tr('helado', 'frozen');
  if (c < -5) return tr('frío', 'cold');
  if (c < 35) return tr('templado', 'mild');
  if (c < 80) return tr('caluroso', 'hot');
  return tr('abrasador', 'scorching');
}

export const FACTOR_KEYS: (keyof Factors)[] = ['temp', 'water', 'atm', 'org', 'mag', 'mass'];

export function factorName(k: keyof Factors) {
  switch (k) {
    case 'temp':
      return tr('Temperatura', 'Temperature');
    case 'water':
      return tr('Agua', 'Water');
    case 'atm':
      return tr('Atmósfera', 'Atmosphere');
    case 'org':
      return tr('Orgánicos', 'Organics');
    case 'mag':
      return tr('Campo magnético', 'Magnetic field');
    default:
      return tr('Tamaño', 'Size');
  }
}
