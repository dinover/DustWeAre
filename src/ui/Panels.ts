import { int, num, pick, tr } from '../i18n';
import { habZone, massOf, snowLine, type GameState, type World } from '../core/state';
import type { WorldStats } from '../sim/worlds';
import { STAGE_NAMES, STAGE_TIME } from '../sim/system';
import { capName } from '../content/names';
import { h, stone, clear } from './dom';
import { RES_ICON, isSettled, roleOf, type Role } from '../sim/civ';

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
    return { text: tr('Un gigante no tiene suelo firme, pero sus lunas podrían albergar vida. Más adelante, una especie viajera podría construir ciudades en sus nubes.', 'A giant has no solid ground, but its moons could harbour life. Later on, a travelling species could build cities in its clouds.'), warn: false };
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
  target: number | 'star' | null = null;

  constructor(
    host: HTMLElement,
    private on: InspectorHandlers,
  ) {
    this.title = h('h2');
    this.kind = h('div', { class: 'kind' });
    this.body = h('div');
    this.extra = h('div');
    this.el = stone(
      'inspector veined',
      h('button', { class: 'btn icon small x ghost', title: tr('Cerrar', 'Close'), onclick: () => this.on.close() }, '✕'),
      this.title,
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
    const fac = FACTOR_KEYS.map((k) => {
      const v = st.f[k];
      const cls = v >= 0.95 ? 'ok' : v >= 0.5 ? 'meh' : 'bad';
      const mark = v >= 0.95 ? '✓' : v >= 0.5 ? '~' : '✕';
      return `<span>${factorName(k)}</span><div class="vessel thin ${v >= 0.95 ? 'moss' : v >= 0.5 ? 'gold' : ''}"><i style="--v:${Math.round(v * 100)}%"></i></div><span class="${cls}">${mark}</span>`;
    }).join('');
    const adv = advice(w, st);
    let html = `
      <section><h3>${tr('COMPOSICIÓN', 'COMPOSITION')}</h3>
        <div class="comp">${comp}</div><div class="legend">${legend}</div>
        <div class="stat"><span>${tr('Masa', 'Mass')}</span><span>${massTxt}</span></div>
      </section>
      <section><h3>${tr('CLIMA', 'CLIMATE')}</h3>
        <div class="stat"><span>${tr('Temperatura', 'Temperature')}</span><span>${fmtTemp(st.T)} · ${tempWord(st.T)}</span></div>
        ${st.giant ? '' : `<div class="stat"><span>${tr('Presión del aire', 'Air pressure')}</span><span>${num(st.atm, st.atm < 10 ? 2 : 0)} atm</span></div>
        <div class="stat"><span>${tr('Océanos', 'Oceans')}</span><span>${pct(st.ocean)}</span></div>`}
      </section>
      <section><h3>${tr('HABITABILIDAD', 'HABITABILITY')}</h3>
        <div class="hab-head"><div class="hab-ring" style="--p:${H}"><b>${H}%</b></div>
        <div class="small muted">${st.H >= 0.62 ? tr('Puede albergar vida.', 'It can harbour life.') : st.H >= 0.3 ? tr('Casi… le falta poco.', 'Almost… it needs a little more.') : tr('Hostil para la vida tal como la conocemos.', 'Hostile to life as we know it.')}</div></div>
        <div class="factors">${fac}</div>
        <div class="advice ${adv.warn ? 'warn' : ''}">${adv.text}</div>
      </section>`;
    if (w.life) {
      const l = w.life;
      const stage = pick(STAGE_NAMES[l.stage]);
      const next = l.stage < STAGE_TIME.length ? `<div class="stat"><span>${tr('Hacia', 'Towards')} ${pick(STAGE_NAMES[Math.min(5, l.stage + 1)]).toLowerCase()}</span><span>${pct(l.progress)}</span></div><div class="vessel thin moss"><i style="--v:${Math.round(l.progress * 100)}%"></i></div>` : '';
      const sp = l.stage >= 2 && l.origin && s.species ? ` · ${tr('los', 'the')} ${l.stage >= 2 ? (pick({ es: s.species.name, en: capName(s.species.name) })) : ''}` : '';
      html += `<section><h3>${tr('VIDA', 'LIFE')}</h3>
        <div class="stat"><span>${tr('Etapa', 'Stage')}</span><span class="moss">${stage}${sp}</span></div>
        ${next}
        <div class="stat" style="margin-top:6px"><span>${tr('Salud', 'Health')}</span><span>${pct(Math.max(0, l.health))}</span></div>
        <div class="vessel thin ${l.health > 0.5 ? 'moss' : ''}"><i style="--v:${Math.round(Math.max(0, l.health) * 100)}%"></i></div>
      </section>`;
    } else if (w.spark > 0.5) {
      html += `<section><h3>${tr('VIDA', 'LIFE')}</h3><div class="small">${tr('Algo se agita en sus aguas…', 'Something stirs in its waters…')}</div><div class="vessel thin moss" style="margin-top:6px"><i style="--v:${Math.round((w.spark / 30) * 100)}%"></i></div></section>`;
    }
    {
      const role = roleOf(w, st);
      const settled = isSettled(w);
      const jewel = role === 'science' && parent && parent.gas / Math.max(1e-6, massOf(parent)) > 0.3;
      html += `<section><h3>${settled ? tr('APORTA', 'CONTRIBUTES') : tr('SI SE COLONIZA, APORTARÁ', 'IF SETTLED, IT WILL GIVE')}</h3>
        <div class="role ${ROLE_RES[role]}"><span class="ri">${RES_ICON[ROLE_RES[role]]}</span><span>${roleText(role)}</span></div>
        ${jewel ? `<div class="small gold" style="margin-top:4px">${tr('Luna viva de un gigante: su ciencia vale el doble.', 'Living moon of a giant: its science is worth double.')}</div>` : ''}
        ${w.guest ? `<div class="small water" style="margin-top:4px">${tr(`Hogar de los ${w.guest}, refugiados de otra estrella.`, `Home of the ${capName(w.guest)}, refugees from another star.`)}</div>` : ''}
      </section>`;
    }
    if (w.colony > 0 || w.terra > 0 || w.sats > 0) {
      html += `<section><h3>${tr('CIVILIZACIÓN', 'CIVILIZATION')}</h3>
        ${w.colony > 0 ? `<div class="stat"><span>${w.colony >= 1 ? tr('Colonia establecida', 'Colony established') : tr('Colonos en camino', 'Settlers arriving')}</span><span>${pct(Math.min(1, w.colony))}</span></div><div class="vessel thin gold"><i style="--v:${Math.round(Math.min(1, w.colony) * 100)}%"></i></div>` : ''}
        ${w.terra > 0 ? `<div class="stat" style="margin-top:6px"><span>${tr('Terraformación', 'Terraforming')}</span><span>${pct(w.terra)}</span></div><div class="vessel thin moss"><i style="--v:${Math.round(w.terra * 100)}%"></i></div>` : ''}
        ${w.sats > 0 ? `<div class="stat" style="margin-top:6px"><span>${tr('Satélites en órbita', 'Satellites in orbit')}</span><span>${w.sats}</span></div>` : ''}
      </section>`;
    }
    if (w.invaded > 0.02) {
      const al = s.alienSpecies ? pick({ es: s.alienSpecies.name, en: capName(s.alienSpecies.name) }) : '';
      html += `<section><h3 class="violet">${tr('VISITANTES', 'VISITORS')}</h3>
        <div class="stat"><span>${tr(`Ocupado por los ${al}`, `Occupied by the ${al}`)}</span><span>${pct(w.invaded)}</span></div>
        <div class="vessel thin violet"><i style="--v:${Math.round(w.invaded * 100)}%"></i></div>
        <div class="advice warn">${tr('Una <b>llamarada</b> solar los expulsa, aunque también castiga un poco la atmósfera.', 'A solar <b>flare</b> drives them out, though it also batters the atmosphere a little.')}</div>
      </section>`;
    }
    this.body.innerHTML = html;
  }

  showStar(s: GameState, energyRate: number) {
    const fresh = this.target !== 'star';
    this.target = 'star';
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
  private rows = new Map<number, { row: HTMLElement; bar: HTMLElement; flags: HTMLElement; dot: HTMLElement; name: HTMLElement }>();
  private list: HTMLElement;
  private head: HTMLElement;
  private order = '';

  constructor(
    host: HTMLElement,
    private on: LedgerHandlers,
  ) {
    this.head = h('h3');
    this.list = h('div', { class: 'rows' });
    this.el = stone('ledger obsidian', this.head, this.list);
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
    this.head.innerHTML = `<span>${tr('MUNDOS', 'WORLDS')} · ${planets.length}</span><span class="muted">${this.el.classList.contains('collapsed') ? '▸' : '▾'}</span>`;
    if (key !== this.order) {
      this.order = key;
      clear(this.list);
      this.rows.clear();
      for (const w of ordered) {
        const dot = h('span', { class: 'dot' });
        const name = h('span');
        const bar = h('div', { class: 'vessel thin moss' }, h('i'));
        const flags = h('span', { class: 'flags' });
        const row = h('div', { class: `row ${w.parent !== null ? 'moon' : ''}`, onclick: () => this.on.select(w.id) }, dot, name, bar, flags);
        this.list.append(row);
        this.rows.set(w.id, { row, bar, flags, dot, name });
      }
    }
    const threatened = new Set(s.threats.map((t) => t.target));
    for (const w of ordered) {
      const r = this.rows.get(w.id)!;
      const st = stats.get(w.id);
      if (!st) continue;
      r.name.textContent = w.name;
      r.dot.style.background = kindDot(st.kind);
      if (w.parent !== null) r.dot.style.transform = 'scale(.75)';
      (r.bar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round(st.H * 100)}%`);
      r.bar.title = tr(`Habitabilidad ${Math.round(st.H * 100)} %`, `Habitability ${Math.round(st.H * 100)}%`);
      let f = '';
      if (w.life) f += '<span class="moss">❦</span>';
      if (isSettled(w)) f += `<span class="role-dot ${ROLE_RES[roleOf(w, st)]}">${RES_ICON[ROLE_RES[roleOf(w, st)]]}</span>`;
      else if (w.colony >= 1) f += '<span class="gold">⌂</span>';
      if (w.invaded > 0.3) f += '<span class="violet">⚠</span>';
      if (threatened.has(w.id)) f += '<span class="ember">☄</span>';
      if (r.flags.innerHTML !== f) r.flags.innerHTML = f;
      r.row.classList.toggle('sel', selected === w.id);
    }
  }
}
