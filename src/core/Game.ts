import * as THREE from 'three';
import { onLangChange, tr, num } from '../i18n';
import { Rng, clamp, randomSeed } from '../util';
import { massOf, solidsOf, toWorld, habZone, type Body, type GameState, type NewsItem, type Settings, type World } from './state';
import { clearSave, hasSave, loadSettings, loadState, newState, saveSettings, saveState } from './save';
import { Formation, bodyRadius, type FormationEvent, type Tool } from '../sim/formation';
import { SystemSim, COST, type Fx } from '../sim/system';
import { isGiantStuff, makeWorlds, worldStats, colonizable, type WorldStats } from '../sim/worlds';
import { Stage } from '../render/Stage';
import { Star } from '../render/Star';
import { Guides } from '../render/Guides';
import { Effects } from '../render/Effects';
import { DiskView } from '../render/DiskView';
import { BodiesView } from '../render/BodiesView';
import { SystemView } from '../render/SystemView';
import { lookOfWorld } from '../render/Planet';
import { worldRadius, worldXZ } from '../render/layout';
import { Hud, type Action, type DecisionView } from '../ui/Hud';
import { Inspector, Ledger, kindDot } from '../ui/Panels';
import { Labels } from '../ui/Labels';
import { TitleScreen, howToPlay, optionsDialog, chronicle } from '../ui/Screens';
import { modal, closeTopModal, anyModal, confirmBox, closeAllModals } from '../ui/Modal';
import { h } from '../ui/dom';
import { fmtAge, kindName, listOf } from '../ui/text';
import { capName, worldName } from '../content/names';
import { renameDialog } from '../ui/Rename';
import { spaceOrbits } from '../sim/orbits';
import { playComets } from '../minigames/Comets';
import { ProjectsPanel } from '../ui/Projects';
import { decisionView } from '../ui/decisions';
import { installTips } from '../ui/Tip';
import { isSettled } from '../sim/civ';
import { peopleOf } from '../sim/peoples';
import { ERA_NAMES, PROJECTS } from '../content/projects';
import { DEFENCES, defLevel, threatOf } from '../sim/threat';
import { playMigration } from '../minigames/Migration';
import { sound } from '../audio';

type Sel = number | 'star' | null;

/** Space Patrol blue. */
const PATROL = 0x6f9bff;
const WINGS = 0xffe1a0;

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  type: string;
}

/** Orchestrates everything: phases, input, rendering, interface and saving. */
export class Game {
  stage: Stage;
  star = new Star();
  guides = new Guides();
  fx: Effects;
  disk: DiskView | null = null;
  bodiesView: BodiesView;
  systemView: SystemView;
  labels: Labels;
  hud: Hud;
  inspector: Inspector;
  ledger: Ledger;
  title: TitleScreen | null = null;
  settings: Settings;
  s: GameState | null = null;
  formation: Formation | null = null;
  sim: SystemSim | null = null;
  mode: 'title' | 'play' = 'title';
  private demo: Formation | null = null;
  private ui: HTMLElement;
  private selected: Sel = null;
  private follow: Sel = null;
  /** Something other than a world the camera keeps in view: ships, the barge, two worlds about to collide. */
  private followFn: (() => THREE.Vector3) | null = null;
  /** Collision alerts the player closed. */
  private dismissed = new Set<number>();
  private targeting: Action | null = null;
  private hold = 0;
  private time = 0;
  private saveT = 10;
  private panelT = 0;
  private lastSpeed = 1;
  private pointers = new Map<number, Ptr>();
  private toolActive = false;
  private rotating = false;
  private dragged = false;
  private pinch: { d: number; a: number; my: number } | null = null;
  /** A primary-button (or one-finger) drag slides the view across the system. */
  private panning = false;
  private hoverBody: Body | null = null;
  private settling = false;
  private stats = new Map<number, WorldStats>();
  private last = performance.now();
  private quality: 'low' | 'high';

  constructor(root: HTMLElement) {
    this.settings = loadSettings();
    this.quality = this.settings.quality;
    const sceneEl = root.querySelector('#scene') as HTMLElement;
    this.ui = root.querySelector('#ui') as HTMLElement;
    installTips(this.ui);
    this.stage = new Stage(sceneEl, this.quality);
    this.fx = new Effects(this.stage.camera);
    this.bodiesView = new BodiesView(this.quality === 'high');
    this.systemView = new SystemView(this.quality === 'high', this.stage.camera);
    this.stage.scene.add(this.star.group, this.guides.group, this.bodiesView.group, this.systemView.group, this.fx.group);
    this.labels = new Labels(root.querySelector('#labels') as HTMLElement, this.stage);
    this.hud = new Hud(this.ui, {
      tool: (t) => this.setTool(t),
      action: (a) => this.startAction(a),
      star: () => this.select('star'),
      speed: (v) => this.setSpeed(v),
      menu: () => this.pauseMenu(),
      settle: () => this.confirmSettle(),
      chronicle: () => this.openChronicle(),
      news: (n) => {
        if (!this.focusNews(n)) this.openChronicle();
      },
      cancelTarget: () => this.setTargeting(null),
      works: () => this.openProjects(),
      decide: (id, accept, choice) => {
        sound.click();
        // Negative ids are collision alerts (not choices for the peoples).
        if (id < 0) return this.encounterChoice(-id, accept);
        this.sim?.decide(id, accept, choice);
      },
      renameSystem: () => this.rename('star'),
    });
    this.inspector = new Inspector(this.ui, {
      close: () => this.select(null),
      rename: (t) => this.rename(t),
      focus: (id) => this.focus(id, true),
      dial: (v) => {
        if (this.s) this.s.dial = v;
      },
    });
    this.ledger = new Ledger(this.ui, { select: (id) => (this.select(id), this.focus(id, true)) });
    this.hud.setVisible(false);
    this.ledger.el.style.display = 'none';
    sound.setVolumes(this.settings.music, this.settings.sfx);
    onLangChange(() => this.refreshLanguage());
    this.bindInput();
    this.startTitle();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    window.addEventListener('pagehide', () => this.save());
    requestAnimationFrame((t) => this.frame(t));
  }

  private get particles() {
    return this.quality === 'high' ? 7000 : 4200;
  }

  // ------------------------------------------------------------------ title
  private startTitle() {
    this.mode = 'title';
    this.hud.setVisible(false);
    this.inspector.hide();
    this.ledger.el.style.display = 'none';
    this.clearWorld();
    const rng = new Rng(randomSeed());
    const ids = { n: 1 };
    this.demo = Formation.create(Math.round(this.particles * 0.7), rng, () => ids.n++);
    for (let i = 0; i < 40; i++) this.demo.update(0.25);
    this.attachDisk(this.demo);
    this.stage.goal.dist = 196;
    this.stage.goal.pitch = 0.62;
    this.stage.drift = 0.03;
    this.stage.goal.target.set(0, 0, 0);
    const from = new URLSearchParams(location.search).get('from') === 'uib';
    this.title = new TitleScreen(this.ui, {
      hasSave: hasSave(),
      fromUib: from,
      legacy: null,
      onContinue: () => this.continueGame(),
      onNew: () => {
        sound.start();
        if (hasSave())
          confirmBox(this.ui, tr('Nuevo sistema', 'New system'), tr('Empezar de nuevo reemplazará el sistema guardado.', 'Starting over will replace your saved system.'), tr('Empezar', 'Begin'), () => this.newGame({ from: from ? 'uib' : null }));
        else this.newGame({ from: from ? 'uib' : null });
      },
      onHowTo: () => howToPlay(this.ui),
      onOptions: () => this.options(),
      onLang: () => this.refreshLanguage(),
    });
  }

  private attachDisk(f: Formation) {
    if (this.disk) {
      this.stage.scene.remove(this.disk.group);
      this.disk.dispose();
    }
    this.disk = new DiskView(f.n);
    this.stage.scene.add(this.disk.group);
  }

  private clearWorld() {
    if (this.disk) {
      this.stage.scene.remove(this.disk.group);
      this.disk.dispose();
      this.disk = null;
    }
    this.bodiesView.clear();
    this.systemView.clear();
    this.fx.clear();
    this.labels.clear();
    this.demo = null;
    this.formation = null;
    this.sim = null;
  }

  // ------------------------------------------------------------------ start / load
  newGame(o: { legacy?: number; legacySpecies?: GameState['legacySpecies']; from?: 'uib' | null }) {
    sound.start();
    this.title?.destroy();
    this.title = null;
    this.clearWorld();
    const s = newState(o);
    this.s = s;
    const f = Formation.create(this.particles, new Rng(s.seed), () => s.nextId++);
    s.bodies = f.bodies;
    this.formation = f;
    this.attachDisk(f);
    this.enterPlay();
    this.sim = null;
    const intro = o.legacySpecies
      ? {
          es: `El arca de los ${o.legacySpecies.name} busca hogar cerca de una estrella recién nacida: ${s.name}. Primero, hay que darle mundos.`,
          en: `The ark of the ${capName(o.legacySpecies.name)} seeks a home near a newborn star: ${s.name}. First, it needs worlds.`,
        }
      : {
          es: `Del polvo que tu nebulosa devolvió al espacio nace ${s.name}, una estrella joven envuelta en gas, polvo y hielo.`,
          en: `From the dust your nebula returned to space, ${s.name} is born: a young star wrapped in gas, dust and ice.`,
        };
    this.news('✦', intro.es, intro.en, 'good');
    this.hint('f.start', '✋', () =>
      tr(
        'Mantén pulsado sobre el disco para <b>reunir</b> polvo en una piedra. Suéltala y crecerá sola, barriendo su órbita.',
        'Hold on the disk to <b>gather</b> dust into a pebble. Let go and it will grow on its own, sweeping its orbit.',
      ),
    );
    this.save();
  }

  continueGame() {
    const s = loadState();
    if (!s) return this.newGame({});
    sound.start();
    this.title?.destroy();
    this.title = null;
    this.clearWorld();
    this.s = s;
    if (s.phase === 'formation' && s.disk) {
      const f = Formation.load(s.disk, new Rng(s.seed ^ Math.floor(s.time)), s.bodies, () => s.nextId++);
      this.formation = f;
      this.attachDisk(f);
    } else {
      s.phase = 'system';
      this.startSystem();
    }
    this.enterPlay();
    for (const n of s.news.slice(-3)) this.hud.pushNews(n, fmtAge(n.age));
  }

  private enterPlay() {
    if (!this.settling) {
      closeAllModals();
      this.hold = 0;
    }
    this.mode = 'play';
    this.stage.drift = 0;
    this.stage.goal.dist = 175;
    this.stage.goal.pitch = 0.98;
    this.stage.goal.target.set(0, 0, 0);
    this.hud.setVisible(true);
    this.hud.clearNews();
    this.hud.clearHints();
    this.selected = null;
    this.follow = null;
    this.targeting = null;
    this.inspector.hide();
    this.hud.setMode(this.s!.phase);
    if (this.s!.phase === 'formation') this.setTool('gather');
    this.ledger.el.style.display = this.s!.phase === 'system' ? '' : 'none';
    this.setSpeed(this.settings.speed || 1);
    this.ui.querySelector<HTMLElement>('.energy')!.style.display = this.s!.phase === 'system' ? '' : 'none';
  }

  private startSystem() {
    const s = this.s!;
    const sim = new SystemSim(s);
    sim.onNews = (n) => this.onNews(n);
    sim.onFx = (f) => this.onFx(f);
    this.sim = sim;
    this.systemView.setBelts(s.belts);
  }

  // ------------------------------------------------------------------ formation → system
  private confirmSettle() {
    if (!this.formation || this.settling) return;
    confirmBox(
      this.ui,
      tr('Asentar el sistema', 'Settle the system'),
      tr('Los cuerpos que has formado se convertirán en planetas y lunas. El polvo suelto quedará como cinturones de asteroides.', 'The bodies you have formed will become planets and moons. Loose dust will remain as asteroid belts.'),
      tr('Asentar', 'Settle'),
      () => this.finishFormation(),
    );
  }

  private finishFormation() {
    const s = this.s;
    const f = this.formation;
    if (!s || !f || this.settling) return;
    this.settling = true;
    f.pointerUp();
    const rng = new Rng(s.seed ^ 0xa11ce);
    const bodies = [...f.bodies].sort((a, b) => a.r - b.r);
    // Last collisions: bodies sharing practically the same orbit merge. Close neighbours are left
    // for later: they either drift into stable orbits or meet in a collision.
    for (let i = 0; i < bodies.length - 1; ) {
      const a = bodies[i];
      const b = bodies[i + 1];
      const gap = toWorld(b.r) - toWorld(a.r);
      if (gap < 0.5 + 0.25 * (bodyRadius(a) + bodyRadius(b))) {
        const big = massOf(a) >= massOf(b) ? a : b;
        const small = big === a ? b : a;
        big.metal += small.metal;
        big.rock += small.rock;
        big.water += small.water;
        big.org += small.org;
        big.gas += small.gas * (solidsOf(big) > 6 ? 1 : 0.1);
        for (const m of small.moons) if (big.moons.length < 6) big.moons.push(m);
        bodies.splice(bodies.indexOf(small), 1);
      } else i++;
    }
    const belts: GameState['belts'] = [];
    const keep: Body[] = [];
    for (const b of bodies) {
      if (massOf(b) < 0.004) for (let k = 0; k < 8; k++) belts.push({ r: b.r * (1 + rng.gauss(0, 0.03)), th: b.th + rng.gauss(0, 0.3), s: massOf(b) / 8 });
      else keep.push(b);
    }
    const alive: number[] = [];
    for (let i = 0; i < f.n; i++) if (f.alive[i] && f.metal[i] + f.rock[i] + f.water[i] + f.org[i] > 0) alive.push(i);
    const stride = Math.max(1, Math.ceil(alive.length / 1600));
    for (let j = 0; j < alive.length; j += stride) {
      const i = alive[j];
      belts.push({ r: f.r[i], th: f.th[i], s: f.metal[i] + f.rock[i] + f.water[i] + f.org[i] });
    }
    if (!keep.length) {
      // Nothing gathered at all: the star still keeps a lonely rock.
      keep.push({ id: s.nextId++, r: 1.2, th: 0, target: null, moons: [], seed: 7, born: 0, metal: 0.1, rock: 0.25, water: 0.02, gas: 0, org: 0.01 });
    }
    s.worlds = makeWorlds(keep, rng, () => s.nextId++);
    spaceOrbits(s.worlds);
    s.belts = belts;
    s.bodies = [];
    s.disk = null;
    s.phase = 'system';
    s.age = Math.max(s.age, 100);
    s.energy = 70;
    s.nextEvent = s.time + 140;
    const flash = () => {
      for (const b of keep) {
        const w = toWorld(b.r);
        this.fx.flash(Math.cos(b.th) * w, 0, Math.sin(b.th) * w, 0xffc070, 8 + bodyRadius(b) * 3, 1.6);
      }
    };
    flash();
    sound.whoosh();
    if (this.disk) {
      this.stage.scene.remove(this.disk.group);
      this.disk.dispose();
      this.disk = null;
    }
    this.bodiesView.clear();
    this.formation = null;
    this.startSystem();
    this.enterPlay();
    const planets = s.worlds.filter((w) => w.parent === null);
    const moons = s.worlds.length - planets.length;
    this.news(
      '⊛',
      `Los mundos se asientan: ${planets.length} ${planets.length === 1 ? 'planeta' : 'planetas'} y ${moons} ${moons === 1 ? 'luna' : 'lunas'} orbitan a ${s.name}.`,
      `The worlds settle: ${planets.length} ${planets.length === 1 ? 'planet' : 'planets'} and ${moons} ${moons === 1 ? 'moon' : 'moons'} now orbit ${s.name}.`,
      'good',
    );
    if (s.legacySpecies) this.sim!.arriveLegacy();
    this.settling = false;
    this.save();
    this.showSummary();
  }

  private showSummary() {
    const s = this.s!;
    const list = h('div', { class: 'summary' });
    const L = s.L * s.dial;
    for (const w of s.worlds.filter((x) => x.parent === null).sort((a, b) => a.a - b.a)) {
      const st = worldStats(w, s.worlds, L);
      const moons = s.worlds.filter((x) => x.parent === w.id).length;
      const m = massOf(w);
      list.append(
        h(
          'div',
          { class: 'w' },
          h('span', { class: 'dot', style: `width:12px;height:12px;border-radius:50%;background:${kindDot(st.kind)}` }),
          h('div', null, h('b', { class: 'gold', style: 'font-family:var(--title);letter-spacing:.08em' }, w.name), ' ', h('span', { class: 'muted' }, `· ${kindName(st.kind)}${moons ? ` · ${moons} ${tr(moons === 1 ? 'luna' : 'lunas', moons === 1 ? 'moon' : 'moons')}` : ''}`)),
          h('span', { class: 'muted small' }, `${num(m, m < 0.1 ? 3 : m < 10 ? 2 : 0)} M⊕ · ${num(w.a, 2)} ${tr('UA', 'AU')}`),
        ),
      );
    }
    this.hold++;
    modal(this.ui, {
      title: tr('Los mundos se asientan', 'The worlds settle'),
      lore: tr(
        `Han pasado cien millones de años. El gas se ha ido, el polvo se ha vuelto piedra, y ${s.name} tiene por fin su familia de mundos.`,
        `A hundred million years have passed. The gas is gone, the dust has turned to stone, and ${s.name} finally has its family of worlds.`,
      ),
      body: [list, h('p', { class: 'small muted', style: 'text-align:center' }, tr('Ahora, a ver si alguno puede albergar vida.', 'Now, let’s see whether any of them can harbour life.'))],
      buttons: [{ label: tr('Contemplar el sistema', 'Behold the system'), primary: true }],
      onClose: () => {
        this.hold = Math.max(0, this.hold - 1);
        this.hint('s.start', '◉', () =>
          tr(
            'Toca un mundo para ver qué necesita para albergar vida. Tus acciones gastan <b>luz estelar</b>, que se recarga sola.',
            'Tap a world to see what it needs to harbour life. Your actions spend <b>starlight</b>, which refills on its own.',
          ),
        );
      },
    });
  }

  // ------------------------------------------------------------------ news & hints
  /** Lets the player name — or rename — the system, a world (its moons follow) or a distant star. */
  private rename(target: number | 'star' | { star: number }) {
    const s = this.s;
    if (!s) return;
    sound.click();
    const rng = new Rng(randomSeed());
    const names = () => [s.name, ...s.worlds.map((w) => w.name), ...(s.stars ?? []).map((x) => x.name)];
    const taken = (own: string) => (v: string) =>
      v.toLowerCase() !== own.toLowerCase() && names().some((n) => n.toLowerCase() === v.toLowerCase()) ? tr('Ese nombre ya lo lleva otro astro.', 'Another body already bears that name.') : null;
    const suggest = () => worldName(rng, new Set(names()));
    const done = (old: string, v: string) => {
      this.news('✎', `${old} ahora se llama ${v}.`, `${old} is now called ${v}.`, 'info');
      this.save();
    };
    if (target === 'star') {
      renameDialog(this.ui, {
        title: tr('Nombre del sistema', 'Name of the system'),
        label: tr('La estrella y todo su sistema llevarán este nombre.', 'The star and its whole system will bear this name.'),
        value: s.name,
        suggest,
        validate: taken(s.name),
        onSave: (v) => {
          const old = s.name;
          if (v === old) return;
          s.name = v;
          done(old, v);
        },
      });
      return;
    }
    if (typeof target === 'number') {
      const w = s.worlds.find((x) => x.id === target);
      if (!w) return;
      const moon = w.parent !== null;
      renameDialog(this.ui, {
        title: moon ? tr('Nombre de la luna', 'Name of the moon') : tr('Nombre del mundo', 'Name of the world'),
        label: moon ? tr('¿Cómo se llamará esta luna?', 'What shall this moon be called?') : tr('¿Cómo se llamará este mundo? Sus lunas lo seguirán.', 'What shall this world be called? Its moons will follow.'),
        value: w.name,
        suggest,
        validate: taken(w.name),
        onSave: (v) => {
          const old = w.name;
          if (v === old) return;
          w.name = v;
          // Moons named after their planet ("Kadra I") take the new name too.
          for (const m of s.worlds) if (m.parent === w.id && m.name.startsWith(`${old} `)) m.name = `${v}${m.name.slice(old.length)}`;
          done(old, v);
        },
      });
      return;
    }
    const st = s.stars?.find((x) => x.id === target.star);
    if (!st) return;
    renameDialog(this.ui, {
      title: tr('Nombre de la estrella', 'Name of the star'),
      label: tr('La estrella lejana donde vive esta colonia.', 'The distant star where this colony lives.'),
      value: st.name,
      suggest,
      validate: taken(st.name),
      onSave: (v) => {
        const old = st.name;
        if (v === old) return;
        st.name = v;
        this.projects?.refresh();
        done(old, v);
      },
    });
  }

  private news(icon: string, es: string, en: string, kind: GameState['news'][number]['kind'] = 'info') {
    const s = this.s;
    if (!s) return;
    const item: NewsItem = { age: s.age, icon, es, en, kind };
    const f = this.sim?.guessFocus(es);
    if (f) item.focus = f;
    s.news.push(item);
    if (s.news.length > 240) s.news.shift();
    this.onNews(item);
  }

  private onNews(n: GameState['news'][number]) {
    this.hud.pushNews(n, fmtAge(n.age));
    sound.chime(n.kind === 'voice' ? 'life' : n.kind);
    if (n.kind === 'alien')
      this.hint('s.alien', '⚠', () => tr('Llegan visitantes de otra estrella. Pulsa <b>Llamarada</b> y elige sus naves o los mundos que ocupan.', 'Visitors from another star are arriving. Press <b>Flare</b> and pick their ships or the worlds they occupy.'));
  }

  private hint(id: string, glyph: string, html: () => string) {
    const s = this.s;
    if (!s || s.tutorials[id]) return;
    s.tutorials[id] = true;
    this.hud.hint(id, glyph, html);
  }

  /** Last known position of a ship (it may already be gone from the simulation). */
  private shipGetter(id: number) {
    const last = (this.systemView.shipXYZ.get(id) ?? new THREE.Vector3(0, -999, 0)).clone();
    return () => {
      const v = this.systemView.shipXYZ.get(id);
      if (v) last.copy(v);
      return last;
    };
  }

  private openChronicle() {
    if (!this.s) return;
    sound.click();
    chronicle(this.ui, this.s, this.hud, (n) => this.focusNews(n));
  }

  /** Takes the camera to where a piece of news happened. Returns false when there is nothing to see any more. */
  private focusNews(n: NewsItem) {
    const s = this.s;
    const f = n.focus;
    if (!s || !f || !this.sim) return false;
    sound.click();
    if ('world' in f) {
      if (!s.worlds.some((w) => w.id === f.world)) return false;
      this.select(f.world);
      this.focus(f.world, true);
      return true;
    }
    if ('pair' in f) return this.watchPair(f.pair[0], f.pair[1]);
    if ('ship' in f) {
      if (!s.ships.some((x) => x.id === f.ship)) return false;
      this.select(null);
      this.followFn = this.shipGetter(f.ship);
      this.stage.goal.dist = 24;
      return true;
    }
    if ('star' in f) {
      const st = s.stars?.find((x) => x.id === f.star);
      if (!st) return false;
      this.select(null);
      const v = new THREE.Vector3(Math.cos(st.ang) * 96, 0, Math.sin(st.ang) * 96);
      this.followFn = () => v;
      this.stage.goal.dist = 70;
      return true;
    }
    if ('barge' in f) {
      if (!s.patrol || s.patrol.phase === 'away') return false;
      this.select(null);
      this.followFn = this.bargeGetter();
      this.stage.goal.dist = 18;
      return true;
    }
    const v = new THREE.Vector3(f.x, 0, f.z);
    this.select(null);
    this.followFn = () => v;
    this.stage.goal.dist = 40;
    return true;
  }

  /**
   * Two worlds about to collide: the camera stays with the heavier one (it barely moves; the
   * other comes to it), and after the impact, with what is left.
   */
  private watchPair(a: number, b: number) {
    const s = this.s;
    if (!s) return false;
    const A = s.worlds.find((w) => w.id === a);
    const B = s.worlds.find((w) => w.id === b);
    const big = A && B ? (massOf(A) >= massOf(B) ? A : B) : (A ?? B);
    if (!big) return false;
    // Just the camera: no panel over the show.
    this.select(null);
    this.focus(big.id);
    this.stage.goal.dist = clamp(worldRadius(big) * 12 + 22, 30, 70);
    return true;
  }

  private encounterChoice(id: number, watch: boolean) {
    this.dismissed.add(id);
    const e = this.s?.encounters?.find((x) => x.id === id);
    if (watch && e) this.watchPair(e.a, e.b);
  }

  /** A card for the next collision on the way (one at a time): how long is left, and a button to watch. */
  private encounterViews(): DecisionView[] {
    const s = this.s;
    if (!s?.encounters?.length) return [];
    const out: DecisionView[] = [];
    const next = [...s.encounters].filter((e) => !this.dismissed.has(e.id)).sort((x, y) => x.dur - x.t - (y.dur - y.t));
    for (const e of next.slice(0, 1)) {
      if (this.dismissed.has(e.id)) continue;
      const A = s.worlds.find((w) => w.id === e.a);
      const B = s.worlds.find((w) => w.id === e.b);
      if (!A || !B) continue;
      out.push({
        id: -e.id,
        icon: '☄',
        title: tr('¡Colisión inminente!', 'Collision ahead!'),
        body: tr(
          `<b>${A.name}</b> y <b>${B.name}</b> se atraen y van a chocar.${e.emergency ? ' Sus pueblos han declarado el estado de emergencia y evacúan.' : ''} <i>Migrar uno de los dos aún podría evitarlo.</i>`,
          `<b>${A.name}</b> and <b>${B.name}</b> are pulling at each other and will collide.${e.emergency ? ' Their peoples have declared a state of emergency and are evacuating.' : ''} <i>Migrating one of them could still avert it.</i>`,
        ),
        yes: tr('Ver el choque', 'Watch it'),
        yesOk: true,
        no: tr('Cerrar', 'Close'),
        left: Math.max(0, e.dur - e.t),
        dur: e.dur,
      });
    }
    return out;
  }

  /** Where the Space Patrols' battle barge is right now. */
  private bargeGetter() {
    const last = new THREE.Vector3();
    return () => {
      const p = this.s?.patrol;
      if (p) last.set(p.x, p.y, p.z);
      return last;
    };
  }

  private worldGetter(id: number) {
    const last = new THREE.Vector3();
    return () => {
      const v = this.systemView.posOf(id);
      if (v) last.copy(v);
      return last;
    };
  }

  private onFx(f: Fx) {
    const s = this.s!;
    // Each people has its own colour; mixed fleets of the whole system glow a warm gold.
    const tone = (id: number | undefined, l = 0.68) => {
      const p = id ? s.peoples?.find((x) => x.id === id) : undefined;
      return p ? new THREE.Color().setHSL(p.hue, 0.75, l).getHex() : 0xffe2b0;
    };
    const worldTone = (id: number) => {
      const w = s.worlds.find((x) => x.id === id);
      return tone(w ? peopleOf(w) : 0);
    };
    const alien = new THREE.Color().setHSL(s.alienSpecies?.hue ?? 0.85, 0.8, 0.7).getHex();
    switch (f.kind) {
      case 'flareShip':
        return;
      case 'laser': {
        const from = this.worldGetter(f.world);
        const to = this.shipGetter(f.ship);
        const c = worldTone(f.world);
        this.fx.laser(from, to, c);
        setTimeout(() => this.fx.laser(from, to, c), 260);
        sound.laser();
        return;
      }
      case 'boom': {
        const v = this.shipGetter(f.ship)();
        if (v.y > -500) this.fx.boom(v.x, v.y, v.z, f.big, f.big ? 0xd59aff : 0xffa060);
        sound.thud(f.big ? 1.2 : 0.35);
        return;
      }
      case 'shieldHit': {
        const rock = this.systemView.threatPos3(f.threat)?.clone();
        const from = this.worldGetter(f.world);
        if (rock) {
          this.fx.laser(from, () => rock, 0xffd28a);
          setTimeout(() => this.fx.boom(rock.x, rock.y, rock.z, false, 0xffc070), 250);
        }
        sound.laser();
        return;
      }
      case 'warpOut':
      case 'warpIn':
        this.fx.warp(f.x, f.z, f.dx, f.dz, f.count, f.tint === 'alien' ? alien : f.tint === 'patrol' ? PATROL : f.tint === 'wings' ? WINGS : tone(f.people), f.kind === 'warpIn');
        sound.warp();
        if (f.count > 6 || f.tint === 'patrol') this.stage.shake(f.tint === 'patrol' ? 0.35 : 0.6);
        return;
      case 'lance': {
        // The battle barge's lance: a short, blinding beam.
        const from = this.bargeGetter();
        const to = f.ship !== undefined ? this.shipGetter(f.ship) : f.world !== undefined ? this.worldGetter(f.world) : null;
        if (!to) return;
        this.fx.beam(from, to, 0xfff1c8, 0.5, 0.5);
        if (f.world !== undefined) {
          const p = to();
          setTimeout(() => this.fx.flash(p.x, 0.2, p.z, 0xffd28a, 3.5, 0.6), 160);
        }
        sound.laser();
        return;
      }
      case 'podLand': {
        const w = s.worlds.find((x) => x.id === f.world);
        const p = this.systemView.posOf(f.world);
        if (!w || !p) return;
        const r = worldRadius(w);
        const a = Math.random() * Math.PI * 2;
        const x = p.x + Math.cos(a) * r * 0.6;
        const z = p.z + Math.sin(a) * r * 0.6;
        this.fx.boom(x, 0.3, z, false, f.pod ? 0xffb060 : 0x9fc0ff);
        if (f.pod) this.fx.ring(p.x, p.z, 0xffc890, r * 1.6 + 1, 0.8, 0, true);
        sound.thud(f.pod ? 0.5 : 0.25);
        return;
      }
      case 'collision': {
        // Two worlds become one: a blinding flash, shock rings, and the whole sky shakes.
        const r = 4;
        this.fx.flash(f.x, 0, f.z, 0xfff0d0, f.big ? 26 : 16, 2.2);
        this.fx.flash(f.x, 0, f.z, 0xff7a35, f.big ? 18 : 11, 3.5);
        this.fx.ring(f.x, f.z, 0xffb070, r * 4, 2.4);
        setTimeout(() => this.fx.ring(f.x, f.z, 0xff6a2a, r * 7, 3.2), 250);
        setTimeout(() => this.fx.ring(f.x, f.z, 0xffd28a, r * 10, 4, 0, true), 600);
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * 3;
          setTimeout(() => this.fx.boom(f.x + Math.cos(a) * d, (Math.random() - 0.5) * 2, f.z + Math.sin(a) * d, i < 2, 0xffa060), 120 * i);
        }
        this.stage.shake(f.big ? 1.6 : 1);
        sound.thud(1.6);
        sound.whoosh();
        return;
      }
      case 'deploy': {
        const p = this.systemView.posOf(f.world) ?? new THREE.Vector3();
        this.fx.ring(p.x, p.z, PATROL, 18, 2.6);
        this.fx.ring(p.x, p.z, 0xffd28a, 10, 2);
        this.fx.flash(p.x, 0, p.z, 0xcfe0ff, 14, 1.8);
        sound.chime('good');
        this.hint('s.patrol', '⛨', () =>
          tr(
            'Los <b>Space Patrols</b> han nacido: su barcaza de batalla purga los mundos ocupados con cápsulas de desembarco y no tolera guerras entre pueblos. Cuando una colonia en otra estrella pida ayuda, podrás enviarlos; también pueden <b>conquistar</b> estrellas desde <b>Proyectos</b>: los dominios pagan más que el comercio, pero atraen enemigos.',
            'The <b>Space Patrols</b> are born: their battle barge purges occupied worlds with drop pods and does not tolerate wars between peoples. When a colony around another star asks for help, you can send them; they can also <b>conquer</b> stars from <b>Projects</b>: dominions pay more than trade, but they attract enemies.',
          ),
        );
        return;
      }
      case 'supernova':
        this.stage.skyFlash = 1;
        {
          const d = this.stage.camera.position.clone().normalize().multiplyScalar(-1);
          const p = d.multiplyScalar(1500).add(new THREE.Vector3(400, 500, 0));
          this.fx.flash(p.x, p.y, p.z, 0xfff2d8, 700, 7);
        }
        sound.thud(1.5);
        sound.whoosh();
        return;
      case 'superflare':
        this.star.flash();
        this.fx.ring(0, 0, 0xffa040, 60, 2.5);
        this.fx.flash(0, 0, 0, 0xffc070, 50, 1.8);
        sound.flare();
        return;
      case 'built': {
        const p = this.systemView.posOf(f.world) ?? new THREE.Vector3();
        this.fx.ring(p.x, p.z, 0xffd28a, 14, 2.2);
        this.fx.flash(p.x, 0, p.z, 0xffe6b0, 12, 1.6);
        if (f.id === 'dyson') this.fx.ring(0, 0, 0xffd28a, 30, 3);
        sound.chime('good');
        return;
      }
      case 'raid': {
        // Defenders fire on the raider; it either explodes or gets through.
        const to = this.shipGetter(f.ship);
        const from = this.worldGetter(f.world);
        this.fx.laser(from, to, worldTone(f.world));
        const v = to();
        if (!f.hit && v.y > -500) setTimeout(() => this.fx.boom(v.x, v.y, v.z, false, 0xffa060), 200);
        if (f.hit) {
          const p = this.systemView.posOf(f.world);
          if (p) this.fx.flash(p.x, 0, p.z, 0xff7a3a, 4, 0.6);
        }
        sound.laser();
        return;
      }
      case 'truce': {
        // A treaty: a soft ring around every world of both peoples.
        for (const w of s.worlds) {
          const id = peopleOf(w);
          if (id !== f.a && id !== f.b) continue;
          const p = this.systemView.posOf(w.id);
          if (p) this.fx.ring(p.x, p.z, tone(id, 0.8), worldRadius(w) * 3 + 3, 2.2);
        }
        sound.chime('good');
        return;
      }
      case 'settled': {
        const w = s.worlds.find((x) => x.id === f.world);
        const p = this.systemView.posOf(f.world);
        if (w && p) {
          this.fx.ring(p.x, p.z, worldTone(w.id), worldRadius(w) * 4 + 3, 2);
          this.fx.flash(p.x, 0, p.z, worldTone(w.id), worldRadius(w) * 3 + 2, 1.2);
        }
        this.colonyHint();
        return;
      }
      case 'rogueCaught': {
        const p = this.systemView.posOf(f.world) ?? new THREE.Vector3();
        this.fx.ring(p.x, p.z, 0xe8d2a0, 12, 2.4);
        this.fx.flash(p.x, 0, p.z, 0xe8d2a0, 10, 1.6);
        return;
      }
      case 'arkWarp': {
        const v = this.shipGetter(f.ship)();
        if (v.y > -500) {
          const d = new THREE.Vector3(v.x, 0, v.z).normalize();
          this.fx.warp(v.x, v.z, d.x, d.z, 1, 0xfff0c0, false);
        }
        sound.warp();
        return;
      }
    }
    const w = s.worlds.find((x) => x.id === f.world);
    const p = w ? this.systemView.pos(w) : new THREE.Vector3();
    const r = w ? worldRadius(w) : 1;
    if (f.kind === 'flare') {
      this.star.flash();
      sound.flare();
      this.fx.beam(new THREE.Vector3(0, 0, 0), () => (w ? this.systemView.pos(w) : p), 0xffa040, 3.2 + r, 1.3);
      setTimeout(() => this.fx.flash(p.x, 0, p.z, 0xffc070, r * 6 + 4, 1), 450);
    } else if (f.kind === 'impact') {
      this.fx.flash(p.x, 0, p.z, 0xff8040, r * 7 + 3, 1.2);
      this.fx.ring(p.x, p.z, 0xff7a35, r * 4 + 3);
      sound.thud(1);
    } else if (f.kind === 'volcano') {
      this.fx.flash(p.x, 0, p.z, 0xff5a1c, r * 4 + 2, 1.6);
      this.fx.ring(p.x, p.z, 0xff6a2a, r * 3 + 2, 1.8);
      sound.thud(0.6);
    } else if (f.kind === 'life') {
      this.fx.ring(p.x, p.z, 0x98c770, r * 5 + 4, 2.4);
      this.fx.flash(p.x, 0, p.z, 0xa8e080, r * 5 + 3, 2);
      this.hint('s.life', '❦', () => tr('¡Vida! Mantén estable su mundo: eras glaciales, calentamientos y asteroides pondrán a prueba su salud.', 'Life! Keep its world steady: ice ages, warming and asteroids will test its health.'));
    } else if (f.kind === 'colony') {
      this.fx.ring(p.x, p.z, w ? worldTone(w.id) : 0xdcbb7a, r * 4 + 3, 2);
      this.colonyHint();
    } else if (f.kind === 'arkLaunch') {
      this.fx.flash(p.x, 0, p.z, 0xfff0c0, 24, 2.5);
      this.fx.ring(p.x, p.z, 0xfff0c0, 30, 3);
      sound.whoosh();
    }
  }

  private colonyHint() {
    this.hint('s.colony', '⌂', () =>
      tr(
        'Un pueblo ya viaja entre mundos. Tú no eres ninguno de ellos: los observas a todos y decides si intervienes. Cada tipo de mundo aporta algo: los gigantes dan combustible, los helados agua, los rocosos metal y los vivos ciencia.',
        'A people now travels between worlds. You are none of them: you watch over them all and choose whether to step in. Each kind of world gives something: giants give fuel, icy worlds water, rocky worlds metal and living worlds science.',
      ),
    );
  }

  private onFormationEvent(e: FormationEvent) {
    const s = this.s;
    if (e.kind === 'seed' || e.kind === 'clump') {
      this.fx.flash(e.x, 0, e.z, 0xffd28a, 4, 0.8);
      sound.sizzle();
      if (s && s.bodies.length >= 1)
        this.hint('f.body', '◌', () =>
          tr(
            'Cada cuerpo barre el polvo de su órbita. Reúne más material cerca, o usa <b>Empujar</b> para juntar dos cuerpos y que choquen.',
            'Each body sweeps the dust along its orbit. Gather more material nearby, or use <b>Nudge</b> to bring two bodies together so they collide.',
          ),
        );
    } else if (e.kind === 'merge') {
      const big = (e.mass ?? 0.1) > 0.3;
      this.fx.flash(e.x, 0, e.z, 0xff9a4a, big ? 14 : 7, 1.1);
      if (big) this.fx.ring(e.x, e.z, 0xff7a35, 9, 1.4);
      if (e.body) this.bodiesView.heat(e.body.id, big ? 1 : 0.5);
      sound.thud(big ? 1 : 0.5);
    } else if (e.kind === 'moon') {
      this.fx.flash(e.x, 0, e.z, 0xffd0a0, 14, 1.4);
      this.fx.ring(e.x, e.z, 0xe8d2a0, 10, 1.8);
      if (e.body) this.bodiesView.heat(e.body.id, 1);
      sound.thud(1.2);
      this.news('☾', 'Un choque gigante lanza escombros al espacio… y de ellos nace una luna.', 'A giant impact flings debris into space… and from it a moon is born.', 'good');
    } else if (e.kind === 'capture') {
      this.fx.ring(e.x, e.z, 0xe8d2a0, 7, 1.4);
      this.news('☾', 'Un gigante atrapa con su gravedad a un cuerpo pequeño: ahora es su luna.', 'A giant catches a small body with its gravity: it is now its moon.', 'info');
    } else if (e.kind === 'giant') {
      this.fx.ring(e.x, e.z, 0xe6b98a, 16, 2.4);
      this.fx.flash(e.x, 0, e.z, 0xffe0b0, 16, 2);
      sound.chime('good');
      this.news('◍', 'Un núcleo helado empieza a tragarse el gas del disco: está naciendo un gigante.', 'An icy core starts swallowing the disk’s gas: a giant is being born.', 'good');
    }
  }

  // ------------------------------------------------------------------ tools & actions
  setTool(t: Tool) {
    if (!this.formation) return;
    this.formation.pointerUp();
    this.formation.tool = t;
    this.hud.setActiveTool(t);
  }

  private setSpeed(v: number) {
    if (v > 0) this.lastSpeed = v;
    this.settings.speed = v;
    saveSettings(this.settings);
    this.hud.setSpeed(v);
  }

  private setTargeting(a: Action | null) {
    this.targeting = a;
    this.hud.setActiveTool(a);
    if (!a) return this.hud.showBanner(null);
    const name = { flare: tr('la llamarada', 'the flare'), volcano: tr('despertar volcanes', 'waking volcanoes'), comets: tr('la lluvia de cometas', 'the comet shower'), migrate: tr('la migración', 'the migration') }[a];
    const extra = a === 'flare' ? tr(' (un mundo, una nave visitante o un asteroide)', ' (a world, a visiting ship or an asteroid)') : '';
    this.hud.showBanner(tr(`Elige un objetivo para ${name}${extra}.`, `Choose a target for ${name}${extra}.`));
  }

  private startAction(a: Action) {
    const sim = this.sim;
    if (!sim) return;
    sound.click();
    if (!sim.canAfford(COST[a])) {
      this.hud.showTip(tr(`Necesitas <b>${COST[a]}</b> de luz estelar. Se recarga sola con el tiempo.`, `You need <b>${COST[a]}</b> starlight. It refills on its own over time.`), 3.5);
      return;
    }
    if (typeof this.selected === 'number') {
      const w = sim.world(this.selected);
      if (w) return void this.doAction(a, w);
    }
    this.setTargeting(this.targeting === a ? null : a);
  }

  private doAction(a: Action, w: World) {
    const sim = this.sim!;
    const s = this.s!;
    this.setTargeting(null);
    const st = sim.stats(w);
    const say = (es: string, en: string) => this.hud.showTip(tr(es, en), 3.8);
    if (!sim.canAfford(COST[a])) return say(`Necesitas <b>${COST[a]}</b> de luz estelar.`, `You need <b>${COST[a]}</b> starlight.`);
    if (a === 'flare') {
      sim.flare(w);
      return;
    }
    if (a === 'volcano') {
      if (st.giant) return say('Un gigante gaseoso no tiene volcanes: no tiene suelo.', 'A gas giant has no volcanoes: it has no ground.');
      if (massOf(w) < 0.03) return say(`${w.name} es tan pequeño que su interior ya se enfrió.`, `${w.name} is so small its interior has already cooled.`);
      if (w.volcanoCd > 0) return say(`Los volcanes de ${w.name} descansan. Vuelve en ${Math.ceil(w.volcanoCd)} s.`, `The volcanoes of ${w.name} are resting. Try again in ${Math.ceil(w.volcanoCd)} s.`);
      sim.volcano(w);
      sim.news('⛰', `Despiertan los volcanes de ${w.name}: su aire se vuelve más denso.`, `The volcanoes of ${w.name} awaken: its air grows thicker.`, 'info');
      return;
    }
    if (a === 'comets') {
      if (st.giant) return say('Los cometas se pierden en las nubes de un gigante. Elige un mundo rocoso o una luna.', 'Comets vanish into a giant’s clouds. Choose a rocky world or a moon.');
      s.energy -= COST.comets;
      this.hold++;
      playComets(this.ui, w.name, lookOfWorld(w, st), (gain) => {
        this.hold = Math.max(0, this.hold - 1);
        if (gain) {
          sim.applyComets(w, gain, false);
          const p = this.systemView.pos(w);
          this.fx.ring(p.x, p.z, 0x9fd4e6, worldRadius(w) * 4 + 3, 1.6);
        }
        this.save();
      });
      return;
    }
    if (a === 'migrate') {
      if (w.parent !== null) return say('Las lunas siguen a su planeta: migra el planeta entero.', 'Moons follow their planet: migrate the whole planet.');
      s.energy -= COST.migrate;
      this.hold++;
      const L = s.L * s.dial;
      playMigration(
        this.ui,
        {
          name: w.name,
          a: w.a,
          hz: habZone(L),
          preview: (a2) => worldStats({ ...w, a: a2 }, s.worlds, L).T,
        },
        (factor) => {
          this.hold = Math.max(0, this.hold - 1);
          if (factor && Math.abs(factor - 1) > 1e-3) sim.migrate(w, factor, false);
          else if (factor === null) s.energy += COST.migrate;
          this.save();
        },
      );
    }
  }

  // ------------------------------------------------------------------ selection
  select(sel: Sel) {
    this.selected = sel;
    this.systemView.selected = typeof sel === 'number' ? sel : null;
    if (sel === null) {
      // The camera stays where it is: it only stops following.
      this.inspector.hide();
      this.unfollow();
    }
    this.panelT = 0;
  }

  /**
   * Centres the camera on a world (or the star) and keeps it there until the player moves the view.
   * `close` also zooms in on it; otherwise it only comes nearer when the view is far away.
   */
  focus(id: Sel, close = false) {
    this.follow = id;
    this.followFn = null;
    if (id === 'star' || id === null) {
      this.stage.goal.target.set(0, 0, 0);
      return;
    }
    const w = this.s?.worlds.find((x) => x.id === id);
    if (!w) return;
    const near = clamp(worldRadius(w) * 11 + 9, 12, 70);
    this.stage.goal.dist = close ? near : Math.min(this.stage.goal.dist, Math.max(near, 60));
  }

  /** Stop following anything (the view stays put). */
  private unfollow() {
    this.follow = null;
    this.followFn = null;
  }

  // ------------------------------------------------------------------ input
  private bindInput() {
    const c = this.stage.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.stage.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.formation && !this.toolActive) this.formation.pointer.valid = false;
      this.hud.tagEl.style.display = 'none';
    });
    c.addEventListener('dblclick', (e) => {
      if (!this.sim) return;
      const hit = this.pickWorld(e.clientX, e.clientY);
      if (hit !== null) {
        this.select(hit);
        this.focus(hit, true);
      }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      if (closeTopModal()) return;
      if (this.mode !== 'play') return;
      if (this.targeting) return this.setTargeting(null);
      if (this.selected !== null) return this.select(null);
      return this.pauseMenu();
    }
    if (this.mode !== 'play' || anyModal() || this.hold) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.setSpeed(this.settings.speed === 0 ? this.lastSpeed : 0);
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      if (this.formation) this.setTool((['gather', 'heat', 'cool', 'nudge'] as Tool[])[n - 1]);
      else if (this.sim) this.startAction((['flare', 'volcano', 'comets', 'migrate'] as Action[])[n - 1]);
    }
    if (e.key === 'p' || e.key === 'P') this.openProjects();
    if (e.key === 'c' || e.key === 'C') this.openChronicle();
    if (e.key === '+' || e.key === '=') this.stage.zoom(0.85);
    if (e.key === '-') this.stage.zoom(1.18);
    // Arrow keys slide the view across the system.
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      this.unfollow();
      const k = this.stage.dist * 0.06;
      this.stage.panScreen(a[0] * k, a[1] * k);
    }
  }

  private onDown(e: PointerEvent) {
    sound.start();
    const c = this.stage.canvas;
    try {
      c.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
    this.dragged = false;
    if (this.pointers.size === 2) {
      if (this.toolActive) this.formation?.pointerUp();
      this.toolActive = false;
      this.rotating = false;
      this.panning = false;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
      return;
    }
    if (this.mode !== 'play' || this.hold) {
      this.rotating = true;
      return;
    }
    // Secondary (or middle) button: look around in 3D. Primary: slide across the system.
    if (e.button === 2 || e.button === 1) {
      this.rotating = true;
      return;
    }
    if (this.formation) {
      const g = this.stage.groundPoint(e.clientX, e.clientY);
      if (g && Math.hypot(g.x, g.z) < 94) {
        this.formation.pointerDown(g.x, g.z);
        this.toolActive = true;
        if (this.formation.tool === 'heat' || this.formation.tool === 'cool') sound.whoosh();
      } else this.panning = true;
    } else if (this.sim) this.panning = true;
  }

  private onMove(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) this.dragged = true;
      if (this.pointers.size === 2 && this.pinch) {
        // Two fingers: pinch to zoom, twist to turn, slide up or down together to tilt.
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const my = (a.y + b.y) / 2;
        this.stage.zoom(this.pinch.d / Math.max(10, d));
        this.stage.goal.yaw += ang - this.pinch.a;
        this.stage.rotate(0, (my - this.pinch.my) * 0.5);
        this.pinch = { d, a: ang, my };
        return;
      }
      if (this.rotating) {
        this.stage.rotate(dx, dy);
        return;
      }
      if (this.panning && this.dragged) {
        this.unfollow();
        this.stage.pan(e.clientX - dx, e.clientY - dy, e.clientX, e.clientY);
        this.stage.canvas.style.cursor = 'grabbing';
        return;
      }
    }
    if (this.mode !== 'play') return;
    if (this.formation) {
      const g = this.stage.groundPoint(e.clientX, e.clientY);
      const valid = !!g && Math.hypot(g.x, g.z) < 94;
      if (g) this.formation.pointerMove(g.x, g.z, valid && (e.pointerType === 'mouse' || this.toolActive));
      this.hoverBody = !this.toolActive && g ? this.bodyAt(g.x, g.z) : null;
      this.showBodyTag(e.clientX, e.clientY);
    } else if (this.sim && e.pointerType === 'mouse') {
      const hit = this.targeting === 'flare' ? this.pickWorld(e.clientX, e.clientY) ?? (this.pickShip(e.clientX, e.clientY) ? -1 : null) : this.pickWorld(e.clientX, e.clientY);
      this.systemView.hovered = hit !== null && hit >= 0 ? hit : null;
      this.stage.canvas.style.cursor = hit !== null || this.pickStar(e.clientX, e.clientY) ? 'pointer' : this.targeting ? 'crosshair' : 'grab';
    }
  }

  private onUp(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.toolActive) {
      this.formation?.pointerUp();
      this.toolActive = false;
      if (e.pointerType !== 'mouse' && this.formation) this.formation.pointer.valid = false;
    }
    if (this.rotating && this.pointers.size === 0) this.rotating = false;
    if (this.pointers.size === 0) this.panning = false;
    if (!p || this.dragged || this.mode !== 'play' || this.hold) return;
    if (this.sim && p.button === 0) this.click(e.clientX, e.clientY);
    else if (this.formation && p.button === 0 && this.pickStar(e.clientX, e.clientY) && this.formation.tool === 'nudge') this.select('star');
  }

  private click(x: number, y: number) {
    const sim = this.sim!;
    if (this.targeting === 'flare') {
      const ship = this.pickShip(x, y);
      if (ship) {
        if (sim.flareShip(ship)) {
          const v = this.systemView.shipXYZ.get(ship.id) ?? new THREE.Vector3();
          this.star.flash();
          sound.flare();
          this.fx.beam(new THREE.Vector3(), () => v, 0xffa040, 2.5, 1.1);
          setTimeout(() => this.fx.flash(v.x, v.y, v.z, 0xd0a0ff, 6, 0.8), 400);
          this.setTargeting(null);
        }
        return;
      }
      const threat = this.pickThreat(x, y);
      if (threat !== null) {
        const w = sim.world(threat);
        if (w) this.doAction('flare', w);
        return;
      }
    }
    const hit = this.pickWorld(x, y);
    if (hit !== null) {
      const w = sim.world(hit)!;
      if (this.targeting) return this.doAction(this.targeting, w);
      sound.click();
      this.select(hit);
      this.focus(hit);
      return;
    }
    if (this.pickStar(x, y)) {
      this.select('star');
      this.focus('star');
      return;
    }
    if (!this.targeting) this.select(null);
  }

  private bodyAt(x: number, z: number) {
    let best: Body | null = null;
    let bd = Infinity;
    for (const b of this.formation?.bodies ?? []) {
      const w = toWorld(b.r);
      const d = Math.hypot(Math.cos(b.th) * w - x, Math.sin(b.th) * w - z);
      if (d < bodyRadius(b) + 2.2 && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private showBodyTag(cx: number, cy: number) {
    const b = this.hoverBody;
    const tag = this.hud.tagEl;
    this.bodiesView.hovered = b?.id ?? null;
    if (!b) {
      tag.style.display = 'none';
      return;
    }
    const m = massOf(b);
    const kind = isGiantStuff(b) ? tr('Gigante en formación', 'Forming giant') : m > 0.05 ? tr('Protoplaneta', 'Protoplanet') : tr('Planetesimal', 'Planetesimal');
    const pct = (v: number) => Math.round((v / m) * 100);
    tag.innerHTML = `<b>${kind}</b> · ${num(m, m < 0.01 ? 4 : m < 1 ? 3 : 1)} M⊕${b.moons.length ? ` · ${b.moons.length} ☾` : ''}<br><span class="muted">${tr('roca', 'rock')} ${pct(b.rock + b.metal)}% · ${tr('hielo', 'ice')} ${pct(b.water)}% · gas ${pct(b.gas)}%</span>`;
    tag.style.display = '';
    tag.style.left = `${cx}px`;
    tag.style.top = `${cy}px`;
  }

  private screen = { x: 0, y: 0, vis: false };
  private pickWorld(x: number, y: number): number | null {
    const s = this.s;
    if (!s) return null;
    let best: number | null = null;
    let bd = Infinity;
    for (const w of s.worlds) {
      const p = this.systemView.pos(w);
      const sp = this.stage.project(p.x, 0, p.z, this.screen);
      if (!sp.vis) continue;
      const rpx = worldRadius(w) / this.stage.pixelScale(p.x, 0, p.z);
      const d = Math.hypot(sp.x - x, sp.y - y);
      const lim = Math.max(w.parent === null ? 18 : 12, rpx + 8);
      if (d < lim && d / lim < bd) {
        bd = d / lim;
        best = w.id;
      }
    }
    return best;
  }

  private pickStar(x: number, y: number) {
    const sp = this.stage.project(0, 0, 0, this.screen);
    const rpx = this.star.radius / this.stage.pixelScale(0, 0, 0);
    return sp.vis && Math.hypot(sp.x - x, sp.y - y) < Math.max(24, rpx + 8);
  }

  private pickShip(x: number, y: number) {
    const s = this.s;
    if (!s) return null;
    for (const sh of s.ships) {
      if (!sh.alien) continue;
      const v = this.systemView.shipXYZ.get(sh.id);
      if (!v) continue;
      const sp = this.stage.project(v.x, v.y, v.z, this.screen);
      if (sp.vis && Math.hypot(sp.x - x, sp.y - y) < 22) return sh;
    }
    return null;
  }

  private pickThreat(x: number, y: number) {
    const s = this.s;
    if (!s) return null;
    for (const t of s.threats) {
      const v = this.systemView.threatPos3(t.id);
      if (!v) continue;
      const sp = this.stage.project(v.x, v.y, v.z, this.screen);
      if (sp.vis && Math.hypot(sp.x - x, sp.y - y) < 24) return t.target;
    }
    return null;
  }

  // ------------------------------------------------------------------ menus
  private pauseMenu() {
    if (this.mode !== 'play') return;
    this.hold++;
    modal(this.ui, {
      title: tr('Pausa', 'Paused'),
      lore: this.s ? this.s.name : undefined,
      body: [
        h(
          'div',
          { class: 'menu', style: 'margin:0 auto' },
          h('button', { class: 'btn', onclick: () => (closeTopModal(), this.s && chronicle(this.ui, this.s, this.hud)) }, tr('Crónica del sistema', 'System chronicle')),
          h('button', { class: 'btn', onclick: () => (closeTopModal(), howToPlay(this.ui)) }, tr('Cómo se juega', 'How to play')),
          h('button', { class: 'btn', onclick: () => (closeTopModal(), this.options()) }, tr('Opciones', 'Options')),
          h('button', { class: 'btn', onclick: () => (closeTopModal(), this.toTitle()) }, tr('Guardar y salir', 'Save and quit')),
        ),
      ],
      buttons: [{ label: tr('Seguir', 'Resume'), primary: true }],
      onClose: () => (this.hold = Math.max(0, this.hold - 1)),
    });
  }

  private options() {
    optionsDialog(this.ui, { ...this.settings }, {
      apply: (st) => {
        this.settings = st;
        saveSettings(st);
        sound.setVolumes(st.music, st.sfx);
        this.stage.setQuality(st.quality);
      },
      erase: () => {
        clearSave();
        this.s = null;
        this.toTitle(false);
      },
      lang: () => this.refreshLanguage(),
    });
  }

  private toTitle(save = true) {
    if (save) this.save();
    closeAllModals();
    this.hold = 0;
    this.s = null;
    this.hud.clearHints();
    this.hud.showBanner(null);
    this.title?.destroy();
    this.startTitle();
  }

  private victory() {
    const s = this.s!;
    // The ark carries every people of the system; the next one remembers them by the most advanced.
    const lead = this.sim?.peoples.leader();
    const sp = lead ? { name: lead.name, hue: lead.hue } : s.legacySpecies;
    if (!sp) return;
    const names = (s.peoples ?? []).filter((p) => !p.gone).map((p) => p.name);
    const many = names.length > 1;
    s.tutorials.victory = true;
    this.hold++;
    const reached = s.worlds.filter((w) => isSettled(w)).length;
    modal(this.ui, {
      title: tr('Hacia otras estrellas', 'To other stars'),
      cls: 'victory',
      body: [
        h('div', { class: 'big-glyph' }, '✧'),
        h(
          'p',
          { class: 'lore' },
          tr(
            many
              ? `Los pueblos de ${s.name} (${listOf(names, 'y')}) habitan cada rincón del sistema. Su arca ya surca la oscuridad entre las estrellas, llevando consigo un poco del polvo del que todos estamos hechos.`
              : `Los ${sp.name} habitan cada rincón de ${s.name}. Su arca ya surca la oscuridad entre las estrellas, llevando consigo un poco del polvo del que todos estamos hechos.`,
            many
              ? `The peoples of ${s.name} (${listOf(names.map(capName), 'and')}) live in every corner of the system. Their ark is already crossing the dark between the stars, carrying a little of the dust we are all made of.`
              : `The ${capName(sp.name)} live in every corner of ${s.name}. Their ark is already crossing the dark between the stars, carrying a little of the dust we are all made of.`,
          ),
        ),
        h(
          'div',
          { class: 'summary' },
          h('div', { class: 'w' }, h('span', null, '⌂'), h('span', null, tr('Mundos habitados', 'Worlds settled')), h('b', null, String(reached))),
          h('div', { class: 'w' }, h('span', null, '⧗'), h('span', null, tr('Edad del sistema', 'System age')), h('b', null, fmtAge(s.age))),
          h('div', { class: 'w' }, h('span', null, '✦'), h('span', null, tr('Sistemas alcanzados', 'Systems reached')), h('b', null, String(s.legacy + 1 + (s.stars?.length ?? 0)))),
        ),
      ],
      buttons: [
        { label: tr('Seguir contemplando', 'Keep watching') },
        {
          label: tr('Sembrar un nuevo sistema', 'Seed a new system'),
          primary: true,
          onClick: () => {
            const legacy = s.legacy + 1;
            setTimeout(() => this.newGame({ legacy, legacySpecies: sp, from: s.from }), 350);
          },
        },
      ],
      dismissable: false,
      onClose: () => (this.hold = Math.max(0, this.hold - 1)),
    });
  }

  private refreshLanguage() {
    this.hud.refreshLanguage();
    if (this.mode === 'title') this.title?.refresh(hasSave());
    this.panelT = 0;
    if (this.targeting) this.setTargeting(this.targeting);
    document.title = 'Dust We Are';
  }

  save() {
    const s = this.s;
    if (!s || this.mode !== 'play') return;
    if (this.formation) {
      s.disk = this.formation.save();
      s.bodies = this.formation.bodies;
    }
    saveState(s);
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    try {
      this.update(dt);
    } catch (err) {
      console.error(err);
    }
    this.stage.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  private update(dt: number) {
    const s = this.s;
    const speed = this.mode === 'play' && !this.hold && !anyModal() ? this.settings.speed : this.mode === 'title' ? 1 : 0;
    // Real time spent playing (the peoples' voices wait for a long game).
    if (s && this.mode === 'play' && speed > 0) s.playTime = (s.playTime ?? 0) + dt;
    const L = s ? s.L * s.dial : 1;
    // Simulation.
    if (this.mode === 'title' && this.demo) {
      this.demo.update(Math.min(dt, 1 / 30));
    } else if (s && this.formation) {
      let left = dt * speed;
      while (left > 1e-4) {
        const step = Math.min(left, 1 / 30);
        this.formation.update(step);
        left -= step;
      }
      s.time += dt * speed;
      s.age += dt * speed * 0.02;
      this.formation.onEvent = (e) => this.onFormationEvent(e);
      const f = this.formation;
      if (f.progress >= 0.97 && !this.settling) this.finishFormation();
      if (s.time > 22) this.hint('f.snow', '❄', () => tr('El anillo punteado es la <b>línea de nieve</b>: más allá, el hielo se suma a la roca y los cuerpos crecen deprisa. Allí nacen los gigantes.', 'The dotted ring is the <b>snow line</b>: beyond it, ice joins the rock and bodies grow fast. That is where giants are born.'));
      if (s.time > 45) this.hint('f.tools', '♨', () => tr('Prueba <b>Calentar</b> para empujar el gas y el polvo ligero hacia afuera, y <b>Enfriar</b> para que el polvo se condense en piedras nuevas.', 'Try <b>Heat</b> to push gas and light dust outwards, and <b>Cool</b> to make dust condense into new pebbles.'));
      if (s.time > 70) this.hint('f.hz', '❀', () => tr('La franja verde es la <b>zona habitable</b>: ahí un mundo rocoso podría tener mares de agua líquida.', 'The green band is the <b>habitable zone</b>: there a rocky world could have seas of liquid water.'));
      if (f.gasLeft < 0.45) this.hint('f.gas', '☁', () => tr('La luz de tu estrella está dispersando el gas. Los gigantes deben atraparlo antes de que se acabe.', 'Your star’s light is blowing the gas away. Giants must catch it before it runs out.'));
    } else if (s && this.sim) {
      let left = dt * speed;
      while (left > 1e-4) {
        const step = Math.min(left, 0.25);
        this.sim.update(step);
        left -= step;
      }
      if (s.threats.length) this.hint('s.threat', '☄', () => tr('Un asteroide se acerca. Una <b>llamarada</b> sobre el mundo amenazado, o sobre la roca misma, lo desvía.', 'An asteroid is approaching. A <b>flare</b> on the threatened world, or on the rock itself, deflects it.'));
      if (s.time > 110)
        this.hint('s.names', '✎', () =>
          tr(
            'Los nombres son tuyos: toca <b>✎</b> junto al nombre del sistema (arriba) o de cualquier mundo para ponerle el que quieras.',
            'The names are yours: tap <b>✎</b> next to the name of the system (top) or of any world to give it the one you like.',
          ),
        );
      if (s.time > 200) this.hint('s.star', '☀', () => tr('Toca la <b>estrella</b> para ajustar su brillo: más luz calienta tus mundos y recarga antes tu luz estelar.', 'Tap the <b>star</b> to adjust its brightness: more light warms your worlds and refills your starlight faster.'));
      if (s.won && !s.tutorials.victory && !this.hold) this.victory();
    }

    // Camera.
    if (this.followFn) {
      const v = this.followFn();
      this.stage.goal.target.set(v.x, v.y, v.z);
    } else if (this.follow !== null && this.follow !== 'star' && s) {
      const w = s.worlds.find((x) => x.id === this.follow);
      if (w) {
        const p = this.systemView.pos(w);
        this.stage.goal.target.set(p.x, 0, p.z);
      }
    }
    this.stage.update(dt);

    // Rendering.
    const young = !this.sim;
    this.star.update(dt, this.time, s ? s.dial * (0.9 + 0.1 * s.L) : 1, young);
    this.guides.opacity = this.mode === 'title' ? 0.35 : 1;
    this.guides.update(L, this.time, true);
    this.fx.update(dt);
    const activeF = this.formation ?? (this.mode === 'title' ? this.demo : null);
    if (activeF && this.disk) {
      activeF.L = L;
      this.disk.setScale(this.stage.renderer.domElement.height, this.stage.camera.fov);
      const nudging = activeF.nudging;
      this.disk.update(activeF, dt, this.time, this.mode === 'play', nudging ? nudging.target ?? nudging.r : null);
      this.bodiesView.update(activeF.bodies, L, dt, this.time);
    }
    if (s && this.sim) {
      this.systemView.setScale(this.stage.renderer.domElement.height, this.stage.camera.fov, this.stage.canvas.clientHeight || window.innerHeight);
      this.systemView.update(s, dt, this.time);
    }

    // Interface.
    this.labels.begin();
    if (this.mode === 'play' && s) {
      this.drawLabels(s, L);
      this.panelT -= dt;
      const rate = this.sim ? this.sim.energyRate : 0.85 * s.dial;
      if (this.formation) {
        const f = this.formation;
        const canSettle = f.progress >= 0.5 && f.bodies.some((b) => massOf(b) > 0.05);
        if (canSettle) this.hint('f.settle', '⊛', () => tr('Cuando quieras, pulsa <b>Asentar el sistema</b>. Lo que siga suelto formará cinturones de asteroides.', 'Whenever you like, press <b>Settle the system</b>. Whatever is still loose will become asteroid belts.'));
        this.hud.update(s, { progress: f.progress, gas: f.gasLeft, canSettle, energyRate: rate }, dt);
        if (this.panelT <= 0 && this.selected === 'star') {
          this.panelT = 0.5;
          this.inspector.showStar(s, rate);
        }
      } else if (this.sim) {
        const sim = this.sim;
        const all = s.worlds.filter(colonizable);
        const reached = all.filter((w) => w.colony >= 1 || (w.life?.origin && w.life.stage >= 2)).length;
        const reachedAll = all.filter((w) => isSettled(w) || (w.life?.origin && w.life.stage >= 2)).length;
        this.hud.update(
          s,
          { energyRate: rate, energyCap: sim.civ.energyCap, topStage: sim.topStage, living: s.worlds.filter((w) => w.life).length, reached: Math.max(reached, reachedAll), total: all.length, late: this.lateInfo() },
          dt,
        );
        const civ = s.civ;
        this.hud.showDecisions([...this.encounterViews(), ...(civ ? civ.decisions.map((d) => decisionView(d, s, sim.civ, sim)) : [])]);
        if (civ?.decisions.length) this.hint('s.decision', '⚖', () => tr('Llegan visitantes y te piden algo. Decide antes de que se acabe el tiempo; si no, se marchan.', 'Visitors arrive and ask you something. Decide before time runs out; otherwise they leave.'));
        if (civ && sim.civ.spacefaring)
          this.hint('s.works', '⚒', () =>
            tr(
              'Los pueblos ya pueden emprender <b>grandes obras</b>. Abre <b>Proyectos</b> (tecla P): cada tipo de mundo colonizado aporta un recurso distinto.',
              'The peoples can now take on <b>great works</b>. Open <b>Projects</b> (P key): each kind of settled world contributes a different resource.',
            ),
          );
        if (civ?.done.warp && !s.wings)
          this.hint('s.wingsTech', '✈', () =>
            tr(
              'Con el motor de curvatura ya puedes desarrollar las <b>Freedom Wings</b> en <b>Proyectos → Más allá del sistema</b>: escuadrillas de voluntarios, aparte de los Space Patrols, para defender las colonias lejanas.',
              'With the warp drive you can now develop the <b>Freedom Wings</b> in <b>Projects → Beyond the system</b>: volunteer squadrons, apart from the Space Patrols, to defend the distant colonies.',
            ),
          );
        if (s.wings)
          this.hint('s.wings', '✈', () =>
            tr(
              'Las <b>Freedom Wings</b> suman naves solas: más con cada mundo con vida y con la paz entre los pueblos (también se compran con ciencia, caras). Cuando una colonia lejana pida ayuda, elige el tamaño: <b>S</b> para riesgo bajo, <b>M</b> para medio y <b>L</b> para alto. Una flota chica contra un riesgo alto puede no volver.',
              'The <b>Freedom Wings</b> gather ships on their own: more with every living world and with peace between the peoples (they can also be bought with science, at a price). When a distant colony asks for help, pick the size: <b>S</b> for a low risk, <b>M</b> for medium and <b>L</b> for high. A small fleet against a high risk may never come back.',
            ),
          );
        if ((s.threat?.level ?? 1) >= 2)
          this.hint('s.danger', '⚠', () =>
            tr(
              'Tu sistema se hace fuerte, y eso se ve desde lejos: la <b>amenaza</b> (⚠ arriba a la derecha) sube con tus mundos, obras, tecnologías y colonias. Las invasiones llegarán antes y con más naves. Mejora la <b>flota</b>, los <b>escudos</b> y los <b>Space Patrols</b> en <b>Proyectos</b> para no quedarte atrás.',
              'Your system grows strong, and that can be seen from afar: the <b>threat</b> (⚠ top right) rises with your worlds, works, technologies and colonies. Invasions will come sooner and with more ships. Raise the <b>fleet</b>, the <b>shields</b> and the <b>Space Patrols</b> in <b>Projects</b> to keep up.',
            ),
          );
        if (s.stars?.length)
          this.hint('s.stars', '✦', () =>
            tr(
              'Un pueblo ya vive junto a <b>otra estrella</b>: la verás en el borde del mapa. Las colonias lejanas comercian y envían caravanas; si tienen problemas, pedirán ayuda. En <b>Proyectos → Más allá del sistema</b> puedes defenderlas o conquistarlas.',
              'A people now lives around <b>another star</b>: you will see it at the edge of the map. Distant colonies trade and send caravans; if they get into trouble, they will ask for help. In <b>Projects → Beyond the system</b> you can defend or conquer them.',
            ),
          );
        if (this.projects) {
          this.projectsT -= dt;
          if (this.projectsT <= 0) {
            this.projectsT = 0.3;
            this.projects.refresh();
          }
        }
        const afford: Record<string, { ok: boolean; afford: boolean }> = {};
        for (const a of ['flare', 'volcano', 'comets', 'migrate'] as Action[]) afford[a] = { ok: true, afford: s.energy >= COST[a] };
        this.hud.setActionState(afford);
        if (this.panelT <= 0) {
          this.panelT = 0.3;
          this.stats.clear();
          for (const w of s.worlds) this.stats.set(w.id, sim.stats(w));
          this.ledger.update(s, this.stats, typeof this.selected === 'number' ? this.selected : null);
          this.ledger.el.classList.toggle('behind', this.selected !== null);
          if (this.selected === 'star') this.inspector.showStar(s, rate);
          else if (typeof this.selected === 'number') {
            const w = sim.world(this.selected);
            if (w) this.inspector.showWorld(w, this.stats.get(w.id)!, s, w.parent !== null ? sim.world(w.parent) ?? null : null);
            else this.select(null);
          }
          sound.mood(clamp((sim.topStage + 1) / 6));
        }
      }
      this.saveT -= dt;
      if (this.saveT <= 0) {
        this.saveT = 10;
        this.save();
      }
    }
    this.labels.end();
  }

  /** Summary of the late game for the top slab (null before the civilization has an economy). */
  private lateInfo() {
    const s = this.s;
    const sim = this.sim;
    const civ = s?.civ;
    if (!s || !sim || !civ || !sim.civ.spacefaring) return null;
    const done = PROJECTS.filter((p) => civ.done[p.id]);
    const era = civ.done.warp ? (done.some((p) => p.era === 3) ? 3 : 2) : done.length ? 1 : 0;
    const b = civ.building;
    const def = b ? PROJECTS.find((p) => p.id === b.id) : null;
    const L = threatOf(s);
    const lv = { fleet: defLevel(s, 'fleet'), shield: defLevel(s, 'shield'), patrol: defLevel(s, 'patrol') };
    // A defence behind the threat that can be raised right now also lights the Projects button.
    const canBuild = PROJECTS.some((p) => !sim.civ.lock(p.id) && sim.civ.canAfford(p.cost)) || DEFENCES.some((id) => lv[id] && lv[id] < L && !sim.civ.defenceLock(id)) || !sim.wings.unlockLock();
    return {
      threat: L,
      def: lv,
      era: tr(ERA_NAMES[era].es, ERA_NAMES[era].en),
      label: def && b ? tr(`Construyendo: ${def.name.es} · ${Math.round((b.t / b.dur) * 100)} %`, `Building: ${def.name.en} · ${Math.round((b.t / b.dur) * 100)}%`) : tr(`Grandes obras ${done.length}/${PROJECTS.length}`, `Great works ${done.length}/${PROJECTS.length}`),
      v: b ? b.t / b.dur : done.length / PROJECTS.length,
      res: civ.res,
      rates: sim.civ.rates,
      canBuild,
    };
  }

  private projects: ProjectsPanel | null = null;
  private projectsT = 0;

  openProjects() {
    const sim = this.sim;
    if (!sim || !this.s?.civ || this.projects || this.mode !== 'play') return;
    sound.click();
    const panel = new ProjectsPanel(sim.civ, {
      start: (id) => {
        if (sim.civ.start(id)) sound.chime('good');
        panel.refresh();
      },
      expedition: () => {
        if (sim.civ.sendExpedition()) sound.whoosh();
        panel.refresh();
      },
      armada: () => {
        if (sim.civ.launchArmada()) sound.chime('good');
      },
      research: () => {
        if (sim.civ.startResearch()) sound.chime('good');
        panel.refresh();
      },
      send: (id, conquer) => {
        if (sim.patrols.send(id, conquer)) sound.warp();
        panel.refresh();
      },
      release: (id) => {
        if (sim.patrols.release(id)) sound.chime('good');
        panel.refresh();
      },
      fortify: (id) => {
        if (sim.patrols.fortify(id)) sound.chime('good');
        panel.refresh();
      },
      rename: (id) => this.rename({ star: id }),
      wing: (id, size) => {
        if (sim.wings.send(id, size)) sound.warp();
        panel.refresh();
      },
      unlockWings: () => {
        if (sim.wings.unlock()) sound.chime('good');
        panel.refresh();
      },
      buyWings: () => {
        if (sim.wings.buy()) sound.chime('good');
        panel.refresh();
      },
      upgrade: (id) => {
        if (sim.civ.upgrade(id)) sound.chime('good');
        panel.refresh();
      },
      close: () => {},
    }, sim.patrols, sim.wings);
    this.projects = panel;
    const close = modal(this.ui, {
      title: tr('Grandes obras', 'Great works'),
      lore: tr(
        'Tú inspiras; los pueblos construyen. Cada mundo aporta lo suyo: los gigantes, combustible; los helados, agua; los rocosos, metal; los mundos vivos, ciencia.',
        'You inspire; the peoples build. Each world contributes its own: giants give fuel, icy worlds water, rocky worlds metal, living worlds science.',
      ),
      wide: true,
      cls: 'works-modal',
      body: [panel.el],
      buttons: [{ label: tr('Cerrar', 'Close'), primary: true }],
      onClose: () => (this.projects = null),
    });
    panel.bindClose(close);
  }

  private drawLabels(s: GameState, L: number) {
    // Guides: names written on the rings, on the side facing the camera.
    const yaw = this.stage.yaw;
    const [a, b] = this.guides.hzRadii(L);
    const hr = (a + b) / 2;
    this.labels.put('g.hz', 'guide-label', tr('zona habitable', 'habitable zone'), Math.sin(yaw) * hr, 0, Math.cos(yaw) * hr);
    const sr = this.guides.snowRadius(L);
    this.labels.put('g.snow', 'guide-label snow', tr('línea de nieve', 'snow line'), Math.sin(yaw + 0.25) * sr, 0, Math.cos(yaw + 0.25) * sr);
    if (!this.sim) return;
    const near = this.stage.dist < 75;
    const byId = new Map(s.worlds.map((w) => [w.id, w]));
    const tmp = { x: 0, z: 0 };
    for (const w of s.worlds) {
      const moon = w.parent !== null;
      const sel = this.selected === w.id || this.systemView.hovered === w.id;
      if (moon && !near && !sel && this.selected !== w.parent) continue;
      worldXZ(w, byId, tmp);
      let f = '';
      if (w.life) f += '<span class="l">❦</span>';
      const pid = peopleOf(w);
      const pp = pid && w.colony >= 1 ? s.peoples?.find((x) => x.id === pid) : undefined;
      if (pp) f += `<span style="color:hsl(${Math.round(pp.hue * 360)} 70% 62%)">⌂</span>`;
      else if (w.colony >= 1 || w.guest) f += '<span class="c">⌂</span>';
      if (w.invaded > 0.3) f += '<span class="a">⚠</span>';
      const r = worldRadius(w);
      const px = r / this.stage.pixelScale(tmp.x, 0, tmp.z);
      this.labels.put(`w${w.id}`, `wlabel ${moon ? 'moon' : ''} ${sel ? 'sel' : ''}`, `${w.name}${f ? `<span class="f">${f}</span>` : ''}`, tmp.x, 0, tmp.z, px + 6);
    }
    // Colonies around other stars, on the sky in the direction their ships come and go.
    for (const st of s.stars ?? []) {
      const pp = s.peoples?.find((x) => x.id === st.people);
      const col = pp ? `hsl(${Math.round(pp.hue * 360)} 70% 68%)` : '#e8d2a0';
      const mark = st.mode === 'dominion' ? '⚑' : '✦';
      const html = `<i style="color:${col}">${mark}</i>${st.name}${st.fort ? `<b class="fort">♜${st.fort}</b>` : ''}${st.trouble ? '<b class="warn">⚠</b>' : ''}${st.strike ? '<b class="pt">⛨</b>' : ''}${st.wing ? '<b class="wg">✈</b>' : ''}`;
      this.labels.put(`st${st.id}`, `star-label ${st.mode}${st.trouble ? ' trouble' : ''}`, html, Math.cos(st.ang) * 96, 0, Math.sin(st.ang) * 96);
    }
    // The Space Patrols' battle barge.
    const pt = s.patrol;
    if (pt && pt.phase !== 'away') {
      const home = (this.sim?.patrols.homeCompanies() ?? 1);
      this.labels.put('barge', 'barge-label', `⛨ ${tr(pt.barge.es, pt.barge.en)}${home > 1 ? ` <small>×${home}</small>` : ''}`, pt.x, pt.y, pt.z, 36);
    }
  }
}

