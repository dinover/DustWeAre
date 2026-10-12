import { int, num, pick, tr } from '../i18n';
import type { Resources } from '../core/state';
import { ERA_NAMES, MISSION_COST, PROJECTS, TECHS, researchCost, type ProjectDef, type ProjectId } from '../content/projects';
import { RES_ICON, RES_KEYS, UPFRONT, type CivSim } from '../sim/civ';
import { FORT_MAX, STAR_INCOME, companiesFor, fortCost, fortRepel, strikeCost, strikeRisk, troubleRisk, type PatrolSim } from '../sim/patrols';
import { BUY_SHIPS, WINGS_TECH, WING_COST, WING_SIZES, WING_UNITS, buyCost, type WingsSim } from '../sim/wings';
import { patrolTip, riskText, wingForecast } from './decisions';
import type { WingSize } from '../core/state';
import { DEFENCES, MAX_LEVEL, TECH_POWER, WORK_POWER, defLevel, fleetCatch, lanceSpeed, levelFor, nextAt, podsPerWave, shieldStop, threatOf, upgradeCost, type DefenceId } from '../sim/threat';
import { clamp } from '../util';
import { DIG_COST, DIG_TIME, FAITH_TIERS, FORGE_COST, RELICS, RELICS_NEEDED, STUDY_COST, dreadOf, faithOf, popOf, type FaithSim } from '../sim/faith';
import { fmtPop } from './text';
import { h, stone, clear } from './dom';

export const resName = (k: keyof Resources) =>
  ({ metal: tr('metal', 'metal'), fuel: tr('combustible', 'fuel'), water: tr('agua', 'water'), science: tr('ciencia', 'science') })[k];

/** Cost chips: each resource with its icon, red when there is not enough. */
export function costChips(cost: Partial<Resources>, have: Resources | null) {
  return RES_KEYS.filter((k) => cost[k])
    .map((k) => `<span class="cost-chip ${k} ${have && have[k] < (cost[k] ?? 0) ? 'short' : ''}" data-tip="${resName(k)}">${RES_ICON[k]} ${int(cost[k] ?? 0)}</span>`)
    .join('');
}

/** The tabs of the Projects window. */
export type ProjTab = 'works' | 'def' | 'beyond' | 'faith';
const TABS: ProjTab[] = ['works', 'def', 'beyond', 'faith'];
const TAB_KEY = 'dwa.projTab';
/** The last tab opened (it survives closing the window, and reloading the page). */
let lastTab: ProjTab = (() => {
  try {
    const v = localStorage.getItem(TAB_KEY) as ProjTab | null;
    return v && TABS.includes(v) ? v : 'works';
  } catch {
    return 'works';
  }
})();

interface CardRefs {
  def: ProjectDef;
  el: HTMLElement;
  /** How much threat it would add. */
  warn: HTMLElement;
  /** Everything it needs, ticked (the star ark). */
  checks: HTMLElement | null;
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
  private research: { btn: HTMLButtonElement; note: HTMLElement; cost: HTMLElement; title: HTMLElement; bar: HTMLElement; warn: HTMLElement } | null = null;
  private closeFn: () => void = () => {};
  private beyond = h('div', { class: 'beyond' });
  private beyondHtml = '';
  private defences = h('div', { class: 'defences' });
  private defHtml = '';
  private faithBox = h('div', { class: 'faith-box' });
  private faithHtml = '';
  private tabBar = h('div', { class: 'proj-tabs', role: 'tablist' });
  private tabs = {} as Record<ProjTab, { btn: HTMLButtonElement; dot: HTMLElement; pane: HTMLElement }>;
  private tab: ProjTab = lastTab;

  constructor(
    private civ: CivSim,
    private on: {
      start(id: ProjectId): void;
      expedition(): void;
      armada(): void;
      research(): void;
      close(): void;
      send(id: number, conquer: boolean): void;
      release(id: number): void;
      rename(id: number): void;
      fortify(id: number): void;
      upgrade(id: DefenceId): void;
      wing(id: number, size: WingSize): void;
      unlockWings(): void;
      buyWings(): void;
      study(): void;
      dig(id: number): void;
      forge(): void;
    },
    private patrols?: PatrolSim,
    private wings?: WingsSim,
    private faith?: FaithSim,
    tab?: ProjTab,
  ) {
    this.el = h('div', { class: 'projects' });
    if (tab) this.tab = tab;
    this.build();
  }

  /** Shows one tab (and remembers it for the next time). */
  show(tab: ProjTab) {
    this.tab = lastTab = tab;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* private mode: remembered for this session only */
    }
    for (const id of TABS) {
      const on = id === tab;
      this.tabs[id].btn.classList.toggle('on', on);
      this.tabs[id].btn.setAttribute('aria-selected', String(on));
      this.tabs[id].pane.style.display = on ? '' : 'none';
    }
  }

  bindClose(fn: () => void) {
    this.closeFn = fn;
  }

  private build() {
    clear(this.el);
    this.el.append(this.res, this.tabBar);
    const names: Record<ProjTab, string> = {
      works: tr('Obras', 'Works'),
      def: tr('Defensa', 'Defence'),
      beyond: tr('Más allá', 'Beyond'),
      faith: tr('La fe', 'Faith'),
    };
    for (const id of TABS) {
      const dot = h('span', { class: 'tab-dot' }, '●');
      const btn = h('button', { class: 'proj-tab', role: 'tab', onclick: () => this.show(id) }, names[id], dot) as HTMLButtonElement;
      const pane = h('div', { class: `proj-pane pane-${id}`, role: 'tabpanel' });
      this.tabBar.append(btn);
      this.el.append(pane);
      this.tabs[id] = { btn, dot, pane };
    }
    const P = this.tabs;
    // The threat and the defences that answer it.
    P.def.pane.append(h('h3', { class: 'proj-era' }, tr('Amenaza y defensas', 'Threat and defences')), this.defences);
    this.defences.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-def]') as HTMLButtonElement | null;
      if (b && !b.disabled) this.on.upgrade(b.dataset.def as DefenceId);
    });
    for (const era of [1, 2, 3] as const) {
      const grid = h('div', { class: 'proj-grid' });
      P.works.pane.append(h('h3', { class: 'proj-era' }, pick(ERA_NAMES[era])), grid);
      for (const def of PROJECTS.filter((p) => p.era === era)) {
        const cost = h('div', { class: 'costs' });
        const note = h('div', { class: 'note small' });
        const warn = h('div', { class: 'small threat-note' });
        const checks = def.id === 'ark' ? h('ul', { class: 'checks ark-checks' }) : null;
        const bar = h('div', { class: 'vessel thin gold' }, h('i'));
        const btn = h('button', { class: 'btn small primary', onclick: () => this.on.start(def.id) }, tr('Construir', 'Build')) as HTMLButtonElement;
        const el = h(
          'div',
          { class: 'proj' },
          h('div', { class: 'proj-head' }, h('span', { class: 'proj-ico' }, def.icon), h('b', null, pick(def.name))),
          h('div', { class: 'small muted' }, pick(def.desc)),
          h('div', { class: 'small gold', style: 'margin-top:4px' }, pick(def.effect)),
          checks,
          warn,
          cost,
          note,
          bar,
          btn,
        );
        grid.append(el);
        this.cards.push({ def, el, warn, checks, cost, btn, note, bar });
      }
    }
    // Missions beyond the system, and research that never ends.
    const grid = h('div', { class: 'proj-grid' });
    {
      const cost = h('div', { class: 'costs' });
      const note = h('div', { class: 'note small' });
      const title = h('b');
      const warn = h('div', { class: 'small threat-note' });
      const bar = h('div', { class: 'vessel thin moss' }, h('i'));
      const btn = h('button', { class: 'btn small primary', onclick: () => this.on.research() }, tr('Investigar', 'Research')) as HTMLButtonElement;
      grid.append(
        h(
          'div',
          { class: 'proj mission research' },
          h('div', { class: 'proj-head' }, h('span', { class: 'proj-ico' }, '⚗'), title),
          h('div', { class: 'small muted' }, tr('Cada tecnología nueva hace que todo el sistema produzca un 10 % más.', 'Each new technology makes the whole system produce 10% more.')),
          warn,
          cost,
          note,
          bar,
          btn,
        ),
      );
      this.research = { btn, note, cost, title, bar, warn };
    }
    P.works.pane.append(h('h3', { class: 'proj-era' }, tr('Misiones', 'Missions')), grid);
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
    // Faith: the Order of the Star, its reading of the heavens, the Precursors' relics and the forge.
    P.faith.pane.append(h('h3', { class: 'proj-era' }, tr('La fe', 'Faith')), this.faithBox);
    this.faithBox.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-faith]') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      if (b.dataset.faith === 'study') this.on.study();
      else if (b.dataset.faith === 'dig') this.on.dig(Number(b.dataset.id));
      else if (b.dataset.faith === 'forge') this.on.forge();
    });
    P.beyond.pane.append(h('h3', { class: 'proj-era' }, tr('Más allá del sistema', 'Beyond the system')), this.beyond);
    this.beyond.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-act]') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      const id = Number(b.dataset.id);
      if (b.dataset.act === 'rename') this.on.rename(id);
      else if (b.dataset.act === 'release') this.on.release(id);
      else if (b.dataset.act === 'fortify') this.on.fortify(id);
      else if (b.dataset.act === 'wing') this.on.wing(id, b.dataset.size as WingSize);
      else if (b.dataset.act === 'wings-unlock') this.on.unlockWings();
      else if (b.dataset.act === 'wings-buy') this.on.buyWings();
      else this.on.send(id, b.dataset.act === 'conquer');
    });
    this.show(this.tab);
    this.refresh();
  }

  /** Which tabs exist yet, and which carry something urgent (●). */
  private tabsState() {
    const s = this.civ.state;
    const civ = s.civ;
    const F = this.faith;
    const f = s.faith;
    const stars = this.patrols?.stars ?? [];
    const L = threatOf(s);
    const open: Record<ProjTab, boolean> = {
      works: true,
      def: true,
      // From the warp drive on, or once there are Patrols or distant colonies.
      beyond: !!civ?.done.warp || !!s.patrol || stars.length > 0,
      // As soon as any people has existed.
      faith: (s.peoples?.length ?? 0) > 0,
    };
    const urgent: Record<ProjTab, boolean> = {
      works: false,
      // A defence that exists, lags behind the threat and can be raised right now.
      def: DEFENCES.some((id) => {
        const n = defLevel(s, id);
        return n > 0 && n < L && !this.civ.defenceLock(id);
      }),
      // A distant colony in trouble that nobody is helping.
      beyond: stars.some((st) => !!st.trouble && !st.strike && !st.wing),
      // A dig or the forge that can start right now.
      faith: !!F && !!f && (f.sites.some((x) => !F.digLock(x.world)) || !F.forgeLock()),
    };
    return { open, urgent };
  }

  /** "⚠ +1,5 de poder de amenaza (sube la amenaza a nivel 4)". */
  private threatNote(add: number) {
    const s = this.civ.state;
    const L = threatOf(s);
    const after = levelFor((s.threat?.power ?? 0) + add);
    const n = num(add, 1);
    return after > L ? tr(`⚠ +${n} de poder de amenaza (sube la amenaza a nivel ${after})`, `⚠ +${n} threat power (raises the threat to level ${after})`) : tr(`⚠ +${n} de poder de amenaza`, `⚠ +${n} threat power`);
  }

  /** The threat level, and one card per defence with its level and what the next one costs. */
  private defencesView() {
    const s = this.civ.state;
    const civ = s.civ;
    if (!civ) return '';
    const L = threatOf(s);
    const power = s.threat?.power ?? 0;
    const prev = nextAt(L - 1);
    const v = L >= MAX_LEVEL ? 1 : clamp((power - prev) / (nextAt(L) - prev));
    let html = `<div class="threat-banner"><span class="tb-ico">⚠</span><div class="tb-text"><b>${tr(`Amenaza: nivel ${L}`, `Threat: level ${L}`)}</b><div class="small muted">${tr(
      'Crece con el poder del sistema: mundos habitados, grandes obras, tecnologías y colonias lejanas (los dominios cuentan más). Cuanto más alta, antes llegan las invasiones, con más naves y naves nodriza más duras, y más problemas tienen las colonias lejanas. Además, cada mundo habitado y cada recurso acumulado agrandan las oleadas: las reservas grandes atraen saqueadores, y con la amenaza alta llegan bombarderos que queman ciudades.',
      'It grows with the power of the system: settled worlds, great works, technologies and distant colonies (dominions count more). The higher it is, the sooner invasions come, with more ships and tougher motherships, and the more trouble the distant colonies get into. Every settled world and every stored resource also makes the waves bigger: large stores draw looters, and with a high threat come bombers that burn cities.',
    )}</div><div class="vessel thin ember" data-tip="${L >= MAX_LEVEL ? tr('Nivel máximo', 'Maximum level') : tr(`Poder ${Math.floor(power)} · el nivel ${L + 1} llega con ${nextAt(L)}`, `Power ${Math.floor(power)} · level ${L + 1} arrives at ${nextAt(L)}`)}"><i style="--v:${Math.round(v * 100)}%"></i></div></div></div><div class="proj-grid def-grid">`;
    const P = defLevel(s, 'patrol');
    const info: Record<DefenceId, { icon: string; name: string; effect: (n: number) => string }> = {
      fleet: {
        icon: '⟁',
        name: tr('Flota de defensa', 'Defence fleet'),
        effect: (n) => tr(`Intercepta cerca del ${Math.round(fleetCatch(n, L) * 100)} % de las naves invasoras antes de que lleguen.`, `Intercepts about ${Math.round(fleetCatch(n, L) * 100)}% of invading ships before they arrive.`),
      },
      shield: {
        icon: '⛨',
        name: tr('Escudos planetarios', 'Planetary shields'),
        effect: (n) => tr(`Detienen el ${Math.round(shieldStop(n, L) * 100)} % de los asteroides y frenan a los invasores que bajan a mundos habitados.`, `Stop ${Math.round(shieldStop(n, L) * 100)}% of asteroids and slow down invaders landing on settled worlds.`),
      },
      patrol: {
        icon: '⛨',
        name: 'Space Patrols',
        effect: (n) => {
          const pods = podsPerWave(n);
          return tr(
            `${n} ${n === 1 ? 'compañía' : 'compañías'}, una barcaza de batalla cada una: pueden defender varias estrellas a la vez (1 compañía por riesgo bajo o medio, 2 por riesgo alto) y siempre vencen, aunque con amenaza alta pueden volver con bajas. Las que quedan en casa lanzan ${pods} cápsulas por oleada y su lanza dispara ×${lanceSpeed(n).toFixed(1).replace('.', ',')}.`,
            `${n} ${n === 1 ? 'company' : 'companies'}, one battle barge each: they can defend several stars at once (1 company for a low or medium risk, 2 for a high risk) and always win, though with a high threat they may come back with losses. Those at home drop ${pods} pods per wave and their lance fires ×${lanceSpeed(n).toFixed(1)}.`,
          );
        },
      },
    };
    for (const id of DEFENCES) {
      const d = info[id];
      const n = defLevel(s, id);
      const lock = this.civ.defenceLock(id);
      const state = !n ? 'none' : n >= L ? 'even' : n === L - 1 ? 'near' : 'behind';
      let pips = '';
      for (let i = 1; i <= MAX_LEVEL; i++) pips += `<i class="${i <= n ? 'on' : i <= L ? 'need' : ''}"></i>`;
      const cost = n && n < MAX_LEVEL ? costChips(upgradeCost(id, n), civ.res) : '';
      const label = !n ? tr('Mejorar', 'Upgrade') : n >= MAX_LEVEL ? tr('Nivel máximo', 'Maximum level') : tr(`Mejorar → nivel ${n + 1}`, `Upgrade → level ${n + 1}`);
      const status = !n
        ? tr('No existe todavía.', 'It does not exist yet.')
        : n >= L
          ? tr('A la altura de la amenaza.', 'A match for the threat.')
          : tr(`Por debajo de la amenaza (${n} de ${L}).`, `Below the threat (${n} of ${L}).`);
      html += `<div class="proj def ${state}"><div class="proj-head"><span class="proj-ico${id === 'patrol' ? ' pt' : ''}">${d.icon}</span><b>${d.name}</b><span class="def-lvl">${n ? tr(`Nivel ${n}`, `Level ${n}`) : '—'}</span></div>
        <div class="pips" data-tip="${tr(`Nivel ${n} de ${MAX_LEVEL} · amenaza ${L}`, `Level ${n} of ${MAX_LEVEL} · threat ${L}`)}">${pips}</div>
        <div class="small ${n ? 'gold' : 'muted'}">${n ? d.effect(n) : pick(lock ?? { es: '', en: '' })}</div>
        <div class="small def-status">${status}</div>
        ${n && n < MAX_LEVEL ? `<div class="costs">${cost}</div>` : ''}
        ${n && lock && n < MAX_LEVEL ? `<div class="note small">${pick(lock)}</div>` : ''}
        ${id === 'patrol' && !P ? '' : `<button class="btn small primary" data-def="${id}"${lock ? ' disabled' : ''}>${label}</button>`}</div>`;
    }
    return html + '</div>';
  }

  /** Faith in the star: who believes, the Order, the reading of the heavens, the digs, the relics and the forge. */
  private faithView() {
    const F = this.faith;
    const s = this.civ.state;
    const f = s.faith;
    const res = s.civ?.res ?? null;
    if (!F || !f) return `<div class="small muted" style="margin:8px 2px">${tr('Todavía no hay pueblos que puedan creer en la estrella.', 'There are no peoples yet who could believe in the star.')}</div>`;
    const dread = dreadOf(s);
    const tier = f.tier;
    let pips = '';
    for (let i = 1; i <= FAITH_TIERS.length; i++) pips += `<i class="${i <= tier ? 'on' : ''}" data-tip="${tr(`<b>${FAITH_TIERS[i - 1].name.es}</b><br>${FAITH_TIERS[i - 1].gift.es}<br>Cuando el ${Math.round(FAITH_TIERS[i - 1].share * 100)} % de todos cree por amor.`, `<b>${FAITH_TIERS[i - 1].name.en}</b><br>${FAITH_TIERS[i - 1].gift.en}<br>When ${Math.round(FAITH_TIERS[i - 1].share * 100)}% of everyone believes out of love.`).replace(/"/g, '&quot;')}"></i>`;
    const now = tier ? FAITH_TIERS[tier - 1] : null;
    let html = `<div class="patrol-card faith-card"><div class="proj-head"><span class="proj-ico fa">❂</span><b>${tr('Fe en la estrella', 'Faith in the star')}</b><span class="def-lvl">${now ? pick(now.name) : tr('sin dones', 'no gifts yet')}</span></div>
      <div class="pips faith-pips">${pips}</div>
      <div class="small">${tr(`Creyentes: <b>${fmtPop(f.believers)}</b> · por amor: <b>${fmtPop(f.devout)}</b>`, `Believers: <b>${fmtPop(f.believers)}</b> · out of love: <b>${fmtPop(f.devout)}</b>`)}${dread > 0.05 ? ` · <span class="ember">${tr(`${Math.round(dread * 100)} % por miedo`, `${Math.round(dread * 100)}% out of fear`)}</span>` : ''}</div>
      ${now ? `<div class="small gold">${pick(now.gift)}</div>` : ''}
      <div class="small muted">${tr(
        'Crece cuando los salvas (llamaradas contra asteroides e invasores), los bendices, proteges a los nativos, impones treguas y escuchas sus plegarias. La crueldad no la borra: la vuelve miedo, que solo aviva tu luz.',
        'It grows when you save them (flares against asteroids and invaders), bless them, shelter natives, force truces and hear their prayers. Cruelty does not erase it: it turns it into fear, which only feeds your light.',
      )}</div><div class="faith-peoples">`;
    for (const p of (s.peoples ?? []).filter((x) => !x.gone)) {
      const v = faithOf(p);
      const member = !!f.order?.members.includes(p.id);
      html += `<div class="small fp" data-tip="${tr(`Los ${p.name}: ${fmtPop(popOf(s, p))}, fe del ${Math.round(v * 100)} %`, `The ${p.name}: ${fmtPop(popOf(s, p))}, ${Math.round(v * 100)}% faith`)}"><span>${tr('Los', 'The')} ${tr(p.name, p.name.charAt(0).toUpperCase() + p.name.slice(1))}${member ? ' <span class="fa">❂</span>' : ''}</span><div class="vessel thin gold"><i style="--v:${Math.round(v * 100)}%"></i></div><em>${Math.round(v * 100)} %</em></div>`;
    }
    html += '</div></div>';
    // The Order of the Star.
    if (!f.order) {
      const needs = F.orderNeeds();
      html += `<div class="proj order-card"><div class="proj-head"><span class="proj-ico fa">❂</span><b>${tr('La Orden de la Estrella', 'The Order of the Star')}</b></div><div class="small muted">${tr(
        'Cuando muchos crean en la estrella por amor y al menos dos pueblos la veneren juntos, fundarán la Orden: no se harán la guerra entre ellos y buscarán en el cielo lo que la estrella quiere decirles.',
        'When many believe in the star out of love and at least two peoples worship it together, they will found the Order: they will not war on each other and will search the sky for what the star wants to tell them.',
      )}</div><ul class="checks">${needs.map((n) => `<li class="${n.ok ? 'ok' : ''}">${n.ok ? '✓' : '·'} ${tr(n.es, n.en)}</li>`).join('')}</ul>${
        f.formT ? `<div class="vessel thin gold"><i style="--v:${Math.round(Math.min(1, f.formT / 30) * 100)}%"></i></div>` : ''
      }</div>`;
      return html;
    }
    const members = f.order.members.map((id) => s.peoples?.find((p) => p.id === id)?.name ?? '?');
    html += `<div class="proj order-card"><div class="proj-head"><span class="proj-ico fa">❂</span><b>${tr('La Orden de la Estrella', 'The Order of the Star')}</b></div><div class="small">${
      F.silent
        ? `<span class="ember">${tr('La Orden calla: ninguno de sus pueblos cree lo bastante. Su obra está detenida hasta que la fe vuelva.', 'The Order is silent: none of its peoples believes enough. Its work is halted until faith returns.')}</span>`
        : tr(`Sus fieles: los ${members.join(', los ')}. No se harán la guerra entre ellos, y de vez en cuando pedirán una señal.`, `Its faithful: the ${members.join(', the ')}. They will not war on each other, and now and then they will ask for a sign.`)
    }</div></div>`;
    // Reading the heavens.
    const sl = F.studyLock();
    html += `<div class="proj"><div class="proj-head"><span class="proj-ico">✶</span><b>${tr('Lectura de los cielos', 'Reading the heavens')}</b></div><div class="small muted">${tr(
      'Los astrónomos de la Orden buscan en las lunas las huellas de los Precursores, un pueblo desaparecido que también rezaba a esta estrella.',
      'The Order’s astronomers search the moons for traces of the Precursors, a vanished people who also prayed to this star.',
    )}</div>${
      f.read
        ? `<div class="small gold">${tr('Cielos leídos.', 'The heavens have been read.')}</div>`
        : f.study
          ? `<div class="vessel thin moss"><i style="--v:${Math.round((f.study.t / f.study.dur) * 100)}%"></i></div>`
          : `<div class="costs">${costChips(STUDY_COST, res)}</div>${sl ? `<div class="note small">${pick(sl)}</div>` : ''}<button class="btn small primary" data-faith="study"${sl ? ' disabled' : ''}>${tr('Leer los cielos', 'Read the heavens')}</button>`
    }</div>`;
    // The sites.
    if (f.read && f.sites.length) {
      html += `<div class="star-rows">`;
      for (const site of f.sites) {
        const w = s.worlds.find((x) => x.id === site.world);
        if (!w) continue;
        const dig = f.digs.find((d) => d.world === site.world);
        const road = s.ships.some((x) => x.kind === 'pilgrim' && x.to === site.world);
        const state =
          site.state === 'done'
            ? `<span class="gold">${tr('✓ reliquia hallada', '✓ relic found')}</span>`
            : dig
              ? `<span class="fa">${tr('excavando…', 'digging…')}</span>`
              : road
                ? `<span class="fa">${tr('peregrinos en camino', 'pilgrims on the way')}</span>`
                : site.state === 'sure'
                  ? `<span class="wg">${tr('un archivo señala dónde cavar', 'an archive shows where to dig')}</span>`
                  : `<span class="muted">${tr(`por excavar${site.tries ? ` · ${site.tries} ${site.tries === 1 ? 'intento' : 'intentos'}` : ''}`, `to dig${site.tries ? ` · ${site.tries} ${site.tries === 1 ? 'try' : 'tries'}` : ''}`)}</span>`;
        const lock = F.digLock(site.world);
        const btn =
          site.state === 'done' || dig || road
            ? ''
            : `<span class="bw" data-tip="${(lock ? pick(lock) : tr(`Peregrinos de la Orden excavan durante ${DIG_TIME} s: una reliquia, un archivo que señala el camino… o una baliza que despierta a alguien.`, `Pilgrims of the Order dig for ${DIG_TIME}s: a relic, an archive that shows the way… or a beacon that wakes someone up.`)).replace(/"/g, '&quot;')}"><button class="btn small" data-faith="dig" data-id="${site.world}"${lock ? ' disabled' : ''}>◬ ${tr('Excavar', 'Dig')} ${costChips(DIG_COST, res)}</button></span>`;
        html += `<div class="star-row"><div class="sr-head"><i style="background:#ffe1a0;color:#ffe1a0"></i><b>${w.name}</b></div><div class="small">${state}</div>${dig ? `<div class="vessel thin gold"><i style="--v:${Math.round((dig.t / dig.dur) * 100)}%"></i></div>` : ''}${btn ? `<div class="sr-btns">${btn}</div>` : ''}</div>`;
      }
      html += '</div>';
    }
    // The relics and the forge.
    const need = f.need ?? RELICS_NEEDED;
    if (f.read) {
      let slots = '';
      for (let i = 0; i < Math.max(need, f.relics); i++) slots += `<span class="relic ${i < f.relics ? 'on' : ''}">${i < f.relics ? `◬ ${pick(RELICS[i % RELICS.length].name)}` : '◬ ?'}</span>`;
      const fl = F.forgeLock();
      html += `<div class="proj forge-card"><div class="proj-head"><span class="proj-ico pt">⛨</span><b>${tr('Forjar los Space Patrols', 'Forge the Space Patrols')}</b></div>${slots ? `<div class="relics">${slots}</div>` : ''}${
        s.patrol
          ? `<div class="small gold">${s.patrol.origin === 'faith' ? tr('Forjados por la Orden. Cada reliquia nueva arma una compañía más.', 'Forged by the Order. Every new relic arms one more company.') : tr('Los pueblos ya los fundaron de urgencia. Cada reliquia nueva arma una compañía más.', 'The peoples already raised them in a hurry. Every new relic arms one more company.')}</div>`
          : f.forge
            ? `<div class="vessel thin gold"><i style="--v:${Math.round((f.forge.t / f.forge.dur) * 100)}%"></i></div>`
            : f.forged
              ? `<div class="small gold">${tr('La forja está lista: se alzarán en cuanto un pueblo pueda tripular la barcaza.', 'The forge is done: they will rise as soon as a people can crew the barge.')}</div>`
              : `<div class="small muted">${tr(`Con ${need} ${need === 1 ? 'reliquia' : 'reliquias'} de los Precursores, la Orden arma a sus mejores: guerreros con armadura azul y oro y su barcaza de batalla. Empiezan con dos compañías.`, `With ${need} ${need === 1 ? 'relic' : 'relics'} of the Precursors, the Order arms its finest: warriors in blue and gold armour with their battle barge. They start with two companies.`)}</div><div class="costs">${costChips(FORGE_COST, res)}</div>${fl ? `<div class="note small">${pick(fl)}</div>` : ''}<button class="btn small primary" data-faith="forge"${fl ? ' disabled' : ''}>${tr('Forjar', 'Forge')}</button>`
      }</div>`;
    }
    return html;
  }

  /** The Freedom Wings: how many ships, how fast they grow, and where they fight. */
  private wingsCard() {
    const W = this.wings;
    const g = W?.wings;
    let html = '<div class="patrol-card wings-card">';
    const res = this.civ.civ?.res ?? null;
    if (!W || !g) {
      const lock = W?.unlockLock();
      html += `<div class="proj-head"><span class="proj-ico wg">✈</span><b>Freedom Wings</b><span class="def-lvl">${tr('Tecnología', 'Technology')}</span></div><div class="small muted">${tr(
        'Escuadrillas de voluntarios de todos los pueblos, aparte de los Space Patrols, para defender las colonias lejanas. Una vez desarrolladas, suman naves solas con el tiempo (más con cada mundo con vida y con la paz entre los pueblos), y se pueden comprar más con ciencia.',
        'Volunteer squadrons from every people, apart from the Space Patrols, to defend the distant colonies. Once developed, they gather ships on their own over time (more with every living world and with peace between the peoples), and more can be bought with science.',
      )}</div><div class="costs">${costChips(WINGS_TECH, res)}</div>${lock ? `<div class="note small">${pick(lock)}</div>` : ''}<button class="btn small primary" data-act="wings-unlock"${lock ? ' disabled' : ''}>${tr('Desarrollar', 'Develop')}</button></div>`;
      return html;
    }
    const buyLock = W.buyLock();
    const buy = `<span class="bw" data-tip="${buyLock ? pick(buyLock) : tr('Caras a propósito: cada tanda cuesta más que la anterior.', 'Dear on purpose: each batch costs more than the last.')}"><button class="btn small" data-act="wings-buy"${buyLock ? ' disabled' : ''}>${tr(`Comprar ${BUY_SHIPS} naves`, `Buy ${BUY_SHIPS} ships`)} ${costChips(buyCost(g.bought ?? 0), res)}</button></span>`;
    const living = W.living();
    const war = this.civ.state.relations?.some((r) => r.state === 'war');
    const mins = Math.floor(g.peace / 60);
    const growth = war
      ? tr('Hay guerra entre los pueblos: casi no llegan voluntarios.', 'There is war between the peoples: hardly any volunteers come.')
      : tr(`${living} ${living === 1 ? 'mundo con vida' : 'mundos con vida'} y ${mins} min de paz.`, `${living} living ${living === 1 ? 'world' : 'worlds'} and ${mins} min of peace.`);
    const sorties = g.sorties
      .map((o) => {
        const where = this.patrols?.star(o.star)?.name ?? '?';
        return tr(`${o.size} (${o.units}) en ${where} · ${Math.max(0, Math.ceil(o.dur - o.t))} s`, `${o.size} (${o.units}) at ${where} · ${Math.max(0, Math.ceil(o.dur - o.t))}s`);
      })
      .join(' · ');
    html += `<div class="proj-head"><span class="proj-ico wg">✈</span><b>Freedom Wings</b><span class="def-lvl">${int(g.units)} ${tr('naves', 'ships')}</span></div>
      <div class="small" data-tip="${tr(
        'Cada mundo con vida envía voluntarios; cuanto más dura la paz entre los pueblos, más llegan (hasta el triple). Las victorias suman voluntarios; las derrotas cuestan naves.',
        'Every living world sends volunteers; the longer the peace between the peoples lasts, the more come (up to three times as many). Victories bring volunteers; defeats cost ships.',
      )}"><span class="wg">+${W.rate().toFixed(1).replace('.', tr(',', '.'))}/min</span> · ${growth} <span class="muted">${tr(`Máximo ${W.cap()}.`, `Up to ${W.cap()}.`)}</span></div>
      <div class="small muted">${tr('Escuadrillas: S (6 naves) para riesgo bajo, M (12) para medio, L (20) para alto. Una más grande vence antes y pierde menos; una más chica puede no volver.', 'Squadrons: S (6 ships) for a low risk, M (12) for medium, L (20) for high. A bigger one wins sooner and loses less; a smaller one may not come back.')}</div>
      <div class="patrol-stats small"><span>✓ ${int(g.won)} <em>${g.won === 1 ? tr('victoria', 'victory') : tr('victorias', 'victories')}</em></span><span>✗ ${int(g.lost)} <em>${g.lost === 1 ? tr('derrota', 'defeat') : tr('derrotas', 'defeats')}</em></span>${sorties ? `<span class="wg">✈ ${sorties}</span>` : ''}</div>
      <div class="sr-btns">${buy}</div></div>`;
    return html;
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
        'Aún no existen. La Orden de la Estrella puede forjarlos con las reliquias de los Precursores (mira «La fe»). Si antes los invasores llegan a dominar varios mundos, los pueblos los fundarán de urgencia.',
        'They do not exist yet. The Order of the Star can forge them with the Precursors’ relics (see “Faith”). If invaders come to hold several worlds first, the peoples will raise them in a hurry.',
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
      const total = P.companies();
      const home = P.homeCompanies();
      const det = (p.detach ?? [])
        .map((d) => {
          const left = Math.max(0, Math.ceil(42 - d.t));
          const where = P.star(d.star)?.name ?? '?';
          return tr(`${d.companies === 2 ? '2 compañías' : '1 compañía'} en ${where} (vuelve${d.companies === 2 ? 'n' : ''} en ${left} s)`, `${d.companies === 2 ? '2 companies' : '1 company'} at ${where} (back in ${left}s)`);
        })
        .join(' · ');
      let barges = '';
      for (let i = 0; i < total; i++) barges += `<i class="${i < home ? 'home' : 'away'}"></i>`;
      html += `<div class="proj-head"><span class="proj-ico pt">⛨</span><b>Space Patrols · «${tr(p.barge.es, p.barge.en)}»</b></div>
        <div class="small"><span class="muted">${tr('Estado', 'Status')}:</span> ${home ? status : tr('todas las compañías luchan en otras estrellas', 'every company is fighting at other stars')}</div>
        <div class="small barges" data-tip="${tr('Cada compañía es una barcaza de batalla. Recluta más en Defensas.', 'Each company is a battle barge. Raise more in Defences.')}"><span class="barge-pips">${barges}</span> ${tr(`${total} ${total === 1 ? 'compañía' : 'compañías'} · ${home} en casa`, `${total} ${total === 1 ? 'company' : 'companies'} · ${home} at home`)}${det ? ` · <span class="pt">${det}</span>` : ''}</div>
        <div class="patrol-stats small"><span>☠ ${int(p.kills)} <em>${tr('invasores abatidos', 'invaders slain')}</em></span><span>⛨ ${int(p.purges)} <em>${p.purges === 1 ? tr('mundo purgado', 'world purged') : tr('mundos purgados', 'worlds purged')}</em></span><span>☮ ${int(p.wars)} <em>${p.wars === 1 ? tr('guerra terminada', 'war ended') : tr('guerras terminadas', 'wars ended')}</em></span><span>✶ ${int(p.strikes)} <em>${p.strikes === 1 ? tr('salto a otra estrella', 'jump to another star') : tr('saltos a otras estrellas', 'jumps to other stars')}</em></span></div>`;
    }
    html += '</div>';
    html += this.wingsCard();
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
      const risk = troubleRisk(st);
      const trouble = st.trouble
        ? `<span class="ember">${{ pirates: tr('⚠ piratas', '⚠ pirates'), natives: tr('⚑ revuelta', '⚑ revolt'), invaders: tr('⚠ invasores', '⚠ invaders'), plague: tr('☣ plaga', '☣ plague') }[st.trouble.kind]}</span> · ${riskText(risk!)}${
            st.strike ? ` · <span class="pt">${tr('⛨ los Patrols van hacia allí', '⛨ the Patrols are on their way')}</span>` : st.wing ? ` · <span class="wg">${tr(`✈ escuadrilla ${st.wing.size} luchando`, `✈ squadron ${st.wing.size} fighting`)}</span>` : ''
          }`
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
      const helped = !!st.strike || !!st.wing;
      if (st.trouble && p && !helped) {
        const need = companiesFor(strikeRisk(st, false));
        btns += btn('help', 'primary', `⛨ ×${need} ${costChips(strikeCost(st, false), res)}`, helpLock ? pick(helpLock) : patrolTip(need, s), !!helpLock);
      }
      if (st.trouble && this.wings?.wings && risk && !helped)
        for (const z of WING_SIZES) {
          const lock = this.wings.lock(st, z);
          btns += `<span class="bw" data-tip="<b>Freedom Wings ${z}</b> · ${WING_UNITS[z]} ${tr('naves', 'ships')}<br>${lock ? pick(lock) : wingForecast(z, risk)}"><button class="btn small wing-btn" data-act="wing" data-size="${z}" data-id="${st.id}"${lock ? ' disabled' : ''}>✈ ${z} <small>${WING_UNITS[z]}</small> ${costChips(WING_COST[z], res)}</button></span>`;
        }
      if (st.mode === 'trade' && p) {
        const need = companiesFor(strikeRisk(st, true));
        btns += btn('conquer', '', `${tr('Conquistar', 'Conquer')} ×${need} ${costChips(strikeCost(st, true), res)}`, conqLock ? pick(conqLock) : tr('Los Space Patrols someten el sistema: pasará a ser un dominio.', 'The Space Patrols bring the system to heel: it will become a dominion.'), !!conqLock);
      }
      const fort = st.fort ?? 0;
      if (fort < FORT_MAX) {
        const lock = P.fortifyLock(st);
        btns += btn(
          'fortify',
          '',
          `♜ ${tr('Fortificar', 'Fortify')} ${costChips(fortCost(fort), res)}`,
          `${tr(`<b>Defensas ${fort + 1}/${FORT_MAX}</b>: rechazan solas el ${Math.round(fortRepel(fort + 1) * 100)} % de los ataques, los que pasan son menos graves y la colonia resiste más mientras llega la ayuda.`, `<b>Defences ${fort + 1}/${FORT_MAX}</b>: they beat off ${Math.round(fortRepel(fort + 1) * 100)}% of attacks on their own, those that get through are milder and the colony holds out longer while help comes.`)}${lock ? `<br>${pick(lock)}` : ''}`,
          !!lock,
        );
      }
      if (st.mode === 'dominion') btns += btn('release', '', tr('Liberar', 'Set free'), tr('Devolverle la libertad: solo comerciará, y el sistema se ganará menos enemigos.', 'Give it back its freedom: it will only trade, and the system will make fewer enemies.'), false);
      html += `<div class="star-row ${st.mode}${st.trouble ? ' trouble' : ''}">
        <div class="sr-head"><i style="background:${col};color:${col}"></i><b>${st.name}</b><button class="rename-btn" data-act="rename" data-id="${st.id}" data-tip="${tr('Ponerle nombre', 'Give it a name')}">✎</button>${st.fort ? `<span class="fort" data-tip="${tr(`Defensas propias ${st.fort}/${FORT_MAX}: rechazan el ${Math.round(fortRepel(st.fort) * 100)} % de los ataques`, `Own defences ${st.fort}/${FORT_MAX}: they beat off ${Math.round(fortRepel(st.fort) * 100)}% of attacks`)}">♜ ${st.fort}</span>` : ''}<span class="badge ${st.mode}">${st.mode === 'dominion' ? tr('Dominio', 'Dominion') : tr('Comercio', 'Trade')}</span></div>
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
    const { open, urgent } = this.tabsState();
    for (const id of TABS) {
      const t = this.tabs[id];
      t.btn.style.display = open[id] ? '' : 'none';
      t.dot.style.display = urgent[id] ? '' : 'none';
    }
    // A tab that is not there yet (an old memory, or a tab asked for too soon) falls back to the works.
    if (!open[this.tab]) this.show('works');
    const r = this.civ.rates;
    this.res.innerHTML = RES_KEYS.map(
      (k) => `<span class="res-pill ${k}"><b>${RES_ICON[k]} ${int(civ.res[k])}</b><small>${resName(k)} · +${r[k].toFixed(1).replace('.', tr(',', '.'))}/s</small></span>`,
    ).join('');
    for (const c of this.cards) {
      const done = !!civ.done[c.def.id];
      const building = civ.building?.id === c.def.id;
      const lock = this.civ.lock(c.def.id);
      // Chips turn red only when even the first installment (25 %) cannot be paid.
      const html = costChips(c.def.cost, { metal: civ.res.metal / UPFRONT, fuel: civ.res.fuel / UPFRONT, water: civ.res.water / UPFRONT, science: civ.res.science / UPFRONT });
      if (c.cost.innerHTML !== html) c.cost.innerHTML = html;
      c.el.classList.toggle('done', done);
      c.el.classList.toggle('locked', !done && !building && !!lock);
      c.bar.style.display = building ? '' : 'none';
      if (building) (c.bar.firstChild as HTMLElement).style.setProperty('--v', `${Math.round((civ.building!.t / civ.building!.dur) * 100)}%`);
      // Only the first installment is needed to start.
      const short = !this.civ.canAfford(this.civ.upfront(c.def.cost));
      c.btn.disabled = done || building || !!lock || short;
      c.btn.textContent = done ? tr('Completado ✓', 'Completed ✓') : building ? tr('En construcción…', 'Under construction…') : tr('Construir', 'Build');
      const missing = building ? this.civ.shortfall() : null;
      c.note.textContent = done
        ? ''
        : building
          ? missing
            ? tr(`Esperando recursos: falta ${RES_KEYS.filter((k) => missing[k]).map((k) => `${RES_ICON[k]} ${missing[k]}`).join(' ')}`, `Waiting for resources: missing ${RES_KEYS.filter((k) => missing[k]).map((k) => `${RES_ICON[k]} ${missing[k]}`).join(' ')}`)
            : ''
          : lock
            ? pick(lock)
            : short
              ? tr('Faltan recursos para empezar (el 25 %).', 'Not enough resources to start (25%).')
              : tr('25 % al empezar, el resto mientras se construye.', '25% to start, the rest while it is built.');
      if (c.checks) {
        const html = done ? '' : this.civ.arkNeeds().map((n) => `<li class="${n.ok ? 'ok' : ''}">${n.ok ? '✓' : '·'} ${tr(n.es, n.en)}</li>`).join('');
        if (c.checks.innerHTML !== html) c.checks.innerHTML = html;
      }
      // What it would add to the threat, before it is built.
      const warn = done || building ? '' : this.threatNote(WORK_POWER);
      if (c.warn.textContent !== warn) c.warn.textContent = warn;
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
      const warn = civ.research ? '' : this.threatNote(TECH_POWER);
      if (R.warn.textContent !== warn) R.warn.textContent = warn;
    }
    for (const m of this.mission) {
      const lock = this.civ.missionLock(m.kind);
      m.btn.disabled = !!lock;
      m.note.textContent = lock ? pick(lock) : '';
      const html = costChips(MISSION_COST[m.kind], civ.res);
      if (m.cost.innerHTML !== html) m.cost.innerHTML = html;
    }
    const dh = this.defencesView();
    if (dh !== this.defHtml) this.defences.innerHTML = this.defHtml = dh;
    const fh = this.faithView();
    if (fh !== this.faithHtml) this.faithBox.innerHTML = this.faithHtml = fh;
    const bh = this.beyondView();
    if (bh !== this.beyondHtml) this.beyond.innerHTML = this.beyondHtml = bh;
  }
}
