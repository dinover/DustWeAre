import { int, num, pick, tr } from '../i18n';
import type { GameState, NewsItem } from '../core/state';
import type { Tool } from '../sim/formation';
import { COST } from '../sim/system';
import { h, stone, clear, ICONS } from './dom';
import { fmtAge } from './text';
import { capName } from '../content/names';

export type Action = 'flare' | 'volcano' | 'comets' | 'migrate';

interface ToolDef<T extends string> {
  id: T;
  key: string;
  name: () => string;
  tip: () => string;
  icon: keyof typeof ICONS;
  cost?: number;
}

const FORMATION_TOOLS: ToolDef<Tool>[] = [
  {
    id: 'gather',
    key: '1',
    icon: 'gather',
    name: () => tr('Reunir', 'Gather'),
    tip: () => tr('<b>Reunir</b> · Mantén pulsado para juntar polvo y hielo en una piedra. Suéltala y crecerá barriendo su órbita.', '<b>Gather</b> · Hold to pull dust and ice into a pebble. Let go and it will grow by sweeping its orbit.'),
  },
  {
    id: 'heat',
    key: '2',
    icon: 'heat',
    name: () => tr('Calentar', 'Heat'),
    tip: () => tr('<b>Calentar</b> · Agita el disco: el gas y el polvo ligero se alejan de la estrella y el hielo se evapora.', '<b>Heat</b> · Stir the disk: gas and light dust drift away from the star and ice turns to vapour.'),
  },
  {
    id: 'cool',
    key: '3',
    icon: 'cool',
    name: () => tr('Enfriar', 'Cool'),
    tip: () => tr('<b>Enfriar</b> · Calma el disco: el polvo deja de agitarse, el hielo se condensa y nacen piedras por sí solas.', '<b>Cool</b> · Calm the disk: dust settles, ice condenses and pebbles form on their own.'),
  },
  {
    id: 'nudge',
    key: '4',
    icon: 'nudge',
    name: () => tr('Empujar', 'Nudge'),
    tip: () => tr('<b>Empujar</b> · Arrastra un cuerpo (o una nube de polvo) a otra órbita. Junta dos cuerpos y chocarán.', '<b>Nudge</b> · Drag a body (or a cloud of dust) to another orbit. Bring two bodies together and they will collide.'),
  },
];

const SYSTEM_ACTIONS: ToolDef<Action>[] = [
  {
    id: 'flare',
    key: '1',
    icon: 'flare',
    cost: COST.flare,
    name: () => tr('Llamarada', 'Flare'),
    tip: () => tr('<b>Llamarada solar</b> · Desvía asteroides, expulsa visitantes y destruye sus naves. También adelgaza el aire del mundo que toca.', '<b>Solar flare</b> · Deflects asteroids, drives visitors out and destroys their ships. It also thins the air of the world it hits.'),
  },
  {
    id: 'volcano',
    key: '2',
    icon: 'volcano',
    cost: COST.volcano,
    name: () => tr('Volcán', 'Volcano'),
    tip: () => tr('<b>Despertar volcanes</b> · Liberan gases que espesan la atmósfera y calientan el mundo.', '<b>Wake volcanoes</b> · They release gases that thicken the atmosphere and warm the world.'),
  },
  {
    id: 'comets',
    key: '3',
    icon: 'comets',
    cost: COST.comets,
    name: () => tr('Cometas', 'Comets'),
    tip: () => tr('<b>Lluvia de cometas</b> · Desvía cometas hacia un mundo para darle agua, orgánicos, aire o hierro.', '<b>Comet shower</b> · Steer comets into a world to give it water, organics, air or iron.'),
  },
  {
    id: 'migrate',
    key: '4',
    icon: 'migrate',
    cost: COST.migrate,
    name: () => tr('Migrar', 'Migrate'),
    tip: () => tr('<b>Migración orbital</b> · Acerca o aleja un planeta de la estrella con empujones gravitatorios bien sincronizados.', '<b>Orbital migration</b> · Move a planet closer to or farther from the star with well-timed gravity assists.'),
  },
];

export interface HudHandlers {
  tool(t: Tool): void;
  action(a: Action): void;
  star(): void;
  speed(v: number): void;
  menu(): void;
  settle(): void;
  chronicle(): void;
  cancelTarget(): void;
}

/** Heads-up display: name tablet, progress, starlight, speed, tools, news and hints. */
export class Hud {
  root: HTMLElement;
  private name = h('div', { class: 'name' });
  private sub = h('div', { class: 'sub' });
  private progLabel = h('div', { class: 'label' });
  private progBar = h('div', { class: 'vessel' }, h('i'));
  private row2 = h('div', { class: 'row2' });
  private settleBtn: HTMLButtonElement;
  private energyVal = h('b');
  private energyBar = h('div', { class: 'vessel' }, h('i'));
  private speedBtns: HTMLButtonElement[] = [];
  private toolbar: HTMLElement;
  private tip: HTMLElement;
  private toolEls = new Map<string, HTMLElement>();
  private newsEl: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private hintQueue: { id: string; glyph: string; html: () => string }[] = [];
  private hintTimer = 0;
  private banner: HTMLElement | null = null;
  tagEl: HTMLElement;
  private mode: 'formation' | 'system' | null = null;
  private tipTimer = 0;

  constructor(
    host: HTMLElement,
    private on: HudHandlers,
  ) {
    this.root = h('div', { class: 'hud passthrough', style: 'position:absolute;inset:0' });
    this.settleBtn = h('button', { class: 'btn small primary settle', onclick: () => this.on.settle() }) as HTMLButtonElement;
    const tablet = stone('tablet', this.name, this.sub, h('div', { class: 'seam bottom' }));
    tablet.style.cursor = 'pointer';
    tablet.title = tr('Ver la estrella', 'View the star');
    tablet.addEventListener('click', () => this.on.star());
    const prog = stone('progress-slab', this.progLabel, this.progBar, this.row2, this.settleBtn);
    const energy = stone('energy', h('div', { class: 'top' }, h('span', null, h('span', { class: 'sun-glyph' }), ' ', h('span', { class: 'lbl' })), this.energyVal), this.energyBar);
    const speeds: [number, string][] = [
      [0, '❚❚'],
      [1, '▶'],
      [2, '▶▶'],
      [4, '▶▶▶'],
    ];
    const speed = stone('speed', ...speeds.map(([v, t]) => {
      const b = h('button', { class: 'btn small', onclick: () => this.on.speed(v) }, t) as HTMLButtonElement;
      b.dataset.v = String(v);
      this.speedBtns.push(b);
      return b;
    }), h('button', { class: 'btn small', title: tr('Menú', 'Menu'), onclick: () => this.on.menu() }, '☰'));
    const top = h('div', { class: 'hud-top' }, tablet, prog, h('div', { class: 'right-cluster' }, energy, speed));
    this.toolbar = stone('toolbar');
    this.tip = stone('tool-tip');
    this.toolbar.append(this.tip);
    this.newsEl = h('div', { class: 'news' });
    this.tagEl = stone('tag');
    this.tagEl.style.display = 'none';
    this.root.append(top, this.toolbar, this.newsEl, this.tagEl);
    host.append(this.root);
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  /** Builds the tool bar for the current phase. */
  setMode(mode: 'formation' | 'system') {
    if (this.mode === mode) return;
    this.mode = mode;
    clear(this.toolbar);
    this.toolbar.append(this.tip);
    this.toolEls.clear();
    const defs = (mode === 'formation' ? FORMATION_TOOLS : SYSTEM_ACTIONS) as ToolDef<string>[];
    for (const d of defs) {
      const el = h(
        'div',
        { class: 'tool', 'data-tool': d.id, role: 'button', tabindex: '0' },
        h('span', { class: 'key' }, d.key),
        h('span', { html: ICONS[d.icon], style: 'display:contents' }),
        h('span', { class: 't' }, d.name()),
        d.cost ? h('span', { class: 'cost' }, `☀ ${d.cost}`) : null,
      );
      el.addEventListener('click', () => {
        if (mode === 'formation') this.on.tool(d.id as Tool);
        else this.on.action(d.id as Action);
      });
      el.addEventListener('pointerenter', (e) => {
        if ((e as PointerEvent).pointerType === 'mouse') this.showTip(d.tip());
      });
      el.addEventListener('pointerleave', () => this.tip.classList.remove('show'));
      this.toolbar.append(el);
      this.toolEls.set(d.id, el);
    }
    if (mode === 'system') {
      this.toolbar.append(h('div', { class: 'divider' }));
      const star = h('div', { class: 'tool', 'data-tool': 'star', role: 'button', tabindex: '0' }, h('span', { html: ICONS.star, style: 'display:contents' }), h('span', { class: 't' }, tr('Estrella', 'Star')));
      star.addEventListener('click', () => this.on.star());
      this.toolbar.append(star);
    }
    this.refreshLanguage();
  }

  showTip(html: string, seconds = 0) {
    this.tip.innerHTML = html;
    this.tip.classList.add('show');
    this.tipTimer = seconds;
  }

  refreshLanguage() {
    const defs = (this.mode === 'formation' ? FORMATION_TOOLS : SYSTEM_ACTIONS) as ToolDef<string>[];
    for (const d of defs) {
      const el = this.toolEls.get(d.id);
      const t = el?.querySelector('.t');
      if (t) t.textContent = d.name();
    }
    const star = this.toolbar.querySelector('[data-tool="star"] .t');
    if (star) star.textContent = tr('Estrella', 'Star');
    const lbl = this.root.querySelector('.energy .lbl');
    if (lbl) lbl.textContent = tr('Luz estelar', 'Starlight');
    this.settleBtn.textContent = tr('Asentar el sistema', 'Settle the system');
    if (this.banner) this.banner.remove();
    this.banner = null;
  }

  setActiveTool(id: string | null) {
    for (const [k, el] of this.toolEls) el.classList.toggle('active', k === id);
  }

  setActionState(state: Record<string, { ok: boolean; afford: boolean }>) {
    for (const [k, el] of this.toolEls) {
      const st = state[k];
      if (!st) continue;
      el.classList.toggle('disabled', !st.afford);
      const c = el.querySelector('.cost') as HTMLElement | null;
      if (c) c.style.color = st.afford ? '' : '#ff7a5a';
    }
  }

  setSpeed(v: number) {
    for (const b of this.speedBtns) b.classList.toggle('on', Number(b.dataset.v) === v);
  }

  update(s: GameState, info: { progress?: number; gas?: number; canSettle?: boolean; energyRate: number; living?: number; topStage?: number; reached?: number; total?: number }, dt: number) {
    if (this.tipTimer > 0) {
      this.tipTimer -= dt;
      if (this.tipTimer <= 0) this.tip.classList.remove('show');
    }
    this.name.textContent = s.name;
    const phase = s.phase === 'formation' ? tr('FORMACIÓN', 'FORMATION') : tr('SISTEMA', 'SYSTEM');
    let ageTxt = fmtAge(s.age);
    if (s.civStart != null && s.species) {
      const years = (s.age - s.civStart) * 1e6;
      ageTxt = tr(`Año ${int(years)} de los ${s.species.name}`, `Year ${int(years)} of the ${capName(s.species.name)}`);
    }
    this.sub.innerHTML = `<span class="phase-chip">${phase}</span><span>${ageTxt}</span>`;
    const e = Math.floor(s.energy);
    this.energyVal.textContent = `${e}`;
    (this.energyBar.firstChild as HTMLElement).style.setProperty('--v', `${s.energy}%`);
    this.energyBar.title = tr(`+${num(info.energyRate, 1)} por segundo`, `+${num(info.energyRate, 1)} per second`);
    if (s.phase === 'formation') {
      const p = info.progress ?? 0;
      this.progLabel.innerHTML = `<span>${tr('Polvo convertido en mundos', 'Dust turned into worlds')}</span><b>${Math.round(p * 100)} %</b>`;
      (this.progBar.firstChild as HTMLElement).style.setProperty('--v', `${Math.min(100, (p / 0.97) * 100)}%`);
      this.progBar.className = 'vessel gold';
      const g = info.gas ?? 1;
      this.row2.innerHTML = `<span>${tr('Gas del disco', 'Disk gas')}</span><div class="vessel thin water"><i style="--v:${Math.round(g * 100)}%"></i></div><span>${Math.round(g * 100)} %</span>`;
      this.row2.style.display = '';
      this.settleBtn.style.display = info.canSettle ? '' : 'none';
    } else {
      this.settleBtn.style.display = 'none';
      const top = info.topStage ?? -1;
      const lifeTxt =
        top < 0
          ? tr('Aún sin vida', 'No life yet')
          : `${tr('Vida', 'Life')}: ${pick([
              { es: 'microbios', en: 'microbes' },
              { es: 'vida compleja', en: 'complex life' },
              { es: 'inteligencia', en: 'intelligence' },
              { es: 'civilización', en: 'civilization' },
              { es: 'era espacial', en: 'space age' },
              { es: 'interplanetaria', en: 'interplanetary' },
            ][top])}`;
      const reached = info.reached ?? 0;
      const total = info.total ?? 1;
      const ark = s.arkTimer > 0 && !s.won;
      this.progLabel.innerHTML = `<span>${lifeTxt}</span><b>${ark ? tr('El arca se prepara', 'The ark is getting ready') : s.species ? tr(`${reached} de ${total} mundos habitados`, `${reached} of ${total} worlds settled`) : tr(`${info.living ?? 0} mundos con vida`, `${info.living ?? 0} living worlds`)}</b>`;
      const v = ark ? Math.min(1, s.arkTimer / 60) : s.species ? reached / Math.max(1, total) : Math.min(1, (top + 1) / 6);
      (this.progBar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round(v * 100)}%`);
      this.progBar.className = ark ? 'vessel gold' : 'vessel moss';
      this.row2.style.display = 'none';
    }
    // Hints rotate one at a time.
    if (this.hintEl) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.closeHint();
    } else if (this.hintQueue.length) this.openHint();
  }

  // ------------------------------------------------------------------ news
  pushNews(n: NewsItem, ageText: string) {
    const el = this.newsItem(n, ageText);
    el.addEventListener('click', () => this.on.chronicle());
    this.newsEl.prepend(el);
    while (this.newsEl.children.length > 3) this.newsEl.lastElementChild?.remove();
    const life = n.kind === 'fact' ? 14000 : 11000;
    setTimeout(() => el.classList.add('fade'), life);
    setTimeout(() => el.remove(), life + 1300);
  }

  newsItem(n: NewsItem, ageText: string) {
    return stone(`news-item ${n.kind}`, h('span', { class: 'ic' }, n.icon), h('div', null, h('span', { class: 'age' }, ageText), pick(n)));
  }

  clearNews() {
    clear(this.newsEl);
  }

  // ------------------------------------------------------------------ hints
  hint(id: string, glyph: string, html: () => string) {
    if (this.hintQueue.some((q) => q.id === id) || this.hintEl?.dataset.id === id) return;
    this.hintQueue.push({ id, glyph, html });
  }

  private openHint() {
    const q = this.hintQueue.shift()!;
    const el = stone('hint', h('span', { class: 'glyph' }, q.glyph), h('div', { html: q.html() }), h('button', { class: 'x', title: tr('Entendido', 'Got it'), onclick: () => this.closeHint() }, '✕'));
    el.dataset.id = q.id;
    this.hintEl = el;
    this.hintTimer = 18;
    this.root.append(el);
  }

  closeHint() {
    if (!this.hintEl) return;
    const el = this.hintEl;
    this.hintEl = null;
    el.style.transition = 'opacity .5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  }

  clearHints() {
    this.hintQueue = [];
    this.hintEl?.remove();
    this.hintEl = null;
  }

  // ------------------------------------------------------------------ targeting
  showBanner(text: string | null) {
    this.banner?.remove();
    this.banner = null;
    if (!text) return;
    this.banner = stone('target-banner', h('span', { html: text }), h('button', { class: 'btn small', onclick: () => this.on.cancelTarget() }, tr('Cancelar', 'Cancel')));
    this.root.append(this.banner);
  }
}
