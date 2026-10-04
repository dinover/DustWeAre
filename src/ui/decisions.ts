import { int, tr } from '../i18n';
import type { Decision, GameState, Resources } from '../core/state';
import { capName } from '../content/names';
import { RES_ICON, RES_KEYS, type CivSim } from '../sim/civ';
import { peopleOf } from '../sim/peoples';
import { PATROL_COST } from '../sim/patrols';
import type { DecisionView } from './Hud';
import { resName } from './Projects';

const list = (r: Partial<Resources> | undefined) =>
  RES_KEYS.filter((k) => r?.[k])
    .map((k) => `<b>${RES_ICON[k]} ${int(r![k]!)}</b> ${resName(k)}`)
    .join(', ');

/** Writes a pending choice in the current language. */
export function decisionView(d: Decision, s: GameState, civ: CivSim): DecisionView {
  const w = d.world !== undefined ? s.worlds.find((x) => x.id === d.world) : undefined;
  const wn = w?.name ?? '';
  const spEs = d.species ?? '';
  const spEn = capName(d.species ?? '');
  const nameOf = (id: number | undefined) => s.peoples?.find((p) => p.id === id)?.name ?? '';
  const local = w ? nameOf(peopleOf(w)) : '';
  const [pa, pb] = (d.pair ?? [0, 0]).map(nameOf);
  const base = { id: d.id, left: d.left, dur: d.dur };
  switch (d.kind) {
    case 'trade':
      return {
        ...base,
        icon: '⚖',
        title: tr(`Mercaderes ${spEs}`, `${spEn} traders`),
        body: tr(`Su caravana espera junto a ${wn}. Ofrecen ${list(d.get)} a cambio de ${list(d.give)}.`, `Their caravan waits by ${wn}. They offer ${list(d.get)} in exchange for ${list(d.give)}.`),
        yes: tr('Aceptar el trato', 'Accept the deal'),
        yesOk: civ.canAfford(d.give ?? {}),
        no: tr('No, gracias', 'No, thanks'),
      };
    case 'refugees':
      return {
        ...base,
        icon: '⌂',
        title: tr('Refugiados de las estrellas', 'Refugees from the stars'),
        body: tr(
          `Los ${spEs} huyen de una estrella que se apaga. Piden ${wn} para vivir y, a cambio, compartirán su ciencia.`,
          `The ${spEn} are fleeing a dying star. They ask for ${wn} to live on and, in return, will share their science.`,
        ),
        yes: tr(`Darles ${wn}`, `Give them ${wn}`),
        yesOk: true,
        no: tr('Que sigan su camino', 'Let them move on'),
      };
    case 'signal':
      return {
        ...base,
        icon: '✶',
        title: tr('Una señal de auxilio', 'A distress call'),
        body: tr('Desde una estrella cercana, alguien pide ayuda en una lengua que nadie conoce.', 'From a nearby star, someone is calling for help in a language no one knows.'),
        yes: tr('Enviar ayuda · ◍ 60', 'Send help · ◍ 60'),
        yesOk: civ.canAfford({ fuel: 60 }),
        no: tr('Ignorarla', 'Ignore it'),
      };
    case 'artifact':
      return {
        ...base,
        icon: '◬',
        title: tr(`Un artefacto en ${wn}`, `An artefact on ${wn}`),
        body: local
          ? tr(
              `Bajo el suelo de ${wn}, los ${local} encuentran una estructura que nadie de este sistema construyó.`,
              `Beneath the ground of ${wn}, the ${capName(local)} find a structure that no one in this system built.`,
            )
          : tr(`Bajo el suelo de ${wn} aparece una estructura que nadie de este sistema construyó.`, `Beneath the ground of ${wn} lies a structure that no one in this system built.`),
        yes: tr('Estudiarlo · ✦ 40', 'Study it · ✦ 40'),
        yesOk: civ.canAfford({ science: 40 }),
        no: tr('Sellarlo', 'Seal it'),
      };
    // A colony around another star asks for help.
    case 'outpost': {
      const st = s.stars?.find((x) => x.id === d.star);
      const who = nameOf(st?.people);
      const where = st?.name ?? '';
      const kind = st?.trouble?.kind ?? 'pirates';
      const al = s.alienSpecies?.name ?? '';
      const p = s.patrol;
      const icons = { pirates: '☠', natives: '⚑', invaders: '⚠', plague: '☣' };
      const what = {
        pirates: tr(`Piratas del vacío saquean la colonia ${who} de ${where}.`, `Void pirates are plundering the ${capName(who)} colony at ${where}.`),
        natives: tr(`Los nativos de ${where} se alzan contra el dominio del sistema.`, `The natives of ${where} rise against the system’s rule.`),
        invaders: tr(`Los ${al} asedian la colonia ${who} de ${where}.`, `The ${capName(al)} besiege the ${capName(who)} colony at ${where}.`),
        plague: tr(`Una plaga diezma la colonia ${who} de ${where}.`, `A plague is ravaging the ${capName(who)} colony at ${where}.`),
      }[kind];
      const res = s.civ?.res;
      const can = (c: Partial<Resources>) => !!res && RES_KEYS.every((k) => res[k] >= (c[k] ?? 0));
      return {
        ...base,
        icon: icons[kind],
        title: tr(`Socorro desde ${where}`, `A call for help from ${where}`),
        body: p
          ? `${what} ${p.phase === 'away' ? tr('Los Space Patrols están en otra estrella.', 'The Space Patrols are at another star.') : tr('¿Envías a los Space Patrols?', 'Will you send the Space Patrols?')}`
          : `${what} ${tr('Aún no hay Space Patrols, pero una flotilla de socorro podría bastar.', 'There are no Space Patrols yet, but a relief flotilla might be enough.')}`,
        yes: p ? tr('Enviar a los Space Patrols · ◍ 50', 'Send the Space Patrols · ◍ 50') : tr('Enviar socorro · ◍ 40', 'Send relief · ◍ 40'),
        yesOk: p ? p.phase !== 'away' && p.phase !== 'rising' && can(PATROL_COST.help) : can(PATROL_COST.relief),
        no: tr('Que resistan solos', 'Let them hold out alone'),
      };
    }
    case 'annex': {
      const st = s.stars?.find((x) => x.id === d.star);
      const where = st?.name ?? '';
      return {
        ...base,
        icon: '⚑',
        title: tr(`¿Anexar ${where}?`, `Annex ${where}?`),
        body: tr(
          `Los Space Patrols controlan el sistema de ${where}. Como dominio, sus minas y refinerías pagarían tributo, mucho más que el comercio… pero el sistema se ganaría enemigos y más invasiones.`,
          `The Space Patrols hold the system of ${where}. As a dominion, its mines and refineries would pay tribute, far more than trade… but the system would make enemies and draw more invasions.`,
        ),
        yes: tr('Anexarlo', 'Annex it'),
        yesOk: true,
        no: tr('Dejarlo libre: solo comercio', 'Leave it free: trade only'),
      };
    }
    // Quarrels between the peoples: the player may step in with the star's light, or let them be.
    case 'tension':
      return {
        ...base,
        icon: '⚡',
        title: tr(`Tensión entre los ${pa} y los ${pb}`, `Tension between the ${capName(pa)} and the ${capName(pb)}`),
        body: tr(
          `Las disputas crecen y los dos pueblos se miran con recelo. Una aurora sobre sus mundos les recordaría que comparten la misma estrella… o puedes dejar que lo resuelvan solos.`,
          `The quarrels grow and the two peoples eye each other warily. An aurora over their worlds would remind them that they share the same star… or you can let them sort it out alone.`,
        ),
        yes: tr('Calmar los ánimos · ☀ 25', 'Calm things down · ☀ 25'),
        yesOk: s.energy >= 25,
        no: tr('No intervenir', 'Stay out of it'),
      };
    case 'war':
      return {
        ...base,
        icon: '⚔',
        title: tr(`Guerra entre los ${pa} y los ${pb}`, `War between the ${capName(pa)} and the ${capName(pb)}`),
        body: tr(
          `Sus flotas ya se atacan entre los mundos. La estrella podría brillar con furia entre ellos e imponer una tregua, aunque ninguno de los dos quedaría contento.`,
          `Their fleets are already striking each other between the worlds. The star could blaze between them and force a truce, though neither side would be pleased.`,
        ),
        yes: tr('Imponer una tregua · ☀ 40', 'Force a truce · ☀ 40'),
        yesOk: s.energy >= 40,
        no: tr('Que decidan las armas', 'Let the weapons decide'),
      };
    default:
      return {
        ...base,
        icon: '●',
        title: tr('Capturar el planeta errante', 'Capture the wandering planet'),
        body: tr('La flota podría frenarlo y dejarlo en órbita: un mundo nuevo para tu sistema.', 'The fleet could slow it down and leave it in orbit: a new world for your system.'),
        yes: tr('Capturarlo · ◍ 100 ⛏ 50', 'Capture it · ◍ 100 ⛏ 50'),
        yesOk: civ.canAfford({ fuel: 100, metal: 50 }),
        no: tr('Dejarlo pasar', 'Let it pass'),
      };
  }
}
