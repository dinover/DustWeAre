import type { Bi } from '../i18n';
import type { Resources } from '../core/state';

export type ProjectId = 'elevator' | 'mining' | 'refinery' | 'shield' | 'fleet' | 'ring' | 'warp' | 'dyson' | 'armada' | 'ark';

export interface ProjectDef {
  id: ProjectId;
  icon: string;
  /** 1 interplanetary · 2 stellar · 3 galactic */
  era: 1 | 2 | 3;
  cost: Partial<Resources>;
  /** Build time in seconds (game speed 1). */
  time: number;
  name: Bi;
  desc: Bi;
  effect: Bi;
}

export const ERA_NAMES: Bi[] = [
  { es: 'Era espacial', en: 'Space age' },
  { es: 'Era interplanetaria', en: 'Interplanetary age' },
  { es: 'Era estelar', en: 'Stellar age' },
  { es: 'Era galáctica', en: 'Galactic age' },
];

/** Great works the civilization can build, roughly in order. */
export const PROJECTS: ProjectDef[] = [
  {
    id: 'elevator',
    icon: '⇡',
    era: 1,
    cost: { metal: 60, science: 40 },
    time: 30,
    name: { es: 'Ascensor espacial', en: 'Space elevator' },
    desc: { es: 'Un cable de diamante une el mundo natal con una estación en órbita: subir al espacio ya no cuesta casi nada.', en: 'A diamond cable joins the home world to a station in orbit: reaching space now costs almost nothing.' },
    effect: { es: 'Las naves salen más a menudo.', en: 'Ships launch more often.' },
  },
  {
    id: 'mining',
    icon: '⛏',
    era: 1,
    cost: { metal: 50, fuel: 30, science: 50 },
    time: 35,
    name: { es: 'Minería de asteroides', en: 'Asteroid mining' },
    desc: { es: 'Enjambres de mineros recorren los cinturones de asteroides, los restos del disco donde nació todo.', en: 'Swarms of miners roam the asteroid belts, the leftovers of the disk where everything began.' },
    effect: { es: '+0,6 de metal por segundo.', en: '+0.6 metal per second.' },
  },
  {
    id: 'refinery',
    icon: '◍',
    era: 1,
    cost: { metal: 80, science: 60 },
    time: 40,
    name: { es: 'Refinerías en las nubes', en: 'Cloud refineries' },
    desc: { es: 'Ciudades flotantes filtran helio-3 y deuterio de la atmósfera de los gigantes: el combustible de las estrellas.', en: 'Floating cities filter helium-3 and deuterium out of the giants’ atmospheres: the fuel of the stars.' },
    effect: { es: 'Los gigantes colonizados dan el doble de combustible.', en: 'Settled giants yield twice as much fuel.' },
  },
  {
    id: 'shield',
    icon: '⛨',
    era: 1,
    cost: { metal: 120, water: 50, science: 90 },
    time: 45,
    name: { es: 'Escudo planetario', en: 'Planetary shield' },
    desc: { es: 'Láseres en órbita vigilan el cielo de cada colonia y pulverizan las rocas que se acercan.', en: 'Orbital lasers watch over every colony’s sky and shatter incoming rocks.' },
    effect: { es: 'Los asteroides ya no alcanzan tus mundos habitados; resiste supernovas y superllamaradas.', en: 'Asteroids no longer reach your settled worlds; it withstands supernovae and superflares.' },
  },
  {
    id: 'fleet',
    icon: '⟁',
    era: 2,
    cost: { metal: 160, fuel: 80, science: 80 },
    time: 50,
    name: { es: 'Flota de defensa', en: 'Defence fleet' },
    desc: { es: 'Naves de guardia patrullan cada mundo habitado y salen al encuentro de cualquier intruso.', en: 'Guard ships patrol every settled world and fly out to meet any intruder.' },
    effect: { es: 'Las naves invasoras son interceptadas antes de llegar.', en: 'Invading ships are intercepted before they arrive.' },
  },
  {
    id: 'ring',
    icon: '◎',
    era: 2,
    cost: { metal: 220, water: 60, science: 150 },
    time: 60,
    name: { es: 'Anillo orbital', en: 'Orbital ring' },
    desc: { es: 'Un anillo habitado rodea el mundo natal: millones viven entre las nubes y las estrellas.', en: 'An inhabited ring circles the home world: millions live between the clouds and the stars.' },
    effect: { es: 'La ciencia crece un 50 %.', en: 'Science grows by 50%.' },
  },
  {
    id: 'warp',
    icon: '✶',
    era: 2,
    cost: { metal: 150, fuel: 200, science: 250 },
    time: 70,
    name: { es: 'Motor de curvatura', en: 'Warp drive' },
    desc: { es: 'Doblar el espacio para cruzarlo: la distancia entre estrellas deja de ser una cárcel.', en: 'Fold space to cross it: the distance between stars is no longer a prison.' },
    effect: { es: 'Permite enviar expediciones a otras estrellas.', en: 'Lets you send expeditions to other stars.' },
  },
  {
    id: 'dyson',
    icon: '☼',
    era: 3,
    cost: { metal: 500, science: 300 },
    time: 90,
    name: { es: 'Enjambre de Dyson', en: 'Dyson swarm' },
    desc: { es: 'Miles de colectores orbitan la estrella y beben su luz.', en: 'Thousands of collectors orbit the star and drink its light.' },
    effect: { es: 'Triple de luz estelar y un depósito el doble de grande.', en: 'Triple starlight and a store twice as large.' },
  },
  {
    id: 'armada',
    icon: '⚔',
    era: 3,
    cost: { metal: 300, fuel: 300, science: 200 },
    time: 80,
    name: { es: 'Armada interestelar', en: 'Interstellar armada' },
    desc: { es: 'Astilleros en órbita preparan una flota capaz de saltar a otra estrella en formación de combate.', en: 'Orbital shipyards prepare a fleet able to jump to another star in battle formation.' },
    effect: { es: 'Permite lanzar la armada contra los invasores o hacia lo desconocido.', en: 'Lets you launch the armada against the invaders or into the unknown.' },
  },
  {
    id: 'ark',
    icon: '✧',
    era: 3,
    cost: { metal: 400, fuel: 400, water: 200, science: 300 },
    time: 100,
    name: { es: 'Arca estelar', en: 'Star ark' },
    desc: { es: 'Una nave-mundo que llevará la vida de este sistema a una estrella nueva.', en: 'A world-ship that will carry this system’s life to a new star.' },
    effect: { es: 'Siembra otro sistema solar.', en: 'Seeds another solar system.' },
  },
];

/** Technologies discovered one after another once the great works are under way. */
export const TECHS: { es: string; en: string }[] = [
  { es: 'Fusión compacta', en: 'Compact fusion' },
  { es: 'Velas de luz', en: 'Light sails' },
  { es: 'Biología del vacío', en: 'Vacuum biology' },
  { es: 'Computación de cristal', en: 'Crystal computing' },
  { es: 'Ingeniería de lunas', en: 'Moon engineering' },
  { es: 'Comunicación cuántica', en: 'Quantum communication' },
  { es: 'Escudos de plasma', en: 'Plasma shields' },
  { es: 'Arquitectura viva', en: 'Living architecture' },
  { es: 'Reactores de antimateria', en: 'Antimatter reactors' },
  { es: 'Medicina de mil años', en: 'Thousand-year medicine' },
  { es: 'Forja de estrellas enanas', en: 'Dwarf-star forges' },
  { es: 'Mapas del espacio plegado', en: 'Folded-space charts' },
];

export const researchCost = (level: number) => ({ science: Math.round(180 * Math.pow(1.35, level)), metal: Math.round(50 * Math.pow(1.3, level)) });

export const MISSION_COST = {
  expedition: { fuel: 60 } as Partial<Resources>,
  armada: { metal: 150, fuel: 250 } as Partial<Resources>,
};
