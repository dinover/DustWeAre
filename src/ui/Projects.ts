import { int, pick, tr } from '../i18n';
import type { Resources } from '../core/state';
import { ERA_NAMES, MISSION_COST, PROJECTS, TECHS, researchCost, type ProjectDef, type ProjectId } from '../content/projects';
import { RES_ICON, RES_KEYS, type CivSim } from '../sim/civ';
import { h, stone, clear } from './dom';

export const resName = (k: keyof Resources) =>
  ({ metal: tr('metal', 'metal'), fuel: tr('combustible', 'fuel'), water: tr('agua', 'water'), science: tr('ciencia', 'science') })[k];

/** Cost chips: each resource with its icon, red when there is not enough. */
export function costChips(cost: Partial<Resources>, have: Resources | null) {
  return RES_KEYS.filter((k) => cost[k])
    .map((k) => `<span class="cost-chip ${k} ${have && have[k] < (cost[k] ?? 0) ? 'short' : ''}" title="${resName(k)}">${RES_ICON[k]} ${int(cost[k] ?? 0)}</span>`)
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

  constructor(
    private civ: CivSim,
    private on: { start(id: ProjectId): void; expedition(): void; armada(): void; research(): void; close(): void },
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
      tr('Todas tus naves se reúnen, forman y saltan a la vez: contra los invasores, o hacia lo desconocido.', 'All your ships gather, form up and jump at once: against the invaders, or into the unknown.'),
      tr('¡Convocar!', 'Muster!'),
      () => {
        this.on.armada();
        this.closeFn();
      },
    );
    this.refresh();
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
  }
}
