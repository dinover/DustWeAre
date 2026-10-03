/**
 * Tiny bilingual layer (Spanish / English).
 *
 * Text lives next to the code that uses it, as `tr('español', 'English')` pairs, so both
 * versions are always written (and reviewed) together. Data tables keep a `{ es, en }` pair per
 * entry. The language can change at any moment: everything that is drawn each frame follows on
 * its own, and screens built once listen to `onLangChange` to rebuild.
 */
export type Lang = 'es' | 'en';

/** A piece of text in both languages. */
export interface Bi {
  es: string;
  en: string;
}

const KEY = 'dwa.lang';

function detect(): Lang {
  // A link from Universe is Born carries the player's language.
  const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (fromUrl === 'es' || fromUrl === 'en') return fromUrl;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    /* storage unavailable: fall back to the browser language */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language ?? '' : '';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;

/** Picks the text for the current language. */
export function tr(es: string, en: string): string {
  return current === 'en' ? en : es;
}

/** Resolves a `{ es, en }` pair. */
export const pick = (b: Bi) => (current === 'en' ? b.en : b.es);

/** Stores the current language (it survives "erase all progress"). */
export function saveLang() {
  try {
    localStorage.setItem(KEY, current);
  } catch {
    /* ignore */
  }
}

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  saveLang();
  document.documentElement.lang = l;
  for (const fn of listeners) fn(l);
}

export function onLangChange(fn: (l: Lang) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Decimal number with the separator each language expects (1,5 / 1.5). */
export function num(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return current === 'es' ? s.replace('.', ',') : s;
}

/** Whole number with the thousands grouping of the current language. */
export const int = (v: number) => Math.round(v).toLocaleString(current);

/**
 * Gives a data entry live text fields: each one is a getter that reads in the current
 * language, so tables (shop items, minigames…) need no rebuild when the language changes.
 */
export function withText<T extends object, K extends string>(base: T, texts: Record<K, Bi>): T & Record<K, string> {
  for (const k of Object.keys(texts) as K[]) Object.defineProperty(base, k, { get: () => pick(texts[k]), enumerable: true, configurable: true });
  return base as T & Record<K, string>;
}
