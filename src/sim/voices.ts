import type { Decision, GameState, World } from '../core/state';
import type { Rng } from '../util';
import { capName } from '../content/names';
import type { PeopleSim } from './peoples';

/** The harm the player's own choices have caused (it fades slowly). */
export function addHarm(s: GameState, n: number) {
  s.harm = Math.max(0, (s.harm ?? 0) + n);
}

/** One hour of real play before the peoples start to speak. */
export const VOICES_AFTER = 3600;
const HARM_VOICES = 20;
const HARM_PLEA = 32;
const PLEA_COST = 60;

export interface VoicesHost {
  s: GameState;
  rng: Rng;
  nid(): number;
  news(icon: string, es: string, en: string, kind?: 'info' | 'good' | 'warn' | 'life' | 'alien' | 'fact' | 'voice'): void;
  readonly peoples: PeopleSim;
}

type Line = { es: string; en: string };
type Fill = { p: string; e: string; w: string; s: string };

const WAR: ((f: Fill) => Line)[] = [
  (f) => ({ es: `En ${f.w}, una niña ${f.p} deja una vela en la ventana: «Que la estrella nos oiga. Que pare ya.»`, en: `On ${f.w}, a ${capName(f.p)} girl leaves a candle in the window: “May the star hear us. Make it stop.”` }),
  (f) => ({ es: `Un soldado ${f.p} escribe a casa: «Vi arder las ciudades de los ${f.e} desde la órbita. Ya no sé por qué peleamos.»`, en: `A ${capName(f.p)} soldier writes home: “I watched the cities of the ${capName(f.e)} burn from orbit. I no longer know why we fight.”` }),
  (f) => ({ es: `Los templos de ${f.w} están llenos. Rezan a la estrella, la misma que mira la guerra y no hace nada.`, en: `The temples of ${f.w} are full. They pray to the star — the same star that watches the war and does nothing.` }),
  (f) => ({ es: `«Contamos las naves que no vuelven. Ya no nos alcanzan los dedos», dice una pescadora de ${f.w}.`, en: `“We count the ships that don't come back. We've run out of fingers,” says a fisherwoman on ${f.w}.` }),
  (f) => ({ es: `Un médico ${f.p} en ${f.w}: «Ya no me quedan vendas. Me quedan nombres.»`, en: `A ${capName(f.p)} doctor on ${f.w}: “I have no bandages left. Only names.”` }),
  (f) => ({ es: `En ${f.w} cantan de noche para tapar el ruido de los bombardeos.`, en: `On ${f.w} they sing at night to drown out the bombardment.` }),
  (f) => ({ es: `Una piloto ${f.p} se niega a despegar: «Esta vez no. Que alguien, allá arriba, nos escuche.»`, en: `A ${capName(f.p)} pilot refuses to take off: “Not this time. Let someone up there hear us.”` }),
  (f) => ({ es: `Un anciano ${f.p}: «Mi abuelo me habló de la guerra. Juré que mis nietos no la verían. Les mentí.»`, en: `An old ${capName(f.p)} man: “My grandfather told me about the war. I swore my grandchildren would never see one. I lied to them.”` }),
  (f) => ({ es: `Pintado en un muro de ${f.w}: «¿Quién decide nuestras guerras?»`, en: `Painted on a wall on ${f.w}: “Who decides our wars?”` }),
  (f) => ({ es: `En los campos de refugiados, niños ${f.p} y ${f.e} juegan juntos. No entienden por qué sus padres no pueden.`, en: `In the refugee camps, ${capName(f.p)} and ${capName(f.e)} children play together. They don't understand why their parents can't.` }),
  (f) => ({ es: `«Vi caer el fuego sobre ${f.w}. Ya no hay calles: hay silencio», cuenta un superviviente ${f.p}.`, en: `“I saw the fire fall on ${f.w}. There are no streets any more — only silence,” says a ${capName(f.p)} survivor.` }),
];
const HARSH: ((f: Fill) => Line)[] = [
  (f) => ({ es: `Millones de ${f.p} encienden una luz a la misma hora, esperando que la estrella la vea. Una sola palabra: «Basta.»`, en: `Millions of ${capName(f.p)} light a lamp at the same hour, hoping the star will see it. A single word: “Enough.”` }),
  (f) => ({ es: `Una madre ${f.p} en ${f.w}: «Les enseñé a mis hijos a mirar las estrellas. Ahora les enseño a esconderse de ellas.»`, en: `A ${capName(f.p)} mother on ${f.w}: “I taught my children to look at the stars. Now I teach them to hide from them.”` }),
];
const SKY: ((f: Fill) => Line)[] = [
  (f) => ({ es: `En ${f.w} dicen que el cielo está enfadado. Las madres tapan a los niños cuando la estrella brilla demasiado.`, en: `On ${f.w} they say the sky is angry. Mothers cover their children whenever the star shines too bright.` }),
  (f) => ({ es: `Un astrónomo ${f.p} deja de mirar al cielo: «Antes la estrella nos daba vida. Ahora solo nos da miedo.»`, en: `A ${capName(f.p)} astronomer stops looking up: “The star used to give us life. Now it only gives us fear.”` }),
  (f) => ({ es: `Los ${f.p} de ${f.w} rezan de rodillas cada amanecer. Piden perdón, aunque no saben de qué.`, en: `The ${capName(f.p)} of ${f.w} kneel and pray every dawn. They ask forgiveness, though they don't know for what.` }),
];
const RULE: ((f: Fill) => Line)[] = [
  (f) => ({ es: `Llega un mensaje desde ${f.s}: «Nunca pedimos ser vuestros. Solo pedimos volver a ser libres.»`, en: `A message arrives from ${f.s}: “We never asked to be yours. We only ask to be free again.”` }),
  (f) => ({ es: `Los mineros de ${f.s} trabajan con la mirada baja. Cantan en una lengua que los Space Patrols tienen prohibida.`, en: `The miners of ${f.s} work with their eyes down. They sing in a language the Space Patrols have forbidden.` }),
];

/**
 * When the player has spent a long time being cruel — burning inhabited worlds, letting wars
 * rage, conquering — the peoples begin to speak: prayers, letters, things they saw. Only in the
 * late game, after an hour of play, and only if the harm is the player's own.
 */
export class VoicesSim {
  private nextVoice = 0;

  constructor(private h: VoicesHost) {}

  update(dt: number) {
    const s = this.h.s;
    // Wars the player chose not to stop keep weighing on them.
    for (const r of s.relations ?? []) if (r.state === 'war' && r.ignored) addHarm(s, dt * 0.03);
    s.harm = (s.harm ?? 0) * Math.exp(-dt / 2400);
    const harm = s.harm;
    if ((s.playTime ?? 0) < VOICES_AFTER || !s.civ || harm < HARM_VOICES || !this.h.peoples.alive().length) return;
    if (!this.nextVoice) this.nextVoice = s.time + 20;
    if (s.time >= this.nextVoice) {
      this.nextVoice = s.time + this.h.rng.range(100, 170) / (harm > 45 ? 1.6 : 1);
      this.speak(harm);
    }
    if (harm >= HARM_PLEA && s.time >= (s.pleaAt ?? 0) && !s.civ.decisions.some((d) => d.kind === 'plea')) {
      s.pleaAt = s.time + 600;
      s.civ.decisions.push({ id: this.h.nid(), kind: 'plea', left: 60, dur: 60 });
    }
  }

  private speak(harm: number) {
    const s = this.h.s;
    const rng = this.h.rng;
    const peoples = this.h.peoples;
    const wars = peoples.wars();
    const dominions = (s.stars ?? []).filter((x) => x.mode === 'dominion');
    let pool: ((f: Fill) => Line)[];
    let p = rng.pick(peoples.alive());
    let e = p;
    if (wars.length) {
      const r = rng.pick(wars);
      const [a, b] = rng.next() < 0.5 ? [r.a, r.b] : [r.b, r.a];
      p = peoples.get(a) ?? p;
      e = peoples.get(b) ?? e;
      pool = harm > 45 ? [...WAR, ...HARSH] : WAR;
    } else if (dominions.length && rng.next() < 0.6) pool = RULE;
    else pool = harm > 45 ? [...SKY, ...HARSH] : SKY;
    const ws = peoples.worldsOf(p);
    const w: World | undefined = ws.length ? rng.pick(ws) : s.worlds[0];
    const line = rng.pick(pool)({ p: p.name, e: e.name, w: w?.name ?? s.name, s: dominions.length ? rng.pick(dominions).name : s.name });
    this.h.news('❝', line.es, line.en, 'voice');
  }

  /** The answer to a plea: peace for everyone, or silence. */
  decide(d: Decision, accept: boolean) {
    const s = this.h.s;
    if (!accept) {
      this.h.news('❝', 'La estrella guarda silencio. Los pueblos siguen rezando.', 'The star keeps silent. The peoples keep praying.', 'voice');
      return;
    }
    const wars = this.h.peoples.wars();
    if (wars.length && s.energy >= PLEA_COST) {
      s.energy -= PLEA_COST;
      this.h.peoples.truceAll();
      addHarm(s, -30);
      this.h.news('☀', 'La estrella escucha. Una luz suave cubre el sistema y las armas callan en todos los mundos.', 'The star listens. A soft light covers the system and the weapons fall silent on every world.', 'good');
      return;
    }
    const dom = (s.stars ?? []).filter((x) => x.mode === 'dominion');
    for (const st of dom) st.mode = 'trade';
    addHarm(s, -25);
    if (dom.length) this.h.news('⚖', `Los dominios vuelven a ser libres: ${dom.map((x) => x.name).join(', ')}. Por primera vez en mucho tiempo, alguien canta.`, `The dominions are free again: ${dom.map((x) => x.name).join(', ')}. For the first time in a long while, someone sings.`, 'good');
    else this.h.news('☀', 'La estrella brilla más suave. Los pueblos lo notan, y por una vez duermen tranquilos.', 'The star shines more gently. The peoples notice, and for once they sleep in peace.', 'good');
  }
}

export const PLEA = { cost: PLEA_COST };
