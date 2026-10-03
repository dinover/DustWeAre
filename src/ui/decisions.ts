import { int, tr } from '../i18n';
import type { Decision, GameState, Resources } from '../core/state';
import { capName } from '../content/names';
import { RES_ICON, RES_KEYS, type CivSim } from '../sim/civ';
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
  const mine = s.species?.name ?? '';
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
        body: tr(
          `Bajo el suelo de ${wn}, los ${mine} encuentran una estructura que nadie de este sistema construyó.`,
          `Beneath the ground of ${wn}, the ${capName(mine)} find a structure that no one in this system built.`,
        ),
        yes: tr('Estudiarlo · ✦ 40', 'Study it · ✦ 40'),
        yesOk: civ.canAfford({ science: 40 }),
        no: tr('Sellarlo', 'Seal it'),
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
