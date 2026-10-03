import { getLang, setLang, tr, type Lang } from '../i18n';
import type { GameState, Settings } from '../core/state';
import { h, stone, ICONS, clear } from './dom';
import { modal, confirmBox } from './Modal';
import { fmtAge } from './text';
import type { Hud } from './Hud';

export const UIB_URL = 'https://dinover.github.io/UniverseIsBorn/';

export function howToPlay(host: HTMLElement) {
  const step = (n: string, title: string, text: string) => h('div', { class: 'step' }, h('div', { class: 'num' }, n), h('div', null, h('b', null, title), h('div', { html: text })));
  modal(host, {
    title: tr('Cómo se juega', 'How to play'),
    lore: tr('Somos polvo de estrellas. Este juego trata de devolverle al polvo su forma de mundo.', 'We are stardust. This game is about giving dust back its shape as worlds.'),
    wide: true,
    body: [
      h(
        'div',
        { class: 'howto' },
        step('I', tr('Reúne el polvo', 'Gather the dust'), tr('Tu estrella nace rodeada de un disco de gas, polvo y hielo. Mantén pulsado para juntar material en piedras; cada cuerpo barre su órbita y crece. Con <b>Empujar</b> puedes cambiar órbitas y provocar choques: así nacen los planetas y, a veces, sus lunas.', 'Your star is born inside a disk of gas, dust and ice. Hold to pull material into pebbles; each body sweeps its orbit and grows. With <b>Nudge</b> you can change orbits and cause collisions: that is how planets, and sometimes their moons, are born.')),
        step('II', tr('Da forma al disco', 'Shape the disk'), tr('<b>Calentar</b> aleja el gas y el polvo ligero; <b>Enfriar</b> calma el disco y hace nacer piedras. Más allá de la <b>línea de nieve</b> el hielo ayuda a crecer rápido: allí nacen los gigantes, si atrapan el gas antes de que la estrella lo disperse.', '<b>Heat</b> pushes gas and light dust away; <b>Cool</b> calms the disk and makes pebbles form. Beyond the <b>snow line</b> ice helps bodies grow fast: that is where giants are born, if they catch the gas before the star blows it away.')),
        step('III', tr('Haz habitable un mundo', 'Make a world habitable'), tr('Toca un mundo para ver qué le falta. Atrae <b>cometas</b> para darle agua, orgánicos, aire o hierro; despierta sus <b>volcanes</b>; o <b>migra</b> su órbita hacia la franja verde, la zona habitable.', 'Tap a world to see what it lacks. Bring in <b>comets</b> for water, organics, air or iron; wake its <b>volcanoes</b>; or <b>migrate</b> its orbit towards the green band, the habitable zone.')),
        step('IV', tr('Cuida la vida', 'Look after life'), tr('Cuando las condiciones son buenas, la vida aparece sola. Mantén su mundo estable: eras glaciales, calentamientos y asteroides pondrán todo a prueba. Una <b>llamarada</b> desvía asteroides.', 'When conditions are right, life appears on its own. Keep its world steady: ice ages, warming and asteroids will test it. A <b>flare</b> deflects asteroids.')),
        step('V', tr('Una civilización', 'A civilization'), tr('Tu especie viajará entre mundos, lanzará satélites y terraformará. Cada tipo de mundo aporta algo: los <b>gigantes</b> dan combustible, los <b>helados</b> agua, los <b>rocosos</b> metal y los <b>vivos</b> ciencia. Por eso conviene tener de todo, y alguna luna viva junto a un gigante vale el doble.', 'Your species will travel between worlds, launch satellites and terraform. Each kind of world gives something: <b>giants</b> give fuel, <b>icy</b> worlds water, <b>rocky</b> worlds metal and <b>living</b> worlds science. So it pays to have a bit of everything, and a living moon beside a giant is worth double.')),
        step('VI', tr('Hacia las estrellas', 'To the stars'), tr('Con esos recursos levanta <b>grandes obras</b> (ascensor espacial, escudos, flota, motor de curvatura, enjambre de Dyson), investiga tecnologías, envía expediciones y lanza la <b>armada</b> con un salto de curvatura. Llegarán mercaderes, refugiados, planetas errantes e invasores. Al final, el <b>arca estelar</b> sembrará otro sistema.', 'With those resources raise <b>great works</b> (space elevator, shields, fleet, warp drive, Dyson swarm), research technologies, send expeditions and launch the <b>armada</b> in a warp jump. Traders, refugees, wandering planets and invaders will come. In the end, the <b>star ark</b> will seed another system.')),
      ),
      h('p', { class: 'small muted', style: 'text-align:center;margin-top:14px', html: tr('Rueda o pellizco: zoom · Botón derecho o dos dedos: girar · Espacio: pausa · 1–4: herramientas · P: proyectos', 'Wheel or pinch: zoom · Right button or two fingers: rotate · Space: pause · 1–4: tools · P: projects') }),
    ],
    buttons: [{ label: tr('Entendido', 'Got it'), primary: true }],
  });
}

export function optionsDialog(host: HTMLElement, st: Settings, on: { apply(s: Settings): void; erase(): void; lang(): void }) {
  const seg = <T extends string | number>(opts: [T, string][], cur: T, set: (v: T) => void) => {
    const box = h('div', { class: 'seg' });
    const draw = (c: T) => {
      clear(box);
      for (const [v, label] of opts)
        box.append(
          h(
            'button',
            {
              class: `btn small ${v === c ? 'on' : ''}`,
              onclick: () => {
                set(v);
                draw(v);
              },
            },
            label,
          ),
        );
    };
    draw(cur);
    return box;
  };
  const slider = (v: number, set: (v: number) => void) => {
    const s = h('input', { type: 'range', min: '0', max: '100', step: '1', style: 'width:160px' }) as HTMLInputElement;
    s.value = String(Math.round(v * 100));
    s.addEventListener('input', () => set(Number(s.value) / 100));
    return s;
  };
  const row = (label: string, ctrl: HTMLElement) => h('div', { class: 'opt-row' }, h('label', null, label), ctrl);
  const close = modal(host, {
    title: tr('Opciones', 'Options'),
    body: [
      row(
        tr('Idioma', 'Language'),
        seg<Lang>(
          [
            ['es', 'Español'],
            ['en', 'English'],
          ],
          getLang(),
          (l) => {
            setLang(l);
            on.lang();
            close();
            optionsDialog(host, st, on);
          },
        ),
      ),
      row(tr('Música', 'Music'), slider(st.music, (v) => on.apply({ ...st, music: (st.music = v) }))),
      row(tr('Efectos', 'Sound effects'), slider(st.sfx, (v) => on.apply({ ...st, sfx: (st.sfx = v) }))),
      row(
        tr('Calidad gráfica', 'Graphics quality'),
        seg<'low' | 'high'>(
          [
            ['low', tr('Ligera', 'Light')],
            ['high', tr('Alta', 'High')],
          ],
          st.quality,
          (q) => on.apply({ ...st, quality: (st.quality = q) }),
        ),
      ),
      h('p', { class: 'small muted', style: 'text-align:center' }, tr('La calidad completa se aplica al volver a abrir el juego.', 'Full quality changes apply the next time you open the game.')),
      h(
        'div',
        { style: 'text-align:center;margin-top:12px' },
        h(
          'button',
          {
            class: 'btn small ghost',
            onclick: () => confirmBox(host, tr('Borrar partida', 'Erase game'), tr('Tu sistema y todo lo que vive en él se perderán para siempre.', 'Your system and everything living in it will be lost forever.'), tr('Borrar', 'Erase'), () => {
              close();
              on.erase();
            }),
          },
          tr('Borrar partida guardada', 'Erase saved game'),
        ),
      ),
    ],
    buttons: [{ label: tr('Listo', 'Done'), primary: true }],
  });
}

export function chronicle(host: HTMLElement, s: GameState, hud: Hud) {
  const list = h('div', { class: 'chron' });
  const items = [...s.news].reverse();
  if (!items.length) list.append(h('p', { class: 'muted', style: 'text-align:center' }, tr('Todavía no ha pasado nada digno de contarse.', 'Nothing worth telling has happened yet.')));
  for (const n of items) list.append(hud.newsItem(n, fmtAge(n.age)));
  modal(host, { title: tr('Crónica del sistema', 'System chronicle'), wide: true, body: [list], buttons: [{ label: tr('Cerrar', 'Close'), primary: true }] });
}

/** Title screen with drifting dust motes. */
export class TitleScreen {
  el: HTMLElement;
  private motes: HTMLCanvasElement;
  private raf = 0;

  constructor(
    private host: HTMLElement,
    private o: { hasSave: boolean; fromUib: boolean; legacy: GameState['legacySpecies']; onContinue(): void; onNew(): void; onHowTo(): void; onOptions(): void; onLang(): void },
  ) {
    this.motes = h('canvas', { class: 'motes' }) as HTMLCanvasElement;
    this.el = h('div', { class: 'title-screen' });
    this.build();
    host.append(this.el);
    this.animate();
  }

  private build() {
    clear(this.el);
    const o = this.o;
    this.el.append(this.motes);
    this.el.append(h('div', { class: 'emblem', html: ICONS.emblem }));
    this.el.append(h('h1', { class: 'game-title', 'data-text': 'DUST WE ARE' }, 'DUST WE ARE'));
    this.el.append(h('p', { class: 'tagline' }, tr('Somos polvo de estrellas. Devuélvele su forma de mundo.', 'We are stardust. Give it back its shape as worlds.')));
    if (o.fromUib)
      this.el.append(
        stone(
          'origin-note',
          h('div', {
            html: tr(
              'Tu <b class="gold">nebulosa planetaria</b> devolvió al espacio el polvo de una estrella antigua. De ese polvo nace ahora una estrella nueva, envuelta en un disco donde esperan los mundos.',
              'Your <b class="gold">planetary nebula</b> returned the dust of an old star to space. From that dust a new star is now born, wrapped in a disk where worlds are waiting.',
            ),
          }),
        ),
      );
    const menu = h('div', { class: 'menu' });
    if (o.hasSave) menu.append(h('button', { class: 'btn primary', onclick: () => o.onContinue() }, tr('Continuar', 'Continue')));
    menu.append(h('button', { class: `btn ${o.hasSave ? '' : 'primary'}`, onclick: () => o.onNew() }, tr('Nuevo sistema', 'New system')));
    menu.append(h('button', { class: 'btn', onclick: () => o.onHowTo() }, tr('Cómo se juega', 'How to play')));
    menu.append(h('button', { class: 'btn', onclick: () => o.onOptions() }, tr('Opciones', 'Options')));
    this.el.append(menu);
    const lang = stone(
      'lang',
      ...(['es', 'en'] as Lang[]).map((l) =>
        h(
          'button',
          {
            class: `btn small ${getLang() === l ? 'on' : ''}`,
            onclick: () => {
              setLang(l);
              o.onLang();
              this.build();
            },
          },
          l.toUpperCase(),
        ),
      ),
    );
    const back = h('a', { class: 'uib-link', href: `${UIB_URL}?lang=${getLang()}` }, o.fromUib ? tr('← Volver a Universe is Born', '← Back to Universe is Born') : tr('Del creador de Universe is Born', 'From the maker of Universe is Born'));
    this.el.append(h('div', { class: 'title-foot' }, lang, back));
  }

  refresh(hasSave: boolean) {
    this.o.hasSave = hasSave;
    this.build();
  }

  private animate() {
    const c = this.motes;
    const g = c.getContext('2d');
    if (!g) return;
    const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.8, v: 0.004 + Math.random() * 0.012, p: Math.random() * 6.28 }));
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = (c.width = c.clientWidth);
      const hh = (c.height = c.clientHeight);
      g.clearRect(0, 0, w, hh);
      for (const m of motes) {
        m.y -= m.v * dt * 3;
        m.x += Math.sin(now / 3000 + m.p) * 0.0004;
        if (m.y < -0.02) {
          m.y = 1.02;
          m.x = Math.random();
        }
        const a = 0.35 + 0.35 * Math.sin(now / 900 + m.p * 3);
        g.fillStyle = `rgba(255, ${200 + Math.round(m.s * 20)}, 140, ${a})`;
        g.shadowColor = 'rgba(255,170,80,.8)';
        g.shadowBlur = 6;
        g.beginPath();
        g.arc(m.x * w, m.y * hh, m.s, 0, Math.PI * 2);
        g.fill();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.style.transition = 'opacity .8s';
    this.el.style.opacity = '0';
    setTimeout(() => this.el.remove(), 800);
  }
}

