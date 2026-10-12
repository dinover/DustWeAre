import type { Bi } from '../i18n';
import type { GameState, Heirloom, StarType } from '../core/state';

/** Kinds of star a new system can be born around: each one changes the game a little. */
export const STAR_TYPES: Record<StarType, { name: Bi; desc: Bi; lum: number; light: number; wind: number; spark: number }> = {
  orange: {
    name: { es: 'Enana naranja', en: 'Orange dwarf' },
    desc: { es: 'Más tenue (×0,8) y menos luz estelar (×0,9), pero estable: la vida aparece un 25 % antes.', en: 'Dimmer (×0.8) with less starlight (×0.9), but steady: life appears 25% sooner.' },
    lum: 0.8,
    light: 0.9,
    wind: 1,
    spark: 0.75,
  },
  yellow: {
    name: { es: 'Estrella amarilla', en: 'Yellow star' },
    desc: { es: 'Como el Sol.', en: 'Like the Sun.' },
    lum: 1,
    light: 1,
    wind: 1,
    spark: 1,
  },
  white: {
    name: { es: 'Estrella blanco-amarilla', en: 'Yellow-white star' },
    desc: {
      es: 'Más brillante (×1,25) y con más luz estelar (×1,2), pero su viento arranca un 50 % más rápido el aire de los mundos sin campo magnético.',
      en: 'Brighter (×1.25) with more starlight (×1.2), but its wind strips the air of worlds without a magnetic field 50% faster.',
    },
    lum: 1.25,
    light: 1.2,
    wind: 1.5,
    spark: 1,
  },
};

export const starOf = (s: GameState) => STAR_TYPES[s.star ?? 'yellow'];

/** What a system that reached the stars can hand on to the next one. */
export const HEIRLOOMS: Record<Heirloom, { icon: string; name: Bi; desc: Bi }> = {
  faith: {
    icon: '❂',
    name: { es: 'Memoria de la fe', en: 'Memory of faith' },
    desc: { es: 'Cada pueblo nace creyendo un poco más en la estrella (fe del 25 % en lugar del 12 %).', en: 'Every people is born believing a little more in the star (25% faith instead of 12%).' },
  },
  fertile: {
    icon: '❦',
    name: { es: 'Polvo fértil', en: 'Fertile dust' },
    desc: { es: 'La vida aparece antes (14 s de mundo habitable en lugar de 30) y la luz estelar empieza llena (100).', en: 'Life appears sooner (14 s of a habitable world instead of 30) and starlight starts full (100).' },
  },
  relic: {
    icon: '◬',
    name: { es: 'Reliquia de los Precursores', en: 'Relic of the Precursors' },
    desc: {
      es: 'El nuevo sistema empieza con una reliquia: la forja de los Space Patrols necesita una menos, y los Patrols de urgencia no quedan limitados a 2 compañías.',
      en: 'The new system starts with a relic: the Space Patrols’ forge needs one fewer, and emergency Patrols are not held to 2 companies.',
    },
  },
};
