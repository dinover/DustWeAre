import { int, pick, tr } from '../i18n';
import type { Resources } from '../core/state';
import { ERA_NAMES, MISSION_COST, PROJECTS, TECHS, researchCost, type ProjectDef, type ProjectId } from '../content/projects';
import { RES_ICON, RES_KEYS, type CivSim } from '../sim/civ';
import { PATROL_COST, STAR_INCOME, type PatrolSim } from '../sim/patrols';
import { h, stone, clear } from './dom';

export const resName = (k: keyof Resources) =>
  ({ metal: tr('metal', 'metal'), fuel: tr('combustible', 'fuel'), water: tr('agua', 'water'), science: tr('ciencia', 'science') })[k];

/** Cost chips: each resource with its icon, red when there is not enough. */
export function costChips(cost: Partial<Resources>, have: Resources | null) {
  return RES_KEYS.filter((k) => cost[k])
    .map((k) => `<span class="cost-chip ${k} ${have && have[k] < (cost[k] ?? 0) ? 'short' : ''}" data-tip="${resName(k)}">${RES_ICON[k]} ${int(cost[k] ?? 0)}</span>`)
    .join('');
}

interface CardRefs {
  def: ProjectDef;
  el: HTMLElement;
  cost: HTMLElement;
  btn: HTMLButtonElement;
  note: HTMLElement;
  bar: HTMLElement;
}

/** The great works of the civilization, and its missions beyond the system. */
export class ProjectsPanel {
  el: HTMLElement;
  private cards: CardRefs[] = [];
  private res = h('div', { class: 'proj-res' });
  private mission: { kind: 'expedition' | 'armada'; btn: HTMLButtonElement; note: HTMLElement; cost: HTMLElement }[] = [];
  private research: { btn: HTMLButtonElement; note: HTMLElement; cost: HTMLElement; title: HTMLElement; bar: HTMLElement } | null = null;
  private closeFn: () => void = () => {};
  private beyond = h('div', { class: 'beyond' });
  private beyondHtml = '';

  constructor(
    private civ: CivSim,
    private on: { start(id: ProjectId): void; expedition(): void; armada(): void; research(): void; close(): void; send(id: number, conquer: boolean): void; release(id: number): void; rename(id: number): void },
    private patrols?: PatrolSim,
  ) {
    this.el = h('div', { class: 'projects' });
    this.build();
  }

  bindClose(fn: () => void) {
    this.closeFn = fn;
  }

  private build() {
    clear(this.el);
    this.el.append(this.res);
    for (const era of [1, 2, 3] as const) {
      const grid = h('div', { class: 'proj-grid' });
      this.el.append(h('h3', { class: 'proj-era' }, pick(ERA_NAMES[era])), grid);
      for (const def of PROJECTS.filter((p) => p.era === era)) {
        const cost = h('div', { class: 'costs' });
        const note = h('div', { class: 'note small' });
        const bar = h('div', { class: 'vessel thin gold' }, h('i'));
        const btn = h('button', { class: 'btn small primary', onclick: () => this.on.start(def.id) }, tr('Construir', 'Build')) as HTMLButtonElement;
        const el = h(
          'div',
          { class: 'proj' },
          h('div', { class: 'proj-head' }, h('span', { class: 'proj-ico' }, def.icon), h('b', null, pick(def.name))),
          h('div', { class: 'small muted' }, pick(def.desc)),
          h('div', { class: 'small gold', style: 'margin-top:4px' }, pick(def.effect)),
          cost,
          note,
          bar,
          btn,
        );
        grid.append(el);
        this.cards.push({ def, el, cost, btn, note, bar });
      }
    }
    // Missions beyond the system, and research that never ends.
    const grid = h('div', { class: 'proj-grid' });
    {
      const cost = h('div', { class: 'costs' });
      const note = h('div', { class: 'note small' });
      const title = h('b');
      const bar = h('div', { class: 'vessel thin moss' }, h('i'));
      const btn = h('button', { class: 'btn small primary', onclick: () => this.on.research() }, tr('Investigar', 'Research')) as HTMLButtonElement;
      grid.append(
        h(
          'div',
          { class: 'proj mission research' },
          h('div', { class: 'proj-head' }, h('span', { class: 'proj-ico' }, '⚗'), title),
          h('div', { class: 'small muted' }, tr('Cada tecnología nueva hace que todo el sistema produzca un 10 % más.', 'Each new technology makes the whole system produce 10% more.')),
          cost,
          note,
          bar,
          btn,
        ),
      );
      this.research = { btn, note, cost, title, bar };
    }
    this.el.append(h('h3', { class: 'proj-era' }, tr('Misiones', 'Missions')), grid);
    const mk = (kind: 'expedition' | 'armada', icon: string, name: string, desc: string, label: string, fire: () => void) => {
      const cost = h('div', { class: 'costs' });
      const note = h('div', { class: 'note small' });
      const btn = h('button', { class: 'btn small primary', onclick: fire }, label) as HTMLButtonElement;
      grid.append(h('div', { class: 'proj mission' }, h('div', { class: 'proj-head' }, h('span', { class: 'proj-ico' }, icon), h('b', null, name)), h('div', { class: 'small muted' }, desc), cost, note, btn));
      this.mission.push({ kind, btn, note, cost });
    };
    mk(
      'expedition',
      '✶',
      tr('Expedición estelar', 'Star expedition'),
      tr('Una nave salta a otra estrella y vuelve con hallazgos: recursos, aliados, colonias… o problemas.', 'A ship jumps to another star and comes back with findings: resources, allies, colonies… or trouble.'),
      tr('Enviar', 'Send'),
      () => this.on.expedition(),
    );
    mk(
      'armada',
      '⚔',
      tr('Lanzar la armada', 'Launch the armada'),
      tr('Naves de todos los pueblos se reúnen, forman y saltan a la vez: contra los invasores, o hacia lo desconocido.', 'Ships of every people gather, form up and jump at once: against the invaders, or into the unknown.'),
      tr('¡Convocar!', 'Muster!'),
      () => {
        this.on.armada();
        this.closeFn();
      },
    );
    // Beyond the system: the Space Patrols and the colonies around other stars.
    this.el.append(h('h3', { class: 'proj-era' }, tr('Más allá del sistema', 'Beyond the system')), this.beyond);
    this.beyond.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-act]') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      const id = Number(b.dataset.id);
      if (b.dataset.act === 'rename') this.on.rename(id);
      else if (b.dataset.act === 'release') this.on.release(id);
      else this.on.send(id, b.dataset.act === 'conquer');
    });
    this.refresh();
  }

  /** The Space Patrols' card and one row per distant colony. */
  private beyondView() {
    const P = this.patrols;
    const s = this.civ.state;
    if (!P || !s) return '';
    const p = P.patrol;
    let html = '<div class="patrol-card">';
    if (!p) {
      html += `<div class="proj-head"><span class="proj-ico pt">⛨</span><b>Space Patrols</b></div><div class="small muted">${tr(
        'Aún no existen. Si los invasores llegan a dominar varios mundos, los pueblos fundarán una orden de guerreros acorazados con su propia barcaza de batalla.',
        'They do not exist yet. If invaders come to hold several worlds, the peoples will found an order of armoured warriors with their own battle barge.',
      )}</div>`;
    } else {
      const target = p.target !== undefined ? s.worlds.find((w) => w.id === p.target)?.name : undefined;
      const star = p.star !== undefined ? P.star(p.star)?.name : undefined;
      const status =
        p.phase === 'away'
          ? tr(`luchando en ${star ?? 'otra estrella'}`, `fighting at ${star ?? 'another star'}`)
          : p.phase === 'rising'
            ? tr('elevándose hacia su órbita', 'rising to its orbit')
            : p.phase === 'approach' || p.phase === 'assault'
              ? p.goal === 'war'
                ? tr(`imponiendo la paz sobre ${target}`, `imposing peace on ${target}`)
                : tr(`purgando ${target}`, `purging ${target}`)
              : tr('en órbita alta, vigilando', 'in high orbit, on watch');
      html += `<div class="proj-head"><span class="proj-ico pt">⛨</span><b>Space Patrols · «${tr(p.barge.es, p.barge.en)}»</b></div>
        <div class="small"><span class="muted">${tr('Estado', 'Status')}:</span> ${status}</div>
        <div class="patrol-stats small"><span>☠ ${int(p.kills)} <em>${tr('xenos abatidos', 'xenos slain')}</em></span><span>⛨ ${int(p.purges)} <em>${p.purges === 1 ? tr('mundo purgado', 'world purged') : tr('mundos purgados', 'worlds purged')}</em></span><span>☮ ${int(p.wars)} <em>${p.wars === 1 ? tr('guerra terminada', 'war ended') : tr('guerras terminadas', 'wars ended')}</em></span><span>✶ ${int(p.strikes)} <em>${p.strikes === 1 ? tr('salto a otra estrella', 'jump to another star') : tr('saltos a otras estrellas', 'jumps to other stars')}</em></span></div>`;
    }
    html += '</div>';
    const stars = P.stars;
    if (!stars.length) {
      html += `<div class="small muted" style="margin:8px 2px">${tr('Todavía ningún pueblo vive junto a otra estrella. Las flotillas de colonos, las expediciones y la armada fundarán colonias lejanas.', 'No people lives around another star yet. Colonist flotillas, expeditions and the armada will found distant colonies.')}</div>`;
      return html;
    }
    const dom = P.dominions();
    html += `<div class="small muted" style="margin:8px 2px">${tr(
      `${stars.length} ${stars.length === 1 ? 'colonia lejana' : 'colonias lejanas'} · ${dom} ${dom === 1 ? 'dominio' : 'dominios'}. Las colonias libres solo comercian; los dominios pagan tributo, pero cada uno hace que las invasiones lleguen antes y con más fuerza.`,
      `${stars.length} distant ${stars.length === 1 ? 'colony' : 'colonies'} · ${dom} ${dom === 1 ? 'dominion' : 'dominions'}. Free colonies only trade; dominions pay tribute, but each one makes invasions come sooner and stronger.`,
    )}</div><div class="star-rows">`;
    const res = s.civ?.res ?? null;
    for (const st of stars) {
      const people = s.peoples?.find((x) => x.id === st.people);
      const col = people ? `hsl(${Math.round(people.hue * 360)} 70% 64%)` : '#e8d2a0';
      const who = people ? tr(`colonia ${people.name}`, `${people.name.charAt(0).toUpperCase() + people.name.slice(1)} colony`) : tr('colonia mixta', 'mixed colony');
      const trouble = st.trouble
        ? `<span class="ember">${{ pirates: tr('⚠ piratas', '⚠ pirates'), natives: tr('⚑ revuelta', '⚑ revolt'), invaders: tr('⚠ invasores', '⚠ invaders'), plague: tr('☣ plaga', '☣ plague') }[st.trouble.kind]}</span>`
        : st.strike
          ? `<span class="pt">${tr('⛨ los Patrols van hacia allí', '⛨ the Patrols are on their way')}</span>`
          : `<span class="muted">${tr('en calma', 'calm')}</span>`;
      const inc = STAR_INCOME[st.mode];
      const income = RES_KEYS.map((k) => `<span class="${k}">${RES_ICON[k]}+${(inc[k] * (st.trouble ? 0.4 : 1) * (0.5 + 0.5 * st.health)).toFixed(2).replace('.', tr(',', '.'))}</span>`).join(' ');
      const helpLock = P.strikeLock(st, false);
      const conqLock = P.strikeLock(st, true);
      // Disabled buttons swallow no events: the tooltip lives on a wrapper.
      const btn = (act: string, cls: string, label: string, tip: string, off: boolean) =>
        `<span class="bw" data-tip="${tip}"><button class="btn small ${cls}" data-act="${act}" data-id="${st.id}"${off ? ' disabled' : ''}>${label}</button></span>`;
      let btns = '';
      if (st.trouble && p) btns += btn('help', 'primary', `${tr('Socorrer', 'Defend')} ${costChips(PATROL_COST.help, res)}`, helpLock ? pick(helpLock) : tr('Los Space Patrols saltan a defender la colonia.', 'The Space Patrols jump to defend the colony.'), !!helpLock);
      if (st.mode === 'trade' && p) btns += btn('conquer', '', `${tr('Conquistar', 'Conquer')} ${costChips(PATROL_COST.conquer, res)}`, conqLock ? pick(conqLock) : tr('Los Space Patrols someten el sistema: pasará a ser un dominio.', 'The Space Patrols bring the system to heel: it will become a dominion.'), !!conqLock);
      if (st.mode === 'dominion') btns += btn('release', '', tr('Liberar', 'Set free'), tr('Devolverle la libertad: solo comerciará, y el sistema se ganará menos enemigos.', 'Give it back its freedom: it will only trade, and the system will make fewer enemies.'), false);
      html += `<div class="star-row ${st.mode}${st.trouble ? ' trouble' : ''}">
        <div class="sr-head"><i style="background:${col};color:${col}"></i><b>${st.name}</b><button class="rename-btn" data-act="rename" data-id="${st.id}" data-tip="${tr('Ponerle nombre', 'Give it a name')}">✎</button><span class="badge ${st.mode}">${st.mode === 'dominion' ? tr('Dominio', 'Dominion') : tr('Comercio', 'Trade')}</span></div>
        <div class="small"><span class="muted">${who}</span> · ${trouble}</div>
        <div class="vessel thin ${st.health > 0.5 ? 'moss' : 'gold'}" data-tip="${tr(`Estado de la colonia: ${Math.round(st.health * 100)} %`, `Colony condition: ${Math.round(st.health * 100)}%`)}"><i style="--v:${Math.round(st.health * 100)}%"></i></div>
        <div class="sr-inc small">${income} <em class="muted">/s</em></div>
        ${btns ? `<div class="sr-btns">${btns}</div>` : ''}
      </div>`;
    }
    html += '</div>';
    return html;
  }

  refresh() {
    const civ = this.civ.civ;
    if (!civ) return;
    const r = this.civ.rates;
    this.res.innerHTML = RES_KEYS.map(
      (k) => `<span class="res-pill ${k}"><b>${RES_ICON[k]} ${int(civ.res[k])}</b><small>${resName(k)} · +${r[k].toFixed(1).replace('.', tr(',', '.'))}/s</small></span>`,
    ).join('');
    for (const c of this.cards) {
      const done = !!civ.done[c.def.id];
      const building = civ.building?.id === c.def.id;
      const lock = this.civ.lock(c.def.id);
      const html = costChips(c.def.cost, civ.res);
      if (c.cost.innerHTML !== html) c.cost.innerHTML = html;
      c.el.classList.toggle('done', done);
      c.el.classList.toggle('locked', !done && !building && !!lock);
      c.bar.style.display = building ? '' : 'none';
      if (building) (c.bar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round((civ.building!.t / civ.building!.dur) * 100)}%`);
      const short = !this.civ.canAfford(c.def.cost);
      c.btn.disabled = done || building || !!lock || short;
      c.btn.textContent = done ? tr('Completado ✓', 'Completed ✓') : building ? tr('En construcción…', 'Under construction…') : tr('Construir', 'Build');
      c.note.textContent = done || building ? '' : lock ? pick(lock) : short ? tr('Faltan recursos.', 'Not enough resources.') : '';
    }
    if (this.research) {
      const R = this.research;
      const lvl = civ.tech ?? 0;
      const next = TECHS[lvl % TECHS.length];
      R.title.textContent = `${tr('Investigación', 'Research')} · ${tr(next.es, next.en)}`;
      const html = costChips(researchCost(lvl), civ.res);
      if (R.cost.innerHTML !== html) R.cost.innerHTML = html;
      R.bar.style.display = civ.research ? '' : 'none';
      if (civ.research) (R.bar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round((civ.research.t / civ.research.dur) * 100)}%`);
      const lock = this.civ.researchLock();
      R.btn.disabled = !!lock;
      R.btn.textContent = civ.research ? tr('Investigando…', 'Researching…') : tr('Investigar', 'Research');
      R.note.textContent = civ.research ? '' : lock ? pick(lock) : tr(`Tecnologías dominadas: ${lvl}`, `Technologies mastered: ${lvl}`);
    }
    for (const m of this.mission) {
      const lock = this.civ.missionLock(m.kind);
      m.btn.disabled = !!lock;
      m.note.textContent = lock ? pick(lock) : '';
      const html = costChips(MISSION_COST[m.kind], civ.res);
      if (m.cost.innerHTML !== html) m.cost.innerHTML = html;
    }
    const bh = this.beyondView();
    if (bh !== this.beyondHtml) this.beyond.innerHTML = this.beyondHtml = bh;
  }
}
