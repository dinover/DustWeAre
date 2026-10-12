import { int, num, pick, tr } from '../i18n';
import type { GameState, NewsItem, Resources } from '../core/state';
import { RES_ICON, RES_KEYS } from '../sim/civ';
import type { Tool } from '../sim/formation';
import { COST, WRATH_COST } from '../sim/system';
import { h, stone, clear, ICONS } from './dom';
import { fmtAge } from './text';
import { capName } from '../content/names';
import type { ProjTab } from './Projects';

export type Action = 'flare' | 'volcano' | 'comets' | 'migrate' | 'wrath' | 'bless';

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
  {
    id: 'wrath',
    key: '5',
    icon: 'wrath',
    name: () => tr('Ira', 'Wrath'),
    tip: () =>
      tr(
        '<b>Ira de la estrella</b> · Para quien quiera ser temido: plagas, lluvias de meteoritos, inviernos sin fin, discordia u ofrendas de vidas. Los pueblos lo recuerdan, y su miedo aviva tu luz.',
        '<b>Wrath of the star</b> · For those who want to be feared: plagues, meteor storms, endless winters, discord or offerings of lives. The peoples remember, and their fear feeds your light.',
      ),
  },
  {
    id: 'bless',
    key: '6',
    icon: 'bless',
    cost: COST.bless,
    name: () => tr('Bendición', 'Blessing'),
    tip: () =>
      tr(
        '<b>Bendición</b> · Una aurora dorada sobre un mundo habitado: la vida sana, las plagas remiten y el clima se calma. Sus pueblos creen un poco más en la estrella, y la fe da sus frutos.',
        '<b>Blessing</b> · A golden aurora over a peopled world: life heals, plagues fade and the climate calms down. Its peoples believe in the star a little more, and faith bears fruit.',
      ),
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
  /** Opens Projects (on a given tab, or the last one opened). */
  works(tab?: ProjTab): void;
  decide(id: number, accept: boolean, choice?: number): void;
  /** A piece of news was clicked: take the camera there. */
  news(n: NewsItem): void;
  renameSystem(): void;
}

/** One pending choice, already written for the current language. */
export interface DecisionView {
  id: number;
  icon: string;
  title: string;
  body: string;
  yes: string;
  yesOk: boolean;
  no: string;
  left: number;
  dur: number;
  /** Several ways to say yes (they replace the yes button): `choice` goes back with the answer. */
  options?: { label: string; ok: boolean; tip?: string; choice: number; primary?: boolean }[];
  /** Lives are at stake: it goes first and burns brighter. */
  urgent?: boolean;
}

/** Decisions on screen at once before the rest fold into “+N more”. */
const MAX_DECISIONS = 3;

/** Faith in the star, for the starlight slab. */
export interface FaithInfo {
  believers: number;
  believersTxt: { es: string; en: string };
  dread: number;
  tier: number;
  tierName: { es: string; en: string };
  gift: { es: string; en: string } | null;
  order: boolean;
  /** The latest reasons faith rose (+1) or fear grew (−1), newest last. */
  moral: { sign: 1 | -1; es: string; en: string }[];
}

export interface LateInfo {
  era: string;
  label: string;
  v: number;
  res: Resources;
  rates: Resources;
  canBuild: boolean;
  /** Threat level, and the level of each defence (0: not there yet). */
  threat: number;
  /** How tempting the system looks to raiders (worlds and stores). */
  allure: number;
  /** What the star ark still needs (from the warp drive on). */
  ark?: { es: string; en: string; ok: boolean }[];
  def: Record<'fleet' | 'shield' | 'patrol', number>;
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
  private progSlab!: HTMLElement;
  private subHtml = '';
  private energyVal = h('b');
  private energyBar = h('div', { class: 'vessel' }, h('i'));
  private faithEl = h('div', { class: 'faith-line' });
  private faithHtml = '';
  private speedBtns: HTMLButtonElement[] = [];
  private toolbar: HTMLElement;
  private tip: HTMLElement;
  private toolEls = new Map<string, HTMLElement>();
  private newsEl: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private hintQueue: { id: string; glyph: string; html: () => string; prio: number; onShow?: () => void }[] = [];
  private hintTimer = 0;
  /** The pointer rests on the hint: it is being read, so it waits. */
  private hintHold = false;
  /** Every pending decision is shown, not just the first three. */
  private decisionsOpen = false;
  private banner: HTMLElement | null = null;
  tagEl: HTMLElement;
  private mode: 'formation' | 'system' | null = null;
  private resEl: HTMLElement;
  private decisionsEl: HTMLElement;
  private decisionKey = '';
  private ageT = 0;
  private worksEl: HTMLElement | null = null;
  private tipTimer = 0;
  /** The resource tablet's pills, built once: only their text, class and tip change. */
  private resPills: { k: string; el: HTMLElement; n: HTMLElement; label?: HTMLElement }[] | null = null;
  private layoutT = 0;

  constructor(
    host: HTMLElement,
    private on: HudHandlers,
  ) {
    this.root = h('div', { class: 'hud passthrough', style: 'position:absolute;inset:0' });
    this.settleBtn = h('button', { class: 'btn small primary settle', onclick: () => this.on.settle() }) as HTMLButtonElement;
    const rename = h(
      'button',
      {
        class: 'rename-btn',
        'data-tip': tr('Ponerle nombre al sistema', 'Name the system'),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.on.renameSystem();
        },
      },
      '✎',
    );
    const tablet = stone('tablet', h('div', { class: 'name-line' }, this.name, rename), this.sub, h('div', { class: 'seam bottom' }));
    tablet.style.cursor = 'pointer';
    tablet.dataset.tip = tr('<b>El sistema</b><br>Toca para ver la estrella y ajustar su brillo. ✎ para ponerle nombre.', '<b>The system</b><br>Tap to see the star and adjust its brightness. ✎ to name it.');
    tablet.addEventListener('click', () => this.on.star());
    const prog = stone('progress-slab', this.progLabel, this.progBar, this.row2, this.settleBtn);
    this.progSlab = prog;
    // The faith line opens Projects on the faith tab.
    this.faithEl.addEventListener('click', () => this.on.works('faith'));
    const energy = stone('energy', h('div', { class: 'top' }, h('span', null, h('span', { class: 'sun-glyph' }), ' ', h('span', { class: 'lbl' })), this.energyVal), this.energyBar, this.faithEl);
    const speeds: [number, string][] = [
      [0, '❚❚'],
      [1, '▶'],
      [2, '▶▶'],
      [4, '▶▶▶'],
    ];
    const speedNames = [tr('Pausa', 'Pause'), tr('Velocidad normal', 'Normal speed'), tr('Velocidad ×2', 'Speed ×2'), tr('Velocidad ×4', 'Speed ×4')];
    const speed = stone('speed', ...speeds.map(([v, t], i) => {
      const b = h('button', { class: 'btn small', 'aria-label': speedNames[i], 'aria-pressed': 'false', onclick: () => this.on.speed(v) }, t) as HTMLButtonElement;
      b.dataset.v = String(v);
      this.speedBtns.push(b);
      return b;
    }), h('button', { class: 'btn small', 'data-tip': tr('Menú', 'Menu'), 'aria-label': tr('Menú', 'Menu'), onclick: () => this.on.menu() }, '☰'));
    this.resEl = stone('res-tablet');
    this.resEl.style.display = 'none';
    this.resEl.dataset.tip = tr('<b>Recursos</b><br>Lo que reúnen los pueblos del sistema. Toca para abrir Proyectos.', '<b>Resources</b><br>What the peoples of the system gather. Tap to open Projects.');
    // The threat pill opens straight on the defences (the pills are never rebuilt, so the click lands on it).
    this.resEl.addEventListener('click', (e) => this.on.works((e.target as Element).closest('.threat') ? 'def' : undefined));
    const top = h('div', { class: 'hud-top' }, tablet, prog, h('div', { class: 'right-cluster' }, this.resEl, energy, speed));
    this.decisionsEl = h('div', { class: 'decisions' });
    this.toolbar = stone('toolbar');
    this.tip = stone('tool-tip');
    this.toolbar.append(this.tip);
    this.newsEl = h('div', { class: 'news', role: 'log', 'aria-live': 'polite' });
    this.tagEl = stone('tag');
    this.tagEl.style.display = 'none';
    this.root.append(top, this.toolbar, this.newsEl, this.tagEl, this.decisionsEl);
    host.append(this.root);
    window.addEventListener('resize', () => this.layoutNews());
  }

  /**
   * The news column (bottom left) rises above the tool bar whenever the two would overlap, so no
   * tool is ever hidden under the news. `--tb-h` carries the bar's real height for the CSS.
   */
  private layoutNews() {
    const ui = this.root.parentElement;
    if (!ui) return;
    const bar = this.toolbar.getBoundingClientRect();
    const news = this.newsEl.getBoundingClientRect();
    ui.style.setProperty('--tb-h', `${Math.round(bar.height)}px`);
    ui.classList.toggle('news-up', bar.width > 0 && news.width > 0 && news.right + 8 > bar.left);
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
      const el = this.toolButton(d.id, d.icon, d.name(), d.key, () => d.tip(), () => (mode === 'formation' ? this.on.tool(d.id as Tool) : this.on.action(d.id as Action)));
      const cost = d.cost ? `☀ ${d.cost}` : d.id === 'wrath' ? `☀ ${Math.min(...Object.values(WRATH_COST))}+` : '';
      if (cost) el.append(h('span', { class: 'cost' }, cost));
      this.toolEls.set(d.id, el);
    }
    if (mode === 'system') {
      this.toolbar.append(h('div', { class: 'divider' }));
      this.toolButton('star', 'star', tr('Estrella', 'Star'), '', () => tr('<b>La estrella</b> · Su brillo, su luz estelar y la fe de los pueblos.', '<b>The star</b> · Its brightness, its starlight and the peoples’ faith.'), () => this.on.star());
      const works = this.toolButton('works', 'works', tr('Proyectos', 'Projects'), 'P', () => tr('<b>Proyectos</b> · Grandes obras, expediciones a otras estrellas y la armada. Se pagan con lo que aporta cada mundo.', '<b>Projects</b> · Great works, expeditions to other stars and the armada. Paid for with what each world contributes.'), () => this.on.works());
      works.classList.add('works');
      works.append(h('span', { class: 'badge' }));
      this.worksEl = works;
    }
    // The chronicle: every event so far, and where it happened.
    if (mode === 'formation') this.toolbar.append(h('div', { class: 'divider' }));
    const chron = this.toolButton('chronicle', 'chronicle', tr('Crónica', 'Chronicle'), 'C', () => tr('<b>Crónica</b> · Todo lo que ha pasado. Toca un suceso para ir a verlo.', '<b>Chronicle</b> · Everything that has happened. Tap an event to go and see it.'), () => this.on.chronicle());
    chron.classList.add('chron');
    this.refreshLanguage();
    this.layoutNews();
  }

  /**
   * One tool of the bar: a real button (Tab reaches it, Enter and Space press it) that shows its
   * explanation on hover or keyboard focus. A mouse click does not leave the focus on it, so Space
   * keeps pausing the game.
   */
  private toolButton(id: string, icon: keyof typeof ICONS, name: string, key: string, tip: () => string, fire: () => void) {
    const el = h(
      'button',
      { type: 'button', class: 'tool', 'data-tool': id, 'aria-label': name },
      key ? h('span', { class: 'key', 'aria-hidden': 'true' }, key) : null,
      h('span', { html: ICONS[icon], style: 'display:contents' }),
      h('span', { class: 't' }, name),
    );
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', fire);
    el.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse') this.showTip(tip());
    });
    el.addEventListener('pointerleave', () => this.tip.classList.remove('show'));
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) this.showTip(tip());
    });
    el.addEventListener('blur', () => this.tip.classList.remove('show'));
    this.toolbar.append(el);
    return el;
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
      el?.setAttribute('aria-label', d.name());
    }
    const named: [string, string][] = [
      ['star', tr('Estrella', 'Star')],
      ['works', tr('Proyectos', 'Projects')],
      ['chronicle', tr('Crónica', 'Chronicle')],
    ];
    for (const [id, name] of named) {
      const el = this.toolbar.querySelector(`[data-tool="${id}"]`);
      const t = el?.querySelector('.t');
      if (t) t.textContent = name;
      el?.setAttribute('aria-label', name);
    }
    this.decisionKey = '';
    const lbl = this.root.querySelector('.energy .lbl');
    if (lbl) lbl.textContent = tr('Luz estelar', 'Starlight');
    this.settleBtn.textContent = tr('Asentar el sistema', 'Settle the system');
    if (this.banner) this.banner.remove();
    this.banner = null;
  }

  setActiveTool(id: string | null) {
    for (const [k, el] of this.toolEls) el.classList.toggle('active', k === id);
  }

  setActionState(state: Record<string, { ok: boolean; afford: boolean; cost?: number }>) {
    for (const [k, el] of this.toolEls) {
      const st = state[k];
      if (!st) continue;
      el.classList.toggle('disabled', !st.afford);
      el.setAttribute('aria-disabled', String(!st.afford));
      const c = el.querySelector('.cost') as HTMLElement | null;
      if (c) {
        c.classList.toggle('short', !st.afford);
        // Deep faith makes the star's actions cheaper.
        const txt = st.cost ? `☀ ${st.cost}` : c.textContent;
        if (txt && c.textContent !== txt) c.textContent = txt;
        const label = `${el.querySelector('.t')?.textContent ?? ''} · ${txt}`;
        if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
      }
    }
  }

  setSpeed(v: number) {
    for (const b of this.speedBtns) {
      b.classList.toggle('on', Number(b.dataset.v) === v);
      b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v));
    }
  }

  update(
    s: GameState,
    info: {
      progress?: number;
      gas?: number;
      canSettle?: boolean;
      energyRate: number;
      energyCap?: number;
      living?: number;
      topStage?: number;
      reached?: number;
      total?: number;
      late?: LateInfo | null;
      faith?: FaithInfo | null;
    },
    dt: number,
  ) {
    if (this.tipTimer > 0) {
      this.tipTimer -= dt;
      if (this.tipTimer <= 0) this.tip.classList.remove('show');
    }
    // The bar changes width as tools come and go (Projects appears in the late game).
    this.layoutT -= dt;
    if (this.layoutT <= 0) {
      this.layoutT = 0.5;
      this.layoutNews();
    }
    this.name.textContent = s.name;
    const phase = s.phase === 'formation' ? tr('FORMACIÓN', 'FORMATION') : tr('SISTEMA', 'SYSTEM');
    // The calendar ticks a couple of times per second, in round steps, so the slab never jitters.
    this.ageT -= dt;
    if (this.ageT <= 0) {
      this.ageT = 0.6;
      let ageTxt = fmtAge(s.age);
      let ageTip = tr('Edad del sistema', 'Age of the system');
      if (s.civStart != null && s.peoples?.length) {
        const years = Math.floor(((s.age - s.civStart) * 1e6) / 50) * 50;
        ageTxt = tr(`Año ${int(years)}`, `Year ${int(years)}`);
        ageTip = tr(`Años desde las primeras ciudades del sistema.<br>Edad del sistema: ${fmtAge(s.age)}`, `Years since the first cities of the system.<br>Age of the system: ${fmtAge(s.age)}`);
      }
      const html = `<span class="phase-chip">${phase}</span><span class="age-txt" data-tip="${ageTip}">${ageTxt}</span>`;
      if (this.subHtml !== html) this.sub.innerHTML = this.subHtml = html;
    }
    const e = Math.floor(s.energy);
    this.energyVal.textContent = `${e}`;
    (this.energyBar.firstChild as HTMLElement).style.setProperty('--v', `${(s.energy / (info.energyCap ?? 100)) * 100}%`);
    this.energyBar.dataset.tip = tr(`<b>Luz estelar</b><br>Se recarga sola: +${num(info.energyRate, 1)} por segundo. La gastan tus acciones.`, `<b>Starlight</b><br>It refills on its own: +${num(info.energyRate, 1)} per second. Your actions spend it.`);
    // Faith: how many believe in the star, out of love or out of fear.
    const f = s.phase === 'system' ? info.faith : null;
    let fh = '';
    if (f && f.believers > 0.5) {
      const tierName = f.tier ? pick(f.tierName) : tr('sin bendiciones', 'no blessings yet');
      const why = f.moral.length
        ? `<br><br><b>${tr('Últimos motivos', 'Latest reasons')}</b><br>${[...f.moral]
            .reverse()
            .map((m) => `<span style="color:${m.sign > 0 ? '#b8e08a' : '#ff8a6a'}">${m.sign > 0 ? '+' : '−'}</span> ${tr(m.es, m.en)}`)
            .join('<br>')}`
        : '';
      const fear = f.dread > 0.05 ? ` · <span class="ember">☠ ${Math.round(f.dread * 100)} %</span>` : '';
      const tip = tr(
        `<b>Fe en la estrella</b><br>Creyentes: ${f.believersTxt.es}${f.dread > 0.05 ? ` · ${Math.round(f.dread * 100)} % por miedo` : ''}.<br>Nivel: <b>${tierName}</b>${f.gift ? ` · ${f.gift.es}` : ''}<br>Sube al salvarlos (llamaradas contra asteroides e invasores), bendecirlos, proteger a los nativos, imponer treguas y escuchar sus plegarias. La crueldad la vuelve miedo.${f.order ? '<br><b>La Orden de la Estrella</b> existe: ábrela en Proyectos.' : ''}`,
        `<b>Faith in the star</b><br>Believers: ${f.believersTxt.en}${f.dread > 0.05 ? ` · ${Math.round(f.dread * 100)}% out of fear` : ''}.<br>Tier: <b>${tierName}</b>${f.gift ? ` · ${f.gift.en}` : ''}<br>It rises when you save them (flares against asteroids and invaders), bless them, shelter natives, force truces and hear their prayers. Cruelty turns it into fear.${f.order ? '<br><b>The Order of the Star</b> exists: open it in Projects.' : ''}`,
      );
      fh = `<span data-tip="${(tip + why).replace(/"/g, '&quot;')}"><i>❂</i> ${tr(f.believersTxt.es, f.believersTxt.en)} · <b>${tierName}</b>${fear}</span>`;
    }
    if (fh !== this.faithHtml) {
      this.faithEl.innerHTML = this.faithHtml = fh;
      this.faithEl.style.display = fh ? '' : 'none';
    }
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
      const peoples = !!s.peoples?.length;
      this.progLabel.innerHTML = `<span>${lifeTxt}</span><b>${ark ? tr('El arca se prepara', 'The ark is getting ready') : peoples ? tr(`${reached} de ${total} mundos habitados`, `${reached} of ${total} worlds settled`) : tr(`${info.living ?? 0} mundos con vida`, `${info.living ?? 0} living worlds`)}</b>`;
      const v = ark ? Math.min(1, s.arkTimer / 60) : peoples ? reached / Math.max(1, total) : Math.min(1, (top + 1) / 6);
      (this.progBar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round(v * 100)}%`);
      this.progBar.className = ark ? 'vessel gold' : 'vessel moss';
      this.row2.style.display = 'none';
      const late = info.late;
      if (late) {
        // The late game: the era, the great work under way, and how far the peoples have spread.
        this.progLabel.innerHTML = `<span>${late.era}</span><b>${late.label}</b>`;
        (this.progBar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round(late.v * 100)}%`);
        this.progBar.className = 'vessel gold';
        this.row2.innerHTML = `<span>${tr('Mundos habitados', 'Worlds settled')}</span><div class="vessel thin moss"><i style="--v:${Math.round((reached / Math.max(1, total)) * 100)}%"></i></div><span>${reached}/${total}</span>`;
        this.row2.style.display = '';
      }
    }
    // From the warp drive on, the top slab tells what the star ark still needs.
    const ark = s.phase === 'system' ? info.late?.ark : undefined;
    const arkTip = ark ? `<b>${tr('Arca estelar', 'Star ark')}</b><br>${ark.map((n) => `${n.ok ? '✓' : '·'} ${tr(n.es, n.en)}`).join('<br>')}` : '';
    if ((this.progSlab.dataset.tip ?? '') !== arkTip) {
      if (arkTip) this.progSlab.dataset.tip = arkTip;
      else delete this.progSlab.dataset.tip;
    }
    // Resources of the civilization.
    const late = s.phase === 'system' ? info.late : null;
    this.resEl.style.display = late ? '' : 'none';
    this.root.parentElement?.classList.toggle('late', !!late);
    if (late) {
      const L = late.threat;
      const d = late.def;
      const built = [d.fleet, d.shield, d.patrol].filter((n) => n > 0);
      const worst = built.length ? Math.min(...built) : 0;
      const state = !built.length ? (L >= 3 ? 'warn' : 'ok') : worst >= L ? 'ok' : worst === L - 1 ? 'warn' : 'bad';
      const lv = (n: number) => (n ? String(n) : '—');
      const tip = tr(
        `<b>Amenaza: nivel ${L}</b><br>Crece con el poder de tu sistema: las invasiones llegan antes y con más naves.<br>Botín a la vista: <b>${int(late.allure)}</b> · cada mundo habitado y cada recurso acumulado agrandan las oleadas (y atraen saqueadores).<br>Defensas · flota ${lv(d.fleet)} · escudos ${lv(d.shield)} · Space Patrols ${lv(d.patrol)}<br><i>Toca para mejorarlas en Proyectos.</i>`,
        `<b>Threat: level ${L}</b><br>It grows with your system's power: invasions come sooner and with more ships.<br>Loot in sight: <b>${int(late.allure)}</b> · every settled world and every stored resource makes the waves bigger (and draws looters).<br>Defences · fleet ${lv(d.fleet)} · shields ${lv(d.shield)} · Space Patrols ${lv(d.patrol)}<br><i>Tap to raise them in Projects.</i>`,
      );
      if (!this.resPills) {
        this.resPills = [];
        for (const k of RES_KEYS) {
          const n = h('b');
          const el = h('span', { class: `res ${k}` }, h('i', null, RES_ICON[k]), n);
          this.resEl.append(el);
          this.resPills.push({ k, el, n });
        }
        const n = h('b');
        const label = h('small');
        const el = h('span', { class: 'res threat' }, h('i', null, '⚠'), label, n);
        this.resEl.append(el);
        this.resPills.push({ k: 'threat', el, n, label });
      }
      const set = (el: HTMLElement, key: 'textContent' | 'className', v: string) => {
        if (el[key] !== v) el[key] = v;
      };
      const tipOf = (el: HTMLElement, v: string) => {
        if (el.dataset.tip !== v) el.dataset.tip = v;
      };
      for (const p of this.resPills) {
        if (p.k === 'threat') {
          set(p.el, 'className', `res threat ${state}`);
          // Only when it matters does the pill spell out what it is.
          set(p.label!, 'textContent', state === 'ok' ? '' : tr('Amenaza', 'Threat'));
          set(p.n, 'textContent', String(L));
          tipOf(p.el, tip);
        } else {
          const k = p.k as keyof Resources;
          set(p.n, 'textContent', int(late.res[k]));
          tipOf(p.el, `+${num(late.rates[k], 1)}/s`);
        }
      }
    }
    if (this.worksEl) {
      this.worksEl.style.display = late ? '' : 'none';
      this.worksEl.classList.toggle('ready', !!late?.canBuild);
    }
    // Hints rotate one at a time.
    if (this.hintEl) {
      if (!this.hintHold) this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.closeHint();
    } else if (this.hintQueue.length) this.openHint();
  }

  // ------------------------------------------------------------------ news
  pushNews(n: NewsItem, ageText: string) {
    const el = this.newsItem(n, ageText);
    el.addEventListener('click', () => this.on.news(n));
    this.newsEl.prepend(el);
    while (this.newsEl.children.length > 3) this.newsEl.lastElementChild?.remove();
    const life = n.kind === 'fact' || n.kind === 'voice' ? 16000 : 11000;
    setTimeout(() => el.classList.add('fade'), life);
    setTimeout(() => el.remove(), life + 1300);
  }

  newsItem(n: NewsItem, ageText: string) {
    const el = stone(`news-item ${n.kind}${n.focus ? ' has-focus' : ''}`, h('span', { class: 'ic' }, n.icon), h('div', null, h('span', { class: 'age' }, ageText), pick(n)));
    if (n.focus) el.append(h('span', { class: 'go', 'data-tip': tr('Ir a verlo', 'Go and see') }, '◎'));
    return el;
  }

  clearNews() {
    clear(this.newsEl);
  }

  // ------------------------------------------------------------------ decisions
  showDecisions(list: DecisionView[]) {
    // Urgent ones first (lives at stake), newest first within each group. The first is shown in full,
    // the others fold into a line, and no more than three are shown unless the player asks.
    list = [...list].reverse().sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
    if (list.length <= MAX_DECISIONS) this.decisionsOpen = false;
    const shown = this.decisionsOpen ? list : list.slice(0, MAX_DECISIONS);
    const hidden = list.length - shown.length;
    const key = `${hidden}|` + shown.map((d) => `${d.id}:${d.yesOk}:${d.body}:${(d.options ?? []).map((o) => `${o.ok}${o.tip ?? ''}`).join('')}`).join(',');
    if (key !== this.decisionKey) {
      this.decisionKey = key;
      clear(this.decisionsEl);
      shown.forEach((d, i) => {
        const card = stone(
          `decision veined ${i > 0 ? 'compact' : ''}${d.urgent ? ' urgent' : ''}`,
          h('div', { class: 'd-head' }, h('span', { class: 'glyph' }, d.icon), h('b', null, d.title)),
          h('div', { class: 'd-body', html: d.body }),
          h(
            'div',
            { class: 'd-buttons' },
            h('button', { class: 'btn small', onclick: () => this.on.decide(d.id, false) }, d.no),
            ...(d.options
              ? d.options.map((o) => {
                  const b = h('button', { class: `btn small ${o.primary ? 'primary' : ''}`, disabled: !o.ok, onclick: () => this.on.decide(d.id, true, o.choice), html: o.label });
                  // Disabled buttons take no pointer: the reason lives on a wrapper.
                  return o.tip ? h('span', { class: 'bw', 'data-tip': o.tip }, b) : b;
                })
              : [h('button', { class: 'btn small primary', disabled: !d.yesOk, onclick: () => this.on.decide(d.id, true) }, d.yes)]),
          ),
          h('div', { class: 'vessel thin gold d-timer', 'data-tip': tr(`Si no decides: «${d.no}»`, `If you do not decide: “${d.no}”`) }, h('i')),
        );
        if (d.urgent) card.append(h('div', { class: 'seam top' }));
        card.dataset.id = String(d.id);
        this.decisionsEl.append(card);
      });
      if (hidden > 0)
        this.decisionsEl.append(
          h(
            'button',
            {
              class: 'btn small d-more',
              onclick: () => {
                this.decisionsOpen = true;
                this.decisionKey = '';
              },
            },
            tr(`+${hidden} ${hidden === 1 ? 'decisión más' : 'decisiones más'}`, `+${hidden} more ${hidden === 1 ? 'decision' : 'decisions'}`),
          ),
        );
    }
    for (const d of shown) {
      const bar = this.decisionsEl.querySelector(`[data-id="${d.id}"] .d-timer`) as HTMLElement | null;
      if (!bar) continue;
      const v = Math.max(0, d.left / d.dur);
      (bar.firstChild as HTMLElement).style.setProperty('--v', `${v * 100}%`);
      // The last quarter of the time burns.
      bar.classList.toggle('low', v < 0.25);
    }
  }

  // ------------------------------------------------------------------ hints
  /**
   * Queues a hint. The most urgent one is shown first (2 urgent · 1 how things work · 0 a tip),
   * the oldest among equals; `onShow` runs when it actually appears.
   */
  hint(id: string, glyph: string, html: () => string, prio = 1, onShow?: () => void) {
    if (this.hintQueue.some((q) => q.id === id) || this.hintEl?.dataset.id === id) return;
    this.hintQueue.push({ id, glyph, html, prio, onShow });
  }

  private openHint() {
    let i = 0;
    for (let k = 1; k < this.hintQueue.length; k++) if (this.hintQueue[k].prio > this.hintQueue[i].prio) i = k;
    const q = this.hintQueue.splice(i, 1)[0];
    q.onShow?.();
    this.hintTimer = q.prio >= 2 ? 18 : 14;
    // A thread of moss along the bottom shows how long it stays; it waits while the pointer rests on it.
    const el = stone(
      'hint',
      h('span', { class: 'glyph' }, q.glyph),
      h('div', { html: q.html() }),
      h('button', { class: 'x', title: tr('Entendido', 'Got it'), 'aria-label': tr('Entendido', 'Got it'), onclick: () => this.closeHint() }, '✕'),
      h('i', { class: 'life', style: `--life:${this.hintTimer}s` }),
    );
    el.setAttribute('role', 'status');
    el.dataset.id = q.id;
    el.addEventListener('pointerenter', () => (this.hintHold = true));
    el.addEventListener('pointerleave', () => (this.hintHold = false));
    this.hintHold = false;
    this.hintEl = el;
    this.root.append(el);
  }

  closeHint() {
    if (!this.hintEl) return;
    const el = this.hintEl;
    this.hintEl = null;
    this.hintHold = false;
    el.style.transition = 'opacity .5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  }

  clearHints() {
    this.hintQueue = [];
    this.hintEl?.remove();
    this.hintEl = null;
  }

  // ------------------------------------------------------------------ milestones
  private msEl: HTMLElement | null = null;
  private msTimers: number[] = [];

  /**
   * A milestone carved for a moment above the tool bar: an obsidian slab with two lava seams, a
   * glyph that lights up, a small heading and a name. A new one replaces the one on screen.
   */
  milestone(icon: string, kicker: string, title: string) {
    this.msEl?.remove();
    for (const id of this.msTimers) clearTimeout(id);
    const el = stone(
      'obsidian milestone',
      h('div', { class: 'seam top' }),
      h('span', { class: 'ms-ico', 'aria-hidden': 'true' }, icon),
      h('div', null, h('b', null, kicker), h('strong', null, title)),
      h('div', { class: 'seam bottom' }),
    );
    el.setAttribute('role', 'status');
    this.msEl = el;
    this.root.append(el);
    this.msTimers = [
      window.setTimeout(() => el.classList.add('out'), 3600),
      window.setTimeout(() => {
        el.remove();
        if (this.msEl === el) this.msEl = null;
      }, 4400),
    ];
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
