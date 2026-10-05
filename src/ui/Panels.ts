import { int, num, pick, tr } from '../i18n';
import { habZone, massOf, snowLine, type GameState, type People, type World } from '../core/state';
import type { WorldStats } from '../sim/worlds';
import { STAGE_NAMES, STAGE_TIME } from '../sim/system';
import { capName, invaderNames } from '../content/names';
import { h, stone, clear } from './dom';
import { RES_ICON, isSettled, roleOf, type Role } from '../sim/civ';
import { RELATION_ICON, RELATION_TEXT, peopleOf } from '../sim/peoples';

const hsl = (h: number, s = 70, l = 62) => `hsl(${Math.round(h * 360)} ${s}% ${l}%)`;
const resWord = (k: 'fuel' | 'water' | 'metal' | 'science') => ({ metal: tr('metal', 'metal'), fuel: tr('combustible', 'fuel'), water: tr('agua', 'water'), science: tr('ciencia', 'science') })[k];
/** Safe inside a double-quoted HTML attribute. */
const attr = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** A tooltip attribute for panel markup. */
const tipAttr = (es: string, en: string) => ` data-tip="${attr(tr(es, en))}"`;

// ------------------------------------------------------------------ peoples

const peopleById = (s: GameState, id: number | undefined) => (id ? s.peoples?.find((p) => p.id === id) : undefined);
const pName = (p: People) => tr(p.name, capName(p.name));
const pTag = (p: People) => `<b style="color:${hsl(p.hue, 75, 66)}">${pName(p)}</b>`;

/** Worlds a people lives on, and how far it has come. */
function peopleInfo(s: GameState, p: People) {
  const worlds = s.worlds.filter((w) => (w.life?.people === p.id && w.life.stage >= 2) || (w.owner === p.id && w.colony >= 1));
  const home = s.worlds.find((w) => w.id === p.home);
  const stage = home?.life?.people === p.id ? home.life.stage : p.arrived || p.parents ? 5 : 4;
  return { worlds, stage, home };
}

/** Sentence for a relation between two peoples. */
function relationSentence(state: keyof typeof RELATION_TEXT, a: People, b: People) {
  const A = pName(a);
  const B = pName(b);
  switch (state) {
    case 'war':
      return tr(`Los ${A} y los ${B} están en guerra: sus naves se atacan entre los mundos.`, `The ${A} and the ${B} are at war: their ships strike each other between the worlds.`);
    case 'tension':
      return tr(`Los ${A} y los ${B} se miran con recelo. Una chispa más y podría estallar una guerra.`, `The ${A} and the ${B} eye each other warily. One more spark and a war could break out.`);
    case 'alliance':
      return tr(`Los ${A} y los ${B} son aliados: comparten rutas, ciencia y defensa, y con el tiempo pueden mezclarse en un pueblo nuevo.`, `The ${A} and the ${B} are allies: they share routes, science and defence, and in time they may blend into a new people.`);
    default:
      return tr(`Los ${A} y los ${B} viven en paz.`, `The ${A} and the ${B} live in peace.`);
  }
}

// ------------------------------------------------------------------ habitability gauges

type Band = 'ok' | 'meh' | 'bad';
interface Gauge {
  name: string;
  value: string;
  verdict: string;
  band: Band;
  /** Marker position 0..1 along the gauge. */
  pos: number;
  /** Zones along the gauge: [from, to, band] in 0..1. */
  zones: [number, number, Band][];
  lo: string;
  hi: string;
  tip: string;
}

const BAND_COL: Record<Band, string> = { ok: 'rgba(152,199,112,.75)', meh: 'rgba(229,182,90,.5)', bad: 'rgba(255,110,60,.38)' };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Zones from value thresholds on a (possibly logarithmic) scale. */
function zonesOf(scale: (v: number) => number, cuts: number[], bands: Band[]): [number, number, Band][] {
  const at = [0, ...cuts.map((c) => clamp01(scale(c))), 1];
  return bands.map((b, i) => [at[i], at[i + 1], b] as [number, number, Band]);
}

function bandOf(f: number): Band {
  return f >= 0.95 ? 'ok' : f >= 0.5 ? 'meh' : 'bad';
}

/** Every factor of habitability as a gauge: where it is, where it should be, and which way it is off. */
function gauges(w: World, st: WorldStats): Gauge[] {
  const out: Gauge[] = [];
  const m = massOf(w);
  // Temperature, in °C.
  {
    const c = st.T - 273;
    const scale = (v: number) => (v + 120) / 280;
    const verdict = c < -35 ? tr('demasiado frío', 'far too cold') : c < 0 ? tr('frío', 'cold') : c <= 39 ? tr('ideal', 'ideal') : c <= 77 ? tr('caluroso', 'hot') : tr('demasiado caliente', 'far too hot');
    out.push({
      name: factorName('temp'),
      value: fmtTemp(st.T),
      verdict,
      band: bandOf(st.f.temp),
      pos: clamp01(scale(c)),
      zones: zonesOf(scale, [-35, 0, 39, 77], ['bad', 'meh', 'ok', 'meh', 'bad']),
      lo: tr('frío', 'cold'),
      hi: tr('calor', 'heat'),
      tip: tr(
        `Ideal entre <b>0 y 39 °C</b>. Por debajo de −35 °C o por encima de 77 °C la vida no prospera.<br>Ahora: <b>${fmtTemp(st.T)}</b>${c < 0 ? ' · le falta calor' : c > 39 ? ' · le sobra calor' : ''}.`,
        `Ideal between <b>0 and 39 °C</b>. Below −35 °C or above 77 °C life cannot thrive.<br>Now: <b>${fmtTemp(st.T)}</b>${c < 0 ? ' · it needs warmth' : c > 39 ? ' · it is too warm' : ''}.`,
      ),
    });
  }
  if (!st.giant) {
    // Water: how much of the surface is covered.
    const o = st.ocean;
    out.push({
      name: factorName('water'),
      value: pct(o),
      verdict: o < 0.02 ? tr('seco', 'dry') : o < 0.2 ? tr('escasa', 'scarce') : o >= 0.85 ? tr('océano global', 'global ocean') : tr('suficiente', 'enough'),
      band: bandOf(st.f.water),
      pos: clamp01(o),
      zones: zonesOf((v) => v, [0.02, 0.2], ['bad', 'meh', 'ok']),
      lo: tr('seco', 'dry'),
      hi: tr('océano', 'ocean'),
      tip: tr(`Parte de la superficie cubierta de agua. Hace falta al menos un <b>20 %</b>.<br>Ahora: <b>${pct(o)}</b>.`, `Share of the surface covered by water. It needs at least <b>20%</b>.<br>Now: <b>${pct(o)}</b>.`),
    });
    // Atmosphere: air pressure, on a logarithmic scale.
    const p = st.atm;
    const scale = (v: number) => (Math.log10(Math.max(v, 1e-3)) + 2.5) / 4.8;
    out.push({
      name: factorName('atm'),
      value: `${num(p, p < 10 ? 2 : 0)} atm`,
      verdict: p < 0.08 ? tr('casi sin aire', 'almost airless') : p < 0.4 ? tr('tenue', 'thin') : p <= 4 ? tr('respirable', 'breathable') : p <= 14 ? tr('densa', 'thick') : tr('asfixiante', 'crushing'),
      band: bandOf(st.f.atm),
      pos: clamp01(scale(p)),
      zones: zonesOf(scale, [0.08, 0.4, 4, 14], ['bad', 'meh', 'ok', 'meh', 'bad']),
      lo: tr('tenue', 'thin'),
      hi: tr('densa', 'thick'),
      tip: tr(
        `Presión del aire. Ideal entre <b>0,4 y 4 atm</b> (la Tierra tiene 1). Muy tenue no protege; muy densa asfixia y recalienta.<br>Ahora: <b>${num(p, 2)} atm</b>${p < 0.4 ? ' · le falta aire' : p > 4 ? ' · le sobra aire' : ''}.`,
        `Air pressure. Ideal between <b>0.4 and 4 atm</b> (Earth has 1). Too thin gives no shelter; too thick stifles and overheats.<br>Now: <b>${num(p, 2)} atm</b>${p < 0.4 ? ' · it needs more air' : p > 4 ? ' · it has too much air' : ''}.`,
      ),
    });
    // Organic molecules.
    const g = st.organics;
    out.push({
      name: factorName('org'),
      value: pct(g),
      verdict: g < 0.04 ? tr('casi nulos', 'almost none') : g < 0.3 ? tr('escasos', 'scarce') : tr('suficientes', 'enough'),
      band: bandOf(st.f.org),
      pos: clamp01(g),
      zones: zonesOf((v) => v, [0.04, 0.3], ['bad', 'meh', 'ok']),
      lo: tr('nada', 'none'),
      hi: tr('ricos', 'rich'),
      tip: tr(`Carbono y moléculas orgánicas, los ladrillos de la vida. Hace falta al menos un <b>30 %</b>.<br>Ahora: <b>${pct(g)}</b>.`, `Carbon and organic molecules, the building blocks of life. It needs at least <b>30%</b>.<br>Now: <b>${pct(g)}</b>.`),
    });
    // Magnetic field.
    const mg = w.mag;
    out.push({
      name: factorName('mag'),
      value: pct(clamp01(mg)),
      verdict: mg < 0.05 ? tr('casi nulo', 'almost none') : mg < 0.25 ? tr('débil', 'weak') : tr('protector', 'protective'),
      band: bandOf(st.f.mag),
      pos: clamp01(mg),
      zones: zonesOf((v) => v, [0.25], ['meh', 'ok']),
      lo: tr('nulo', 'none'),
      hi: tr('fuerte', 'strong'),
      tip: tr(`Escudo contra el viento estelar, que roba el aire. Basta con un <b>25 %</b>; nace de un núcleo de hierro.<br>Ahora: <b>${pct(clamp01(mg))}</b>.`, `A shield against the stellar wind, which strips the air. <b>25%</b> is enough; it comes from an iron core.<br>Now: <b>${pct(clamp01(mg))}</b>.`),
    });
  }
  // Size: Earth masses, on a logarithmic scale.
  {
    const scale = (v: number) => (Math.log10(Math.max(v, 1e-3)) + 2.5) / 5.2;
    const verdict = st.giant ? tr('gigante sin suelo', 'giant, no ground') : m < 0.03 ? tr('demasiado pequeño', 'far too small') : m < 0.1 ? tr('pequeño', 'small') : m <= 8 ? tr('adecuado', 'right') : m <= 14 ? tr('pesado', 'heavy') : tr('demasiado masivo', 'far too massive');
    out.push({
      name: factorName('mass'),
      value: tr(`${num(m, m < 1 ? 2 : 1)} Tierras`, `${num(m, m < 1 ? 2 : 1)} Earths`),
      verdict,
      band: bandOf(st.f.mass),
      pos: clamp01(scale(m)),
      zones: zonesOf(scale, [0.03, 0.1, 8, 14], ['bad', 'meh', 'ok', 'meh', 'bad']),
      lo: tr('pequeño', 'small'),
      hi: tr('enorme', 'huge'),
      tip: tr(
        `Masa, en Tierras. Ideal entre <b>0,1 y 8</b>: más pequeño pierde el aire, más grande aplasta y se vuelve un gigante de gas.<br>Ahora: <b>${num(m, 2)}</b>.`,
        `Mass, in Earths. Ideal between <b>0.1 and 8</b>: smaller loses its air, bigger crushes and turns into a gas giant.<br>Now: <b>${num(m, 2)}</b>.`,
      ),
    });
  }
  return out;
}

function gaugeHtml(g: Gauge) {
  const grad = g.zones.map(([a, b, band]) => `${BAND_COL[band]} ${(a * 100).toFixed(1)}% ${(b * 100).toFixed(1)}%`).join(', ');
  return `<div class="hab-row ${g.band}" data-tip="${attr(`<b>${g.name}</b><br>${g.tip}`)}">
    <div class="hab-top"><span>${g.name}</span><span class="hv">${g.value} · <b>${g.verdict}</b></span></div>
    <div class="hab-gauge"><small>${g.lo}</small><div class="gauge" style="background:linear-gradient(90deg, ${grad})"><i style="left:${(g.pos * 100).toFixed(1)}%"></i></div><small>${g.hi}</small></div>
  </div>`;
}

const ROLE_RES: Record<Role, 'fuel' | 'water' | 'metal' | 'science'> = { fuel: 'fuel', water: 'water', metal: 'metal', science: 'science' };

/** What a world is good for once a civilization lives there. */
export function roleText(r: Role) {
  switch (r) {
    case 'fuel':
      return tr('<b>Combustible</b>: helio-3 y deuterio de sus nubes, para naves, armadas y motores de curvatura.', '<b>Fuel</b>: helium-3 and deuterium from its clouds, for ships, armadas and warp drives.');
    case 'water':
      return tr('<b>Agua</b>: hielo para terraformar otros mundos y mantener a las colonias.', '<b>Water</b>: ice to terraform other worlds and keep colonies alive.');
    case 'metal':
      return tr('<b>Metal</b>: minas y fundiciones para construir naves y grandes obras.', '<b>Metal</b>: mines and foundries to build ships and great works.');
    default:
      return tr('<b>Ciencia</b>: un mundo vivo donde prosperan ciudades, universidades y nuevas ideas.', '<b>Science</b>: a living world where cities, universities and new ideas thrive.');
  }
}
import { FACTOR_KEYS, factorName, fmtAge, fmtTemp, kindName, tempWord } from './text';

const KIND_DOT: Record<string, string> = {
  gas: 'radial-gradient(circle at 35% 35%, #f3d9a8, #b98455 60%, #6d4426)',
  icegiant: 'radial-gradient(circle at 35% 35%, #cdeff5, #6aa9bf 60%, #2f5a75)',
  lava: 'radial-gradient(circle at 35% 35%, #ffcf7a, #e2541c 55%, #3a140a)',
  scorched: 'radial-gradient(circle at 35% 35%, #f6d2a0, #b8653a 55%, #4a2412)',
  ocean: 'radial-gradient(circle at 35% 35%, #bfe8f0, #3d8fa0 55%, #123a4a)',
  ice: 'radial-gradient(circle at 35% 35%, #ffffff, #bcd8e4 55%, #6d8c9c)',
  desert: 'radial-gradient(circle at 35% 35%, #f1c58e, #b4703f 55%, #5a3018)',
  barren: 'radial-gradient(circle at 35% 35%, #d2c8bb, #7f766c 55%, #3a3530)',
  temperate: 'radial-gradient(circle at 35% 35%, #d8f0c0, #5e9a52 45%, #2c6475)',
};
export const kindDot = (k: string) => KIND_DOT[k] ?? KIND_DOT.barren;

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** What the world needs most, in plain words. */
export function advice(w: World, st: WorldStats): { text: string; warn: boolean } {
  const m = massOf(w);
  if (st.giant)
    return { text: tr('Un gigante no tiene suelo firme, pero sus lunas podrían albergar vida. Más adelante, un pueblo viajero podría construir ciudades en sus nubes.', 'A giant has no solid ground, but its moons could harbour life. Later on, a travelling people could build cities in its clouds.'), warn: false };
  if (st.f.mass < 0.3 && m < 0.1)
    return { text: tr('Es demasiado pequeño para retener aire y agua por mucho tiempo. Puede servir de puerto para futuras colonias.', 'It is too small to hold on to air and water for long. It may serve as a harbour for future colonies.'), warn: true };
  let worst: keyof typeof st.f = 'temp';
  let wv = 2;
  for (const k of FACTOR_KEYS) {
    if (st.f[k] < wv - 1e-6) {
      wv = st.f[k];
      worst = k;
    }
  }
  if (w.life && w.life.health < 0.5 && wv >= 0.95)
    return { text: tr('La vida se recupera poco a poco. Mantén estables sus condiciones.', 'Life is slowly recovering. Keep its conditions steady.'), warn: false };
  if (wv >= 0.95) {
    if (w.life) return { text: tr('La vida prospera aquí. Mantén su clima estable y protégelo de impactos.', 'Life thrives here. Keep its climate steady and shield it from impacts.'), warn: false };
    if (st.H >= 0.62)
      return { text: tr('Todo está listo. La vida podría aparecer en cualquier momento…', 'Everything is ready. Life could appear at any moment…'), warn: false };
  }
  const L = (es: string, en: string) => ({ text: tr(es, en), warn: true });
  switch (worst) {
    case 'temp':
      return st.T < 273
        ? L('Hace demasiado frío. Acércalo a la estrella con <b>Migrar</b>, espesa su aire con un <b>Volcán</b> o sube el brillo de la estrella.', 'It is too cold. Move it closer to the star with <b>Migrate</b>, thicken its air with a <b>Volcano</b> or raise the star’s brightness.')
        : L('Hace demasiado calor. Aléjalo de la estrella con <b>Migrar</b> o baja el brillo de la estrella.', 'It is too hot. Move it away from the star with <b>Migrate</b> or lower the star’s brightness.');
    case 'water':
      return L('Le falta agua. Atrae una lluvia de <b>cometas</b> helados.', 'It lacks water. Bring down a shower of icy <b>comets</b>.');
    case 'atm':
      return st.atm < 0.4
        ? L('Su aire es muy tenue. Despierta sus <b>volcanes</b> o atrae cometas nitrogenados.', 'Its air is very thin. Wake its <b>volcanoes</b> or bring in nitrogen-rich comets.')
        : L('Su atmósfera es asfixiante. Las <b>llamaradas</b> la adelgazan poco a poco, y alejarlo de la estrella también ayuda.', 'Its atmosphere is stifling. <b>Flares</b> thin it out little by little, and moving it farther from the star also helps.');
    case 'org':
      return L('Faltan moléculas orgánicas, los ladrillos de la vida. Atrae <b>cometas</b> carbonáceos.', 'It lacks organic molecules, the building blocks of life. Bring in carbon-rich <b>comets</b>.');
    case 'mag':
      return L('Sin campo magnético, el viento estelar le roba el aire. Los cometas férricos lo fortalecen.', 'Without a magnetic field, the stellar wind strips its air. Iron-rich comets strengthen it.');
    default:
      return m > 8
        ? L('Es tan masivo que su gravedad sería un peso enorme para cualquier ser vivo.', 'It is so massive that its gravity would weigh heavily on any living thing.')
        : L('Es demasiado pequeño para retener aire y agua por mucho tiempo.', 'It is too small to hold on to air and water for long.');
  }
}

export interface InspectorHandlers {
  close(): void;
  rename(target: number | 'star'): void;
  focus(id: number | 'star'): void;
  dial(v: number): void;
}

/** Side panel with everything about the selected world (or the star). */
export class Inspector {
  el: HTMLElement;
  private title: HTMLElement;
  private kind: HTMLElement;
  private body: HTMLElement;
  private extra: HTMLElement;
  private slider: HTMLInputElement | null = null;
  private html = '';
  target: number | 'star' | null = null;

  constructor(
    host: HTMLElement,
    private on: InspectorHandlers,
  ) {
    this.title = h('h2');
    const rename = h(
      'button',
      {
        class: 'rename-btn',
        'data-tip': tr('Ponerle nombre', 'Give it a name'),
        onclick: () => {
          if (this.target !== null) this.on.rename(this.target);
        },
      },
      '✎',
    );
    this.kind = h('div', { class: 'kind' });
    this.body = h('div');
    this.extra = h('div');
    this.el = stone(
      'inspector veined',
      h('button', { class: 'btn icon small x ghost', 'data-tip': tr('Cerrar', 'Close'), onclick: () => this.on.close() }, '✕'),
      h('div', { class: 'title-line' }, this.title, rename),
      this.kind,
      this.body,
      this.extra,
    );
    this.el.style.display = 'none';
    host.append(this.el);
  }

  hide() {
    this.target = null;
    this.el.style.display = 'none';
  }

  showWorld(w: World, st: WorldStats, s: GameState, parent: World | null) {
    const fresh = this.target !== w.id;
    this.target = w.id;
    this.el.style.display = '';
    if (fresh) {
      clear(this.extra);
      this.slider = null;
      this.extra.append(
        h('div', { style: 'display:flex;justify-content:center;margin-top:12px' }, h('button', { class: 'btn small', onclick: () => this.on.focus(w.id) }, tr('◎ Seguir con la cámara', '◎ Follow with camera'))),
      );
    }
    this.title.textContent = w.name;
    const where = parent
      ? tr(`Luna de ${parent.name}`, `Moon of ${parent.name}`)
      : tr(`${num(w.a, 2)} UA de la estrella`, `${num(w.a, 2)} AU from the star`);
    this.kind.textContent = `${kindName(st.kind)} · ${where}`;
    const m = massOf(w);
    const parts: [number, string, string][] = [
      [w.metal, '#8c5a44', tr('metal', 'metal')],
      [w.rock, '#b8936a', tr('roca', 'rock')],
      [w.water, '#9fd4e6', tr('agua y hielo', 'water & ice')],
      [w.gas, '#e6b98a', tr('gas', 'gas')],
      [w.org, '#6e8a3c', tr('orgánicos', 'organics')],
    ];
    const comp = parts
      .filter((p) => p[0] / m > 0.004)
      .map((p) => `<i style="width:${((p[0] / m) * 100).toFixed(1)}%;background:${p[1]}"></i>`)
      .join('');
    const legend = parts
      .filter((p) => p[0] / m > 0.004)
      .map((p) => `<span style="--c:${p[1]}">${p[2]} ${Math.round((p[0] / m) * 100)}%</span>`)
      .join('');
    const massTxt = m < 0.01 ? tr('menos de un centésimo de la Tierra', 'under a hundredth of Earth') : tr(`${num(m, m < 1 ? 2 : 1)} masas terrestres`, `${num(m, m < 1 ? 2 : 1)} Earth masses`);
    const H = Math.round(st.H * 100);
    const fac = gauges(w, st).map(gaugeHtml).join('');
    const adv = advice(w, st);
    let html = `
      <section><h3>${tr('COMPOSICIÓN', 'COMPOSITION')}</h3>
        <div class="comp"${tipAttr('<b>Composición</b><br>De qué está hecho: metal, roca, agua y hielo, gas y orgánicos. Los cometas y los choques la cambian.', '<b>Composition</b><br>What it is made of: metal, rock, water and ice, gas and organics. Comets and collisions change it.')}>${comp}</div><div class="legend">${legend}</div>
        <div class="stat"${tipAttr('<b>Masa</b><br>En masas terrestres. Entre 0,1 y 8 retiene aire y agua; mucho más y se vuelve un gigante.', '<b>Mass</b><br>In Earth masses. Between 0.1 and 8 it holds on to air and water; much more and it becomes a giant.')}><span>${tr('Masa', 'Mass')}</span><span>${massTxt}</span></div>
      </section>
      <section><h3>${tr('HABITABILIDAD', 'HABITABILITY')}</h3>
        <div class="hab-head"><div class="hab-ring" style="--p:${H}" data-tip="${attr(tr('Habitabilidad: todas las condiciones juntas. Basta con que una sea mala para que baje mucho. La vida aparece desde el 62 %.', 'Habitability: every condition together. A single bad one pulls it right down. Life appears from 62%.'))}"><b>${H}%</b></div>
        <div class="small muted">${st.H >= 0.62 ? tr('Puede albergar vida.', 'It can harbour life.') : st.H >= 0.3 ? tr('Casi… le falta poco.', 'Almost… it needs a little more.') : tr('Hostil para la vida tal como la conocemos.', 'Hostile to life as we know it.')}<br><span class="hab-key"><i class="ok"></i>${tr('ideal', 'ideal')} <i class="meh"></i>${tr('justo', 'marginal')} <i class="bad"></i>${tr('hostil', 'hostile')}</span></div></div>
        <div class="hab-rows">${fac}</div>
        <div class="advice ${adv.warn ? 'warn' : ''}">${adv.text}</div>
      </section>`;
    if (w.life) {
      const l = w.life;
      const stage = pick(STAGE_NAMES[l.stage]);
      const next = l.stage < STAGE_TIME.length ? `<div class="stat"${tipAttr('<b>Evolución</b><br>Cuánto le falta para la siguiente etapa. Avanza sola mientras el mundo siga habitable y la vida sana.', '<b>Evolution</b><br>How far it is from the next stage. It moves on by itself while the world stays habitable and life healthy.')}><span>${tr('Hacia', 'Towards')} ${pick(STAGE_NAMES[Math.min(5, l.stage + 1)]).toLowerCase()}</span><span>${pct(l.progress)}</span></div><div class="vessel thin moss"><i style="--v:${Math.round(l.progress * 100)}%"></i></div>` : '';
      const lp = l.stage >= 2 ? peopleById(s, l.people) : undefined;
      const sp = lp ? ` · ${tr('los', 'the')} ${pName(lp)}` : '';
      html += `<section><h3>${tr('VIDA', 'LIFE')}</h3>
        <div class="stat"${tipAttr('<b>Etapa de la vida</b><br>Microbios → vida compleja → inteligencia → civilización → era espacial → era interplanetaria.', '<b>Stage of life</b><br>Microbes → complex life → intelligence → civilization → space age → interplanetary age.')}><span>${tr('Etapa', 'Stage')}</span><span class="moss">${stage}${sp}</span></div>
        ${next}
        <div class="stat" style="margin-top:6px"${tipAttr('<b>Salud de la vida</b><br>Si llega a cero, se extingue. La bajan los impactos, las llamaradas, los climas extremos y las guerras; se recupera con el tiempo.', '<b>Health of life</b><br>If it reaches zero, it dies out. Impacts, flares, extreme climates and wars lower it; it recovers over time.')}><span>${tr('Salud', 'Health')}</span><span>${pct(Math.max(0, l.health))}</span></div>
        <div class="vessel thin ${l.health > 0.5 ? 'moss' : ''}"><i style="--v:${Math.round(Math.max(0, l.health) * 100)}%"></i></div>
      </section>`;
    } else if (w.spark > 0.5) {
      html += `<section><h3>${tr('VIDA', 'LIFE')}</h3><div class="small">${tr('Algo se agita en sus aguas…', 'Something stirs in its waters…')}</div><div class="vessel thin moss" style="margin-top:6px"><i style="--v:${Math.round((w.spark / 30) * 100)}%"></i></div></section>`;
    }
    const people = peopleById(s, peopleOf(w));
    if (people) {
      const info = peopleInfo(s, people);
      const home = w.life?.people === people.id;
      const origin = people.parents
        ? (() => {
            const [a, b] = people.parents!.map((id) => peopleById(s, id));
            return a && b ? tr(`Nacidos de la mezcla de los ${pTag(a)} y los ${pTag(b)}.`, `Born of the blend of the ${pTag(a)} and the ${pTag(b)}.`) : '';
          })()
        : people.arrived
          ? tr('Llegados desde otra estrella.', 'Arrived from another star.')
          : info.home
            ? tr(`Nacidos en ${info.home.name}.`, `Born on ${info.home.name}.`)
            : '';
      const where = info.worlds.map((x) => x.name).join(', ');
      let rels = '';
      for (const r of s.relations ?? []) {
        if (r.a !== people.id && r.b !== people.id) continue;
        const other = peopleById(s, r.a === people.id ? r.b : r.a);
        if (!other || other.gone) continue;
        const txt = !r.met ? tr('aún no conocen a', 'have not yet met') : r.state === 'war' ? tr('en guerra con', 'at war with') : r.state === 'tension' ? tr('en tensión con', 'tense with') : r.state === 'alliance' ? tr('aliados de', 'allied with') : tr('en paz con', 'at peace with');
        const ic = r.met ? RELATION_ICON[r.state] : '?';
        rels += `<div class="rel-line ${r.met ? r.state : ''}" data-tip="${attr(r.met ? relationSentence(r.state, people, other) : tr('Se encontrarán cuando ambos puedan cruzar el espacio.', 'They will meet once both can cross space.'))}"><span class="ic">${ic}</span>${txt} ${tr('los', 'the')} ${pTag(other)}</div>`;
      }
      html += `<section><h3>${tr('PUEBLO', 'PEOPLE')}</h3>
        <div class="people-row big"><i style="background:${hsl(people.hue)};color:${hsl(people.hue)}"></i><span>${home ? tr(`Hogar de los ${pName(people)}`, `Home of the ${pName(people)}`) : tr(`Colonia de los ${pName(people)}`, `Colony of the ${pName(people)}`)}</span><em>${pick(STAGE_NAMES[info.stage])}</em></div>
        <div class="small muted" style="margin-top:4px">${origin} ${tr(`Viven en ${where}.`, `They live on ${where}.`)}</div>
        ${rels ? `<div class="rel-list">${rels}</div>` : ''}
        <div class="small muted" style="margin-top:6px">${tr('Viven a su manera: tú solo observas. Cuando la tensión crece, puedes intervenir con la luz de la estrella.', 'They live their own way: you only watch. When tension grows, you may step in with the light of the star.')}</div>
      </section>`;
    }
    {
      const role = roleOf(w, st);
      const settled = isSettled(w);
      const jewel = role === 'science' && parent && parent.gas / Math.max(1e-6, massOf(parent)) > 0.3;
      html += `<section><h3>${settled ? tr('APORTA', 'CONTRIBUTES') : tr('SI SE COLONIZA, APORTARÁ', 'IF SETTLED, IT WILL GIVE')}</h3>
        <div class="role ${ROLE_RES[role]}"${tipAttr('<b>Recurso</b><br>Lo que este mundo aporta a los pueblos del sistema cuando alguien vive en él. Con ellos se pagan las grandes obras.', '<b>Resource</b><br>What this world gives the peoples of the system once someone lives on it. They pay for the great works.')}><span class="ri">${RES_ICON[ROLE_RES[role]]}</span><span>${roleText(role)}</span></div>
        ${jewel ? `<div class="small gold" style="margin-top:4px">${tr('Luna viva de un gigante: su ciencia vale el doble.', 'Living moon of a giant: its science is worth double.')}</div>` : ''}
        ${w.guest ? `<div class="small water" style="margin-top:4px">${tr(`Hogar de los ${w.guest}, refugiados de otra estrella.`, `Home of the ${capName(w.guest)}, refugees from another star.`)}</div>` : ''}
      </section>`;
    }
    if (w.colony > 0 || w.terra > 0 || w.sats > 0) {
      html += `<section><h3>${tr('CIVILIZACIÓN', 'CIVILIZATION')}</h3>
        ${w.colony > 0 ? `<div class="stat"${tipAttr('<b>Colonia</b><br>Llega con naves colonas; cada nave suma una parte hasta establecerla. Las incursiones y los invasores la desgastan.', '<b>Colony</b><br>It arrives on colony ships; each ship adds a share until it is established. Raids and invaders wear it down.')}><span>${w.colony >= 1 ? tr('Colonia establecida', 'Colony established') : tr('Colonos en camino', 'Settlers arriving')}</span><span>${pct(Math.min(1, w.colony))}</span></div><div class="vessel thin gold"><i style="--v:${Math.round(Math.min(1, w.colony) * 100)}%"></i></div>` : ''}
        ${w.terra > 0 ? `<div class="stat" style="margin-top:6px"${tipAttr('<b>Terraformación</b><br>Los colonos vuelven el mundo templado y con agua, poco a poco. Gasta agua de los mundos helados.', '<b>Terraforming</b><br>The settlers slowly make the world mild and wet. It uses water from the icy worlds.')}><span>${tr('Terraformación', 'Terraforming')}</span><span>${pct(w.terra)}</span></div><div class="vessel thin moss"><i style="--v:${Math.round(w.terra * 100)}%"></i></div>` : ''}
        ${w.sats > 0 ? `<div class="stat" style="margin-top:6px"${tipAttr('<b>Satélites</b><br>Los lanza la era espacial. Las superllamaradas y las supernovas los derriban.', '<b>Satellites</b><br>Launched in the space age. Superflares and supernovae knock them out.')}><span>${tr('Satélites en órbita', 'Satellites in orbit')}</span><span>${w.sats}</span></div>` : ''}
      </section>`;
    }
    if (w.invaded > 0.02) {
      const al = pick(((n) => ({ es: n[0], en: n[1] }))(invaderNames(s.alienSpecies)));
      html += `<section><h3 class="violet">${tr('VISITANTES', 'VISITORS')}</h3>
        <div class="stat"${tipAttr('<b>Ocupación</b><br>Cuánto del mundo controlan los invasores. Desde el 60 % se extienden a otros mundos.', '<b>Occupation</b><br>How much of the world the invaders control. From 60% on they spread to other worlds.')}><span>${tr(`Ocupado por los ${al}`, `Occupied by the ${al}`)}</span><span>${pct(w.invaded)}</span></div>
        <div class="vessel thin violet"><i style="--v:${Math.round(w.invaded * 100)}%"></i></div>
        <div class="advice warn">${tr('Una <b>llamarada</b> solar los expulsa, aunque también castiga un poco la atmósfera.', 'A solar <b>flare</b> drives them out, though it also batters the atmosphere a little.')} ${s.patrol ? tr('Los <b>Space Patrols</b> también vendrán a purgarlos.', 'The <b>Space Patrols</b> will also come to purge them.') : tr('Si llegan a dominar varios mundos, los pueblos fundarán los <b>Space Patrols</b>.', 'If they come to hold several worlds, the peoples will found the <b>Space Patrols</b>.')}</div>
      </section>`;
    }
    // Only touch the DOM when something changed (keeps hover and tooltips steady).
    if (html !== this.html) this.body.innerHTML = this.html = html;
  }

  showStar(s: GameState, energyRate: number) {
    const fresh = this.target !== 'star';
    this.target = 'star';
    this.html = '';
    this.el.style.display = '';
    this.title.textContent = s.name;
    this.kind.textContent = s.phase === 'formation' ? tr('Estrella recién nacida', 'Newborn star') : tr('Estrella de tipo solar', 'Sun-like star');
    const L = s.L * s.dial;
    const [a, b] = habZone(L);
    this.body.innerHTML = `
      <section><h3>${tr('LA ESTRELLA', 'THE STAR')}</h3>
        <div class="stat"><span>${tr('Edad del sistema', 'System age')}</span><span>${fmtAge(s.age)}</span></div>
        <div class="stat"><span>${tr('Luminosidad', 'Luminosity')}</span><span>${int(L * 100)} % ${tr('del Sol', 'of the Sun')}</span></div>
        <div class="stat"><span>${tr('Zona habitable', 'Habitable zone')}</span><span>${num(a, 2)}–${num(b, 2)} UA</span></div>
        <div class="stat"><span>${tr('Línea de nieve', 'Snow line')}</span><span>${num(snowLine(L), 1)} UA</span></div>
        <div class="stat"><span>${tr('Luz estelar', 'Starlight')}</span><span>+${num(energyRate, 1)} / s</span></div>
      </section>`;
    if (fresh) {
      clear(this.extra);
      if (s.phase === 'system') {
        const val = h('b', { class: 'gold' });
        const slider = h('input', { type: 'range', min: '70', max: '130', step: '1', class: 'dial' }) as HTMLInputElement;
        slider.value = String(Math.round(s.dial * 100));
        val.textContent = `${slider.value} %`;
        slider.addEventListener('input', () => {
          val.textContent = `${slider.value} %`;
          this.on.dial(Number(slider.value) / 100);
        });
        this.slider = slider;
        this.extra.append(
          h(
            'section',
            null,
            h('h3', null, tr('BRILLO', 'BRIGHTNESS')),
            h('div', { class: 'stat' }, h('span', null, tr('Intensidad', 'Intensity')), val),
            slider,
            h(
              'div',
              { class: 'advice' },
              tr(
                'Más brillo calienta tus mundos y te da más luz estelar, pero el viento estelar también desgasta las atmósferas sin campo magnético. Menos brillo los enfría.',
                'More brightness warms your worlds and gives you more starlight, but the stellar wind also wears down atmospheres without a magnetic field. Less brightness cools them.',
              ),
            ),
          ),
        );
      }
    }
  }
}

export interface LedgerHandlers {
  select(id: number): void;
}

/** List of every world in the system: the management view. */
export class Ledger {
  el: HTMLElement;
  private rows = new Map<number, { row: HTMLElement; bar: HTMLElement; flags: HTMLElement; dot: HTMLElement; name: HTMLElement; f: string }>();
  // Last markup written, so the DOM (and any hover on it) is only touched when something changed.
  private peoplesHtml = '';
  private headHtml = '';
  private legendHtml = '';
  private list: HTMLElement;
  private head: HTMLElement;
  private order = '';
  private peoplesEl: HTMLElement;
  private legend: HTMLElement;

  constructor(
    host: HTMLElement,
    private on: LedgerHandlers,
  ) {
    this.head = h('h3');
    this.list = h('div', { class: 'rows' });
    this.peoplesEl = h('div', { class: 'peoples' });
    this.legend = h('div', { class: 'legend-ships' });
    this.el = stone('ledger obsidian', this.head, this.peoplesEl, this.list, this.legend);
    this.head.addEventListener('click', () => this.el.classList.toggle('collapsed'));
    this.head.style.cursor = 'pointer';
    host.append(this.el);
    if (window.innerWidth < 760) this.el.classList.add('collapsed');
  }

  update(s: GameState, stats: Map<number, WorldStats>, selected: number | null) {
    const ws = s.worlds;
    const planets = ws.filter((w) => w.parent === null).sort((a, b) => a.a - b.a);
    const ordered: World[] = [];
    for (const p of planets) {
      ordered.push(p);
      for (const m of ws.filter((x) => x.parent === p.id).sort((a, b) => a.a - b.a)) ordered.push(m);
    }
    const key = ordered.map((w) => w.id).join(',');
    const head = `<span>${tr('MUNDOS', 'WORLDS')} · ${planets.length}</span><span class="muted">${this.el.classList.contains('collapsed') ? '▸' : '▾'}</span>`;
    if (head !== this.headHtml) {
      this.head.innerHTML = this.headHtml = head;
      this.head.dataset.tip = tr('<b>Mundos del sistema</b><br>Toca un mundo para ver su ficha. Toca aquí para plegar o desplegar la lista.', '<b>Worlds of the system</b><br>Tap a world to see its card. Tap here to fold or unfold the list.');
    }
    if (key !== this.order) {
      this.order = key;
      clear(this.list);
      this.rows.clear();
      for (const w of ordered) {
        const dot = h('span', { class: 'dot' });
        const name = h('span');
        const bar = h('div', { class: 'vessel thin moss' }, h('i'));
        const flags = h('span', { class: 'flags' });
        // On touch screens a tap on an icon explains it instead of selecting the world.
        const pick = (e: Event) => {
          if ((e as PointerEvent).pointerType === 'touch' && (e.target as Element).closest('.flags [data-tip], .vessel[data-tip]')) return;
          this.on.select(w.id);
        };
        const row = h('div', { class: `row ${w.parent !== null ? 'moon' : ''}`, onclick: pick }, dot, name, bar, flags);
        this.list.append(row);
        this.rows.set(w.id, { row, bar, flags, dot, name, f: '' });
      }
    }
    const threatened = new Set(s.threats.map((t) => t.target));
    for (const w of ordered) {
      const r = this.rows.get(w.id)!;
      const st = stats.get(w.id);
      if (!st) continue;
      r.name.textContent = w.name;
      r.dot.style.background = kindDot(st.kind);
      {
        // A summary on the name and the dot: what it is, where, how livable, who lives there.
        const pp = peopleById(s, peopleOf(w));
        const parent = w.parent !== null ? ws.find((x) => x.id === w.parent) : undefined;
        const where = parent ? tr(`Luna de ${parent.name}`, `Moon of ${parent.name}`) : tr(`${num(w.a, 2)} UA de la estrella`, `${num(w.a, 2)} AU from the star`);
        const life = w.life ? `${tr('Vida', 'Life')}: ${pick(STAGE_NAMES[w.life.stage]).toLowerCase()}` : tr('Sin vida', 'No life');
        const who = pp ? ` · ${w.life?.people === pp.id ? tr('hogar de', 'home of') : tr('colonia de', 'colony of')} ${tr('los', 'the')} ${pName(pp)}` : '';
        const tip = `<b>${w.name}</b> · ${kindName(st.kind)}<br>${where} · ${tr('habitabilidad', 'habitability')} ${Math.round(st.H * 100)} %<br>${life}${who}`;
        // On the whole row (the icons and the bar keep their own, more precise tooltips).
        if (r.row.dataset.tip !== tip) r.row.dataset.tip = tip;
      }
      if (w.parent !== null) r.dot.style.transform = 'scale(.75)';
      const hab = Math.round(st.H * 100);
      (r.bar.firstChild as HTMLElement).style.setProperty('--v', `${hab}%`);
      r.bar.dataset.tip = tr(`<b>Habitabilidad ${hab} %</b><br>Qué tan apto es para la vida. Desde el 62 % la vida puede aparecer sola.`, `<b>Habitability ${hab}%</b><br>How fit it is for life. From 62% life can appear on its own.`);
      const flag = (cls: string, style: string, glyph: string, tip: string) => `<span class="${cls}"${style ? ` style="${style}"` : ''} data-tip="${attr(tip)}">${glyph}</span>`;
      let f = '';
      if (w.life) f += flag('moss', '', '❦', tr(`<b>Vida</b>: ${pick(STAGE_NAMES[w.life.stage]).toLowerCase()}`, `<b>Life</b>: ${pick(STAGE_NAMES[w.life.stage]).toLowerCase()}`));
      const pp = peopleById(s, peopleOf(w));
      if (pp) {
        const home = w.life?.people === pp.id;
        f += flag('', `color:${hsl(pp.hue)}`, home ? '⌂' : '⌂', home ? tr(`<b>Hogar de los ${pName(pp)}</b>`, `<b>Home of the ${pName(pp)}</b>`) : tr(`<b>Colonia de los ${pName(pp)}</b>`, `<b>Colony of the ${pName(pp)}</b>`));
      } else if (w.guest) f += flag('water', '', '⌂', tr(`<b>Refugiados</b>: los ${w.guest}, llegados de otra estrella`, `<b>Refugees</b>: the ${capName(w.guest)}, from another star`));
      if (isSettled(w)) {
        const res = ROLE_RES[roleOf(w, st)];
        f += flag(`role-dot ${res}`, '', RES_ICON[res], tr(`Aporta <b>${resWord(res)}</b> a los pueblos del sistema`, `Gives <b>${resWord(res)}</b> to the peoples of the system`));
      }
      if (pp && (s.relations ?? []).some((x) => x.state === 'war' && (x.a === pp.id || x.b === pp.id))) f += flag('rel war', '', '⚔', tr(`Los ${pName(pp)} están en guerra`, `The ${pName(pp)} are at war`));
      if (w.invaded > 0.3) {
        const [ies, ien] = invaderNames(s.alienSpecies);
        f += flag('violet', '', '⚠', tr(`<b>Ocupado</b> por los ${ies}, invasores de otra estrella. Una llamarada los expulsa.`, `<b>Occupied</b> by the ${ien}, invaders from another star. A flare drives them out.`));
      }
      if (threatened.has(w.id)) f += flag('ember', '', '☄', tr('<b>Un asteroide</b> se dirige hacia aquí. Una llamarada puede desviarlo.', '<b>An asteroid</b> is heading here. A flare can deflect it.'));
      if (r.f !== f) r.flags.innerHTML = r.f = f;
      r.row.classList.toggle('sel', selected === w.id);
    }
    // The peoples of the system, all equal, and how they get along with each other.
    let ph = '';
    const alive = (s.peoples ?? []).filter((p) => !p.gone);
    if (alive.length) {
      ph += `<div class="peoples-head" data-tip="${attr(tr('No eres ninguno de ellos: los observas a todos. Viven, se mezclan, comercian y guerrean por su cuenta; tú decides si intervienes.', 'You are none of them: you watch over them all. They live, blend, trade and fight on their own; you decide whether to step in.'))}">${tr('PUEBLOS', 'PEOPLES')} · ${alive.length}</div>`;
      for (const p of alive) {
        const info = peopleInfo(s, p);
        const stageTxt = pick(STAGE_NAMES[info.stage]);
        const tip = `<b>${tr('Los', 'The')} ${pName(p)}</b><br>${stageTxt} · ${tr(`${info.worlds.length} ${info.worlds.length === 1 ? 'mundo' : 'mundos'}`, `${info.worlds.length} ${info.worlds.length === 1 ? 'world' : 'worlds'}`)}: ${info.worlds.map((x) => x.name).join(', ')}`;
        ph += `<div class="people-row" data-tip="${attr(tip)}"><i style="background:${hsl(p.hue)};color:${hsl(p.hue)}"></i><span>${tr('Los', 'The')} ${pName(p)}</span><em>${info.worlds.length} ⌂</em></div>`;
      }
      let chips = '';
      for (const r of s.relations ?? []) {
        const a = peopleById(s, r.a);
        const b = peopleById(s, r.b);
        if (!r.met || !a || !b || a.gone || b.gone) continue;
        const rel = RELATION_TEXT[r.state];
        chips += `<span class="rel-chip ${r.state}" data-tip="${attr(`<b>${tr(rel.es, rel.en)}</b><br>${relationSentence(r.state, a, b)}`)}"><i style="background:${hsl(a.hue)}"></i>${RELATION_ICON[r.state]}<i style="background:${hsl(b.hue)}"></i></span>`;
      }
      if (chips) ph += `<div class="rel-chips">${chips}</div>`;
    }
    const pt = s.patrol;
    if (pt) {
      const busy = pt.phase === 'away' ? tr('lejos', 'away') : pt.phase === 'approach' || pt.phase === 'assault' ? (pt.goal === 'war' ? tr('pacificando', 'pacifying') : tr('purgando', 'purging')) : tr('en órbita', 'in orbit');
      const tip = tr(
        `<b>Space Patrols</b> · «${pt.barge.es}»<br>Guerreros acorazados de todos los pueblos. Purgan los mundos ocupados, no toleran guerras y saltan a otras estrellas cuando se les llama.<br>☠ ${pt.kills} xenos · ⛨ ${pt.purges} purgas · ☮ ${pt.wars} guerras terminadas`,
        `<b>Space Patrols</b> · “${pt.barge.en}”<br>Armoured warriors of every people. They purge occupied worlds, tolerate no wars and jump to other stars when called.<br>☠ ${pt.kills} xenos · ⛨ ${pt.purges} purges · ☮ ${pt.wars} wars ended`,
      );
      ph += `<div class="people-row patrol" data-tip="${attr(tip)}"><i style="background:#6f9bff;color:#ffd27a"></i><span>Space Patrols</span><em>${busy}</em></div>`;
    }
    const stars = s.stars ?? [];
    if (stars.length) {
      const dom = stars.filter((x) => x.mode === 'dominion').length;
      const trouble = stars.filter((x) => x.trouble).length;
      const tip = tr(
        `<b>Colonias lejanas</b>: ${stars.map((x) => x.name).join(', ')}.<br>${dom} ${dom === 1 ? 'dominio' : 'dominios'}. Gestiónalas en <b>Proyectos</b>.`,
        `<b>Distant colonies</b>: ${stars.map((x) => x.name).join(', ')}.<br>${dom} ${dom === 1 ? 'dominion' : 'dominions'}. Manage them in <b>Projects</b>.`,
      );
      ph += `<div class="people-row" data-tip="${attr(tip)}"><i style="background:#e8d2a0;color:#e8d2a0"></i><span>${tr('Otras estrellas', 'Other stars')}</span><em>${stars.length} ✦${dom ? ` · ${dom} ⚑` : ''}${trouble ? ` · <b class="ember">${trouble} ⚠</b>` : ''}</em></div>`;
    }
    if (this.peoplesHtml !== ph) this.peoplesEl.innerHTML = this.peoplesHtml = ph;
    // What the ship colours mean.
    let lg = '';
    if (alive.length || s.ships.length) {
      for (const p of alive) lg += `<span data-tip="${attr(tr(`Naves de los ${pName(p)}`, `Ships of the ${pName(p)}`))}"><b style="color:${hsl(p.hue, 85, 60)}">➤</b> ${pName(p)}</span>`;
      lg += `<span data-tip="${attr(tr('Mercaderes de otras estrellas', 'Traders from other stars'))}"><b style="color:#ffcc52">◆</b> ${tr('comercio', 'traders')}</span>`;
      if (s.ships.some((x) => x.kind === 'refugee')) lg += `<span data-tip="${attr(tr('Refugiados que buscan un mundo', 'Refugees looking for a world'))}"><b style="color:#73f2d9">●</b> ${tr('refugiados', 'refugees')}</span>`;
      if (s.alienSpecies) {
        const [ies, ien] = invaderNames(s.alienSpecies);
        lg += `<span data-tip="${attr(tr(`Los ${ies}: invasores de otra estrella`, `The ${ien}: invaders from another star`))}"><b style="color:${hsl(s.alienSpecies.hue, 85, 60)}">✦</b> ${tr(ies, ien)}</span>`;
      }
      if (s.patrol) lg += `<span data-tip="${attr(tr('Space Patrols: barcaza de batalla, cápsulas de desembarco y cañoneras, en azul y oro', 'Space Patrols: battle barge, drop pods and gunships, in blue and gold'))}"><b style="color:#6f9bff">⛨</b> Space Patrols</span>`;
    }
    if (this.legendHtml !== lg) this.legend.innerHTML = this.legendHtml = lg;
  }
}
