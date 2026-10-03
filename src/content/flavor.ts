import type { Bi } from '../i18n';

/**
 * Small moments of history between the big events. {w} and {v} are two settled worlds,
 * {g} a gas giant, {m} a moon, {s} the species (lower case in Spanish, capitalised in English).
 */
export const FLAVOR: (Bi & { needs?: ('g' | 'm' | 'v')[] })[] = [
  { es: 'Los {s} inauguran en {w} una universidad dedicada a estudiar las estrellas.', en: 'The {s} open a university on {w} devoted to studying the stars.' },
  { es: 'Una sonda de los {s} fotografía las tormentas de {g}: la imagen recorre todo el sistema.', en: 'A {s} probe photographs the storms of {g}: the picture travels across the whole system.', needs: ['g'] },
  { es: 'En {w} crece la primera generación que nunca vio el cielo de su mundo natal.', en: 'On {w} the first generation grows up that has never seen the sky of its home world.' },
  { es: 'Músicos de {w} y {v} tocan juntos a través del vacío, con minutos de retraso entre nota y nota.', en: 'Musicians on {w} and {v} play together across the void, with minutes of delay between notes.', needs: ['v'] },
  { es: 'Bajo el hielo de {m} aparecen microbios fósiles: la vida lo intentó también allí.', en: 'Fossil microbes turn up under the ice of {m}: life tried there too.', needs: ['m'] },
  { es: 'Una regata de veleros solares une {w} y {v}. Gana una tripulación de jubilados.', en: 'A solar-sail regatta links {w} and {v}. A crew of retirees wins.', needs: ['v'] },
  { es: 'Se firma la Carta de los Mundos: cada colonia tendrá voz en el consejo de los {s}.', en: 'The Charter of Worlds is signed: every colony will have a voice in the council of the {s}.' },
  { es: 'Los astrónomos {s} detectan planetas alrededor de una estrella vecina. Alguien ya les está poniendo nombre.', en: '{s} astronomers detect planets around a neighbouring star. Someone is already naming them.' },
  { es: 'Un festival de luces ilumina el lado nocturno de {w} durante una semana entera.', en: 'A festival of lights fills the night side of {w} for a whole week.' },
  { es: 'Los {s} aprenden a cultivar bosques en gravedad cero. Los árboles crecen en espiral.', en: 'The {s} learn to grow forests in zero gravity. The trees grow in spirals.' },
  { es: 'En {w} abre un museo dedicado al polvo del que nació el sistema.', en: 'A museum devoted to the dust the system was born from opens on {w}.' },
  { es: 'Una tormenta de {g} es tan grande que los {s} le ponen nombre: «el Ojo».', en: 'A storm on {g} is so large the {s} give it a name: “the Eye”.', needs: ['g'] },
  { es: 'Los niños de {w} hacen un concurso para nombrar la nave más vieja del sistema.', en: 'The children of {w} hold a contest to name the oldest ship in the system.' },
  { es: 'Un poeta de {v} escribe que todos somos polvo que aprendió a mirar hacia arriba.', en: 'A poet from {v} writes that we are all dust that learned to look up.', needs: ['v'] },
  { es: 'Los {s} instalan un gran telescopio en la cara oculta de {m}.', en: 'The {s} build a great telescope on the far side of {m}.', needs: ['m'] },
  { es: 'Por primera vez, nacen más {s} fuera del mundo natal que dentro de él.', en: 'For the first time, more {s} are born away from the home world than on it.' },
  { es: 'Los archivos de los {s} ya guardan diez mil años de historia escrita.', en: 'The archives of the {s} now hold ten thousand years of written history.' },
  { es: 'Un equipo de {w} logra que un jardín florezca en el vacío, dentro de una burbuja de vidrio.', en: 'A team on {w} gets a garden to bloom in the void, inside a glass bubble.' },
];
