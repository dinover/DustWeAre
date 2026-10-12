import { int, pick, tr } from '../i18n';
import type { Decision, GameState, Resources, Risk, WingSize } from '../core/state';
import { capName, invaderNames } from '../content/names';
import { RES_ICON, RES_KEYS, type CivSim } from '../sim/civ';
import { peopleOf } from '../sim/peoples';
import { PATROL_COST, casualtyRisk, companiesFor, strikeCost, troubleRisk, type PatrolSim } from '../sim/patrols';
import { threatOf } from '../sim/threat';
import { WING_SIZES, WING_UNITS, wingOdds, type WingsSim } from '../sim/wings';
import type { DecisionView } from './Hud';
import { resName } from './Projects';
import { NATIVE_COST, STAGE_NAMES } from '../sim/system';
import { USE_INFO } from '../sim/uses';
import { SIGN_COST } from '../sim/faith';
import { PLEA } from '../sim/voices';
import { worldStats } from '../sim/worlds';

const list = (r: Partial<Resources> | undefined) =>
  RES_KEYS.filter((k) => r?.[k])
    .map((k) => `<b>${RES_ICON[k]} ${int(r![k]!)}</b> ${resName(k)}`)
    .join(', ');

/** What sending companies of Space Patrols means: a victory, perhaps at a price. */
export function patrolTip(need: number, s: GameState) {
  const p = Math.round(casualtyRisk(threatOf(s), need) * 100);
  const who = tr(need === 2 ? 'Dos compañías' : 'Una compañía', need === 2 ? 'Two companies' : 'One company');
  return p
    ? tr(`${who} de los Space Patrols: vencen siempre, pero con esta amenaza pueden volver con bajas (${p} %: se pierde una compañía).`, `${who} of the Space Patrols: they always win, but with this threat they may come back with losses (${p}%: a company is lost).`)
    : tr(`${who} de los Space Patrols: vencen siempre, sin bajas a este nivel de amenaza.`, `${who} of the Space Patrols: they always win, with no losses at this threat level.`);
}

/** A trouble's risk, as a coloured word. */
export const riskText = (r: Risk, cap = false) => {
  const t = { low: tr('riesgo bajo', 'low risk'), mid: tr('riesgo medio', 'medium risk'), high: tr('riesgo alto', 'high risk') }[r];
  return `<span class="risk ${r}">${cap ? t.charAt(0).toUpperCase() + t.slice(1) : t}</span>`;
};

/** What a Freedom Wings sortie of this size can expect against this risk. */
export function wingForecast(size: WingSize, risk: Risk) {
  const o = wingOdds(size, risk);
  const p = Math.round(o.win * 100);
  if (o.diff >= 1) return tr(`Flota sobrada: gana (${p} %) antes y con pocas bajas.`, `More than enough: it wins (${p}%) sooner and with few losses.`);
  if (o.diff === 0) return tr(`Flota a la medida del riesgo: ${p} % de victoria, con algunas bajas.`, `Sized to the risk: ${p}% to win, with some losses.`);
  if (o.diff === -1) return tr(`Flota corta para este riesgo: solo ${p} % de victoria y muchas bajas.`, `Too small for this risk: only ${p}% to win and heavy losses.`);
  return tr(`Flota demasiado chica: ${p} % de victoria; lo más probable es perderla entera.`, `Far too small: ${p}% to win; it will most likely be lost entirely.`);
}

/** Writes a pending choice in the current language. */
export function decisionView(d: Decision, s: GameState, civ: CivSim, forces?: { patrols: PatrolSim; wings: WingsSim }): DecisionView {
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
      const [al, AL] = invaderNames(s.alienSpecies);
      const p = s.patrol;
      const icons = { pirates: '☠', natives: '⚑', invaders: '⚠', plague: '☣' };
      const what = {
        pirates: tr(`Piratas del vacío saquean la colonia ${who} de ${where}.`, `Void pirates are plundering the ${capName(who)} colony at ${where}.`),
        natives: tr(`Los nativos de ${where} se alzan contra el dominio del sistema.`, `The natives of ${where} rise against the system’s rule.`),
        invaders: tr(`Los ${al} asedian la colonia ${who} de ${where}.`, `The ${AL} besiege the ${capName(who)} colony at ${where}.`),
        plague: tr(`Una plaga diezma la colonia ${who} de ${where}.`, `A plague is ravaging the ${capName(who)} colony at ${where}.`),
      }[kind];
      const res = s.civ?.res;
      const can = (c: Partial<Resources>) => !!res && RES_KEYS.every((k) => res[k] >= (c[k] ?? 0));
      const risk = (st && troubleRisk(st)) ?? 'low';
      const options: NonNullable<DecisionView['options']> = [];
      if (st && forces && p) {
        const need = companiesFor(risk);
        const lock = forces.patrols.strikeLock(st, false);
        options.push({
          choice: 0,
          primary: true,
          label: `⛨ Patrols ×${need} · ◍ ${strikeCost(st, false).fuel}`,
          ok: !lock,
          tip: lock
            ? pick(lock)
            : patrolTip(need, s),
        });
      }
      if (st && forces && s.wings)
        WING_SIZES.forEach((z, i) => {
          const lock = forces.wings.lock(st, z);
          options.push({ choice: i + 1, label: `✈ ${z} · ${WING_UNITS[z]}`, ok: !lock, tip: `<b>Freedom Wings ${z}</b> · ${WING_UNITS[z]} ${tr('naves', 'ships')}<br>${lock ? pick(lock) : wingForecast(z, risk)}` });
        });
      return {
        ...base,
        icon: icons[kind],
        title: tr(`Socorro desde ${where}`, `A call for help from ${where}`),
        body: options.length
          ? `${what} ${riskText(risk, true)}. ${tr('¿A quién envías?', 'Who will you send?')}`
          : `${what} ${riskText(risk, true)}. ${tr('Aún no hay Space Patrols ni Freedom Wings, pero una flotilla de socorro podría bastar.', 'There are no Space Patrols or Freedom Wings yet, but a relief flotilla might be enough.')}`,
        yes: tr('Enviar socorro · ◍ 40', 'Send relief · ◍ 40'),
        yesOk: can(PATROL_COST.relief),
        options: options.length ? options : undefined,
        no: tr('Que resistan solos', 'Let them hold out alone'),
      };
    }
    // After a long, cruel war, the peoples pray to the star.
    case 'plea': {
      const wars = (s.relations ?? []).filter((r) => r.state === 'war').length;
      const dom = (s.stars ?? []).filter((x) => x.mode === 'dominion').length;
      return {
        ...base,
        icon: '❝',
        title: tr('Una plegaria a la estrella', 'A prayer to the star'),
        body: wars
          ? tr(
              `En todos los mundos de ${s.name}, a la misma hora, los pueblos rezan a la misma estrella. No saben si alguien escucha. Solo piden una cosa: que terminen las guerras.`,
              `On every world of ${s.name}, at the same hour, the peoples pray to the same star. They do not know whether anyone is listening. They ask for one thing only: that the wars end.`,
            )
          : dom
            ? tr(`Desde los dominios llega una súplica que nadie se atreve a firmar: que los dejen volver a ser libres.`, `From the dominions comes a plea no one dares to sign: to be allowed to be free again.`)
            : tr(`Los pueblos tienen miedo de su propia estrella. Rezan para que su luz vuelva a ser mansa.`, `The peoples fear their own star. They pray for its light to be gentle again.`),
        yes: wars
          ? tr(`Concederles la paz · ☀ ${PLEA.cost}`, `Grant them peace · ☀ ${PLEA.cost}`)
          : dom
            ? tr('Liberar los dominios', 'Free the dominions')
            : tr(`Escucharlos · ☀ ${PLEA.listen}`, `Listen to them · ☀ ${PLEA.listen}`),
        yesOk: wars ? s.energy >= PLEA.cost : dom ? true : s.energy >= PLEA.listen,
        no: tr('Seguir mirando', 'Keep watching'),
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
    // Natives living under someone else's colony: the star may shelter them, or let them be wiped out.
    case 'natives': {
      const settlers = nameOf(w?.owner);
      const life = w?.life;
      const natives = life?.people ? nameOf(life.people) : '';
      const stage = life ? pick(STAGE_NAMES[life.stage]).toLowerCase() : '';
      const use = w?.use ? pick(USE_INFO[w.use].name).toLowerCase() : '';
      return {
        ...base,
        icon: '❦',
        title: tr(`Nativos en ${wn}`, `Natives on ${wn}`),
        body: natives
          ? tr(
              `Los colonos ${settlers} de ${wn} viven junto a un pueblo nativo, los ${natives}, y sus ${use} los arrinconan. Si sobreviven hasta construir ciudades, recuperarán su mundo… o se mezclarán con los colonos.`,
              `The ${capName(settlers)} settlers of ${wn} live beside a native people, the ${capName(natives)}, and their ${use} are pushing them aside. If they survive to build cities, they will take their world back… or blend with the settlers.`,
            )
          : tr(
              `En ${wn}, entre los ${use} de los colonos ${settlers}, la vida nativa se abre paso (${stage}). Los colonos no saben si cuidarla o despejar el terreno.`,
              `On ${wn}, among the ${use} of the ${capName(settlers)} settlers, native life is making its way (${stage}). The settlers do not know whether to look after it or clear the ground.`,
            ),
        yes: '',
        yesOk: false,
        options: [
          {
            choice: 1,
            primary: true,
            label: tr(`Protegerlos · ☀ ${NATIVE_COST.protect}`, `Protect them · ☀ ${NATIVE_COST.protect}`),
            ok: s.energy >= NATIVE_COST.protect,
            tip: tr('Una reserva: los colonos apenas los molestan. Si llegan a construir ciudades, lo más probable es que se mezclen en paz.', 'A reserve: the settlers hardly bother them. If they ever build cities, they will most likely blend in peace.'),
          },
          {
            choice: 2,
            label: tr('Que los exterminen', 'Let them be wiped out'),
            ok: true,
            tip: tr('Los colonos despejan el mundo: matan a la mayoría, ganan metal y crecen más rápido. Los pueblos lo recordarán.', 'The settlers clear the world: they kill most of them, gain metal and grow faster. The peoples will remember.'),
          },
        ],
        no: tr('Que convivan como puedan', 'Let them get along'),
      };
    }
    // A people struck by a catastrophe prays for something concrete.
    case 'prayer': {
      const who = nameOf(d.people);
      const W = capName(who);
      const T = w ? Math.round(worldStats(w, s.worlds, s.L * s.dial).T - 273) : 0;
      const look = {
        warm: {
          icon: '☀',
          title: tr(`Calor para ${wn}`, `Warmth for ${wn}`),
          body: tr(
            `Los ${who} de ${wn} rezan: la era glacial los está matando de frío (ahora ${T} °C). Despierta sus volcanes, bendícelos, sube el brillo de la estrella o acerca el mundo a ella.`,
            `The ${W} of ${wn} pray: the ice age is freezing them to death (now ${T} °C). Wake its volcanoes, bless them, raise the star’s brightness or bring the world closer to it.`,
          ),
        },
        cool: {
          icon: '❄',
          title: tr(`Frescor para ${wn}`, `Coolness for ${wn}`),
          body: tr(
            `Los ${who} de ${wn} rezan: el calor los está ahogando (ahora ${T} °C). Bendícelos, baja el brillo de la estrella o aleja el mundo de ella.`,
            `The ${W} of ${wn} pray: the heat is choking them (now ${T} °C). Bless them, lower the star’s brightness or move the world away from it.`,
          ),
        },
        deflect: {
          icon: '☄',
          title: tr(`Desvía la roca de ${wn}`, `Turn the rock from ${wn}`),
          body: tr(
            `Un asteroide cae hacia ${wn}. Los ${who} rezan para que la estrella lo desvíe: una llamarada sobre el mundo o sobre la roca.`,
            `An asteroid is falling towards ${wn}. The ${W} pray for the star to turn it aside: a flare on the world or on the rock.`,
          ),
        },
      }[d.goal ?? 'deflect'];
      return {
        ...base,
        icon: look.icon,
        title: look.title,
        body: `${look.body} <i>${tr('Si la estrella responde, creerán más en ella.', 'If the star answers, they will believe in it more.')}</i>`,
        yes: tr('Ir a verlo', 'Go and see'),
        yesOk: true,
        no: tr('No escuchar', 'Do not listen'),
      };
    }
    // The Order of the Star asks for a sign.
    case 'sign':
      return {
        ...base,
        icon: '❂',
        title: tr('La Orden pide una señal', 'The Order asks for a sign'),
        body: tr(
          'En todos los templos de la Orden de la Estrella rezan a la vez. Piden una señal de que alguien los escucha. Un halo sobre la estrella avivaría su fe… y su trabajo.',
          'In every temple of the Order of the Star they pray at once. They ask for a sign that someone is listening. A halo around the star would kindle their faith… and their work.',
        ),
        yes: tr(`Darles una señal · ☀ ${SIGN_COST}`, `Give them a sign · ☀ ${SIGN_COST}`),
        yesOk: s.energy >= SIGN_COST,
        no: tr('Guardar silencio', 'Keep silent'),
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
