import { getLang, setLang, tr, type Lang } from '../i18n';
import { SPREAD_MAX, SPREAD_MIN, type GameState, type Settings } from '../core/state';
import { h, stone, ICONS, clear } from './dom';
import { modal, confirmBox } from './Modal';
import { fmtAge } from './text';
import type { Hud } from './Hud';

export const UIB_URL = 'https://dinover.github.io/UniverseIsBorn/';

/** One page of "How to play": an icon, a title and its text (HTML). */
interface HowPage {
  icon: string;
  title: string;
  text: string;
}

function howPages(): HowPage[] {
  const keys = (rows: [string, string][]) => `<dl class="howto-keys">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  return [
    {
      icon: '✺',
      title: tr('Formación', 'Formation'),
      text: tr(
        'Tu estrella nace rodeada de un disco de gas, polvo y hielo. Mantén pulsado para <b>juntar</b> material en piedras; cada cuerpo barre su órbita y crece. Con <b>Empujar</b> cambias órbitas y provocas choques: así nacen los planetas y, a veces, sus lunas.<br><br><b>Calentar</b> aleja el gas y el polvo ligero; <b>Enfriar</b> calma el disco y hace nacer piedras. Más allá de la <b>línea de nieve</b> el hielo ayuda a crecer rápido: allí nacen los gigantes, si atrapan el gas antes de que la estrella lo disperse. Cuando el disco esté listo, <b>asienta</b> el sistema.<br><br>Desde el segundo sistema, la estrella puede ser una <b>enana naranja</b> (más tenue, pero la vida aparece antes), una <b>estrella amarilla</b> como el Sol o una <b>blanco-amarilla</b> (más luz estelar, pero su viento arranca antes el aire de los mundos).',
        'Your star is born inside a disk of gas, dust and ice. Hold to <b>gather</b> material into pebbles; each body sweeps its orbit and grows. With <b>Nudge</b> you change orbits and cause collisions: that is how planets, and sometimes their moons, are born.<br><br><b>Heat</b> pushes gas and light dust away; <b>Cool</b> calms the disk and makes pebbles form. Beyond the <b>snow line</b> ice helps bodies grow fast: that is where giants are born, if they catch the gas before the star blows it away. When the disk is ready, <b>settle</b> the system.<br><br>From the second system on, the star may be an <b>orange dwarf</b> (dimmer, but life appears sooner), a <b>yellow star</b> like the Sun or a <b>yellow-white</b> one (more starlight, but its wind strips the worlds’ air sooner).',
      ),
    },
    {
      icon: '◍',
      title: tr('Mundos habitables', 'Habitable worlds'),
      text: tr(
        'Toca un mundo para ver qué le falta. Atrae <b>cometas</b> para darle agua, orgánicos, aire o hierro; despierta sus <b>volcanes</b>; o <b>migra</b> su órbita hacia la franja verde, la zona habitable. El brillo de la estrella (toca la estrella) también calienta o enfría todos los mundos.<br><br>Cada planeta domina una <b>franja</b> alrededor de su órbita, más ancha cuanto más masivo es. Un mundo más ligero que quede dentro no puede quedarse: <b>choca</b> con él o, si es mucho más pequeño (un enano, por ejemplo), acaba <b>orbitándolo como una luna</b>. Al elegir un planeta para <b>Migrar</b>, el mapa marca en verde dónde su órbita sería estable y en brasa la zona de sus vecinos, y el minijuego dice en vivo si la órbita nueva aguanta; con el <b>empuje fino</b> (tecla F) cada empuje mueve la órbita muy poco, para afinar. Una órbita estable se anuncia con un anillo verde.<br><br>Si el mapa se ve apretado o demasiado disperso, ajusta la <b>distancia entre mundos</b> en Opciones: solo cambia la vista.',
        'Tap a world to see what it lacks. Bring in <b>comets</b> for water, organics, air or iron; wake its <b>volcanoes</b>; or <b>migrate</b> its orbit towards the green band, the habitable zone. The star’s brightness (tap the star) also warms or cools every world.<br><br>Every planet rules a <b>band</b> around its orbit, wider the more massive it is. A lighter world inside it cannot stay: it <b>crashes</b> into it or, if it is much smaller (a dwarf, say), ends up <b>orbiting it as a moon</b>. When you choose a planet to <b>Migrate</b>, the map shows in green where its orbit would be stable and in ember its neighbours’ reach, and the minigame tells you live whether the new orbit will hold; with the <b>fine push</b> (F key) each push moves the orbit only a little, to fine-tune it. A stable orbit is announced with a green ring.<br><br>If the map looks cramped or too spread out, set the <b>distance between worlds</b> in Options: it only changes the view.',
      ),
    },
    {
      icon: '❦',
      title: tr('Vida y población', 'Life and population'),
      text: tr(
        'Cuando las condiciones son buenas, la vida aparece sola y avanza por etapas: vida microbiana, vida compleja, inteligencia, civilización, era espacial y era interplanetaria. Mantén su mundo estable: eras glaciales, calentamientos y asteroides lo pondrán todo a prueba. Una <b>llamarada</b> desvía asteroides.<br><br>Cada mundo cuenta su <b>población</b>. Catástrofes, guerras, plagas e invasores la diezman, y vuelve a crecer despacio hasta lo que el mundo puede alimentar. Un pueblo que cae demasiado bajo <b>retrocede una etapa</b>; uno que se queda sin nadie se <b>extingue</b>.<br><br>Cuando una catástrofe los golpea, a veces un pueblo <b>reza</b> por algo concreto: calor, frescor o que desvíes una roca. Si lo haces a tiempo, creerán más en la estrella.',
        'When conditions are right, life appears on its own and moves up through stages: microbial life, complex life, intelligence, civilization, space age and interplanetary age. Keep its world steady: ice ages, warming and asteroids will test everything. A <b>flare</b> deflects asteroids.<br><br>Every world counts its <b>population</b>. Catastrophes, wars, plagues and invaders thin it out, and it slowly grows back to what the world can feed. A people that falls too low <b>falls back a stage</b>; one left with nobody <b>dies out</b>.<br><br>When a catastrophe strikes, a people sometimes <b>prays</b> for something concrete: warmth, coolness or for you to turn a rock aside. Do it in time and they will believe in the star more.',
      ),
    },
    {
      icon: '⚑',
      title: tr('Pueblos y uso de los mundos', 'Peoples and their worlds'),
      text: tr(
        'No eres ningún pueblo: eres quien los observa a todos, como a un hormiguero. Cada mundo vivo puede dar su propio pueblo; viajan entre mundos, comercian, se mezclan, se alían y a veces se declaran la guerra, por su cuenta. Cuando la tensión crece puedes intervenir con la luz de la estrella… o dejarlos ser. Si no decides a tiempo, la respuesta es «no».<br><br>Cada pueblo tiene su carácter (científico, industrial, guerrero o mercader) y hace de cada mundo lo que le conviene. Solo terraforma los que valen la pena: los <b>jardines</b> ☘ (ciencia). El resto son <b>pueblos mineros</b> ⛏ (metal, mejor en mundos calientes o metálicos), <b>pozos de hielo</b> ❄ (agua y algo de combustible), <b>puestos de investigación</b> ⚗ (ciencia) o <b>fortalezas</b> ♜ (algo de metal, y disparan a los invasores); los gigantes llevan <b>ciudades flotantes</b> ◍ (combustible). Con el tiempo, el sistema cambia de cara según quién lo habite.',
        'You are no people: you watch over them all, like an ant farm. Every living world may give rise to its own people; they travel between worlds, trade, blend, ally and sometimes go to war, on their own. When tension grows you may step in with the light of the star… or let them be. If you do not decide in time, the answer is “no”.<br><br>Each people has its character (scholarly, industrious, warlike or mercantile) and makes of each world what suits it. They only terraform the worlds worth it: <b>gardens</b> ☘ (science). The rest become <b>mining towns</b> ⛏ (metal, best on hot or metal-rich worlds), <b>ice wells</b> ❄ (water and a little fuel), <b>research outposts</b> ⚗ (science) or <b>fortresses</b> ♜ (a little metal, and they shoot at invaders); giants carry <b>floating cities</b> ◍ (fuel). Over time, the system changes its face according to who lives there.',
      ),
    },
    {
      icon: '❧',
      title: tr('Nativos', 'Natives'),
      text: tr(
        'La vida también puede nacer en un mundo ya colonizado, si tiene las condiciones. Entonces nativos y colonos comparten el mundo, y lo que hacen los colonos (sobre todo las minas y las fortalezas) los arrincona.<br><br>La estrella decide: <b>protegerlos</b> (☀ 15: una reserva, y creerán en ti), dejar que <b>convivan</b> como puedan, o dejar que los <b>exterminen</b> (los colonos ganan metal y crecen más rápido, pero los pueblos lo recuerdan).<br><br>Si los nativos sobreviven hasta construir ciudades, <b>recuperarán su mundo</b>… o <b>se mezclarán</b> con los colonos.',
        'Life can also arise on a world already settled, if it has the conditions. Then natives and settlers share the world, and what the settlers do there (above all mines and fortresses) pushes the natives aside.<br><br>The star decides: <b>protect them</b> (☀ 15: a reserve, and they will believe in you), let them <b>get along</b> as best they can, or let them be <b>wiped out</b> (the settlers gain metal and grow faster, but the peoples will remember).<br><br>If the natives survive to build cities, they will <b>take their world back</b>… or <b>blend</b> with the settlers.',
      ),
    },
    {
      icon: '⚒',
      title: tr('Grandes obras y economía', 'Great works and economy'),
      text: tr(
        'En <b>Proyectos</b> (P) inspiras lo que los pueblos construyen: <b>grandes obras</b> (ascensor espacial, escudos, flota, motor de curvatura, enjambre de Dyson…), <b>investigación</b> (cada tecnología, +10 % de producción), <b>expediciones</b> a otras estrellas y la <b>armada</b>. Una obra empieza con el <b>25 %</b> de su coste y el resto se paga mientras se construye: si faltan recursos, se detiene hasta que lleguen.<br><br>Los recursos (⛏ metal, ◍ combustible, ❄ agua, ✦ ciencia) salen de lo que cada pueblo hace de sus mundos. Si falta combustible, la estrella puede <b>condensar</b> su luz desde su panel (☀ 25 → ◍ 30).<br><br>Las obras y las tecnologías hacen crecer la <b>amenaza</b>: cada tarjeta avisa cuánto antes de empezarla.',
        'In <b>Projects</b> (P) you inspire what the peoples build: <b>great works</b> (space elevator, shields, fleet, warp drive, Dyson swarm…), <b>research</b> (each technology, +10% output), <b>expeditions</b> to other stars and the <b>armada</b>. A work starts with <b>25%</b> of its cost and the rest is paid while it is built: if resources run short, it stops until they come.<br><br>Resources (⛏ metal, ◍ fuel, ❄ water, ✦ science) come from what each people makes of its worlds. If fuel runs short, the star can <b>condense</b> its light from its panel (☀ 25 → ◍ 30).<br><br>Works and technologies raise the <b>threat</b>: each card tells you by how much before you start it.',
      ),
    },
    {
      icon: '⚠',
      title: tr('Amenaza e invasiones', 'Threat and invasions'),
      text: tr(
        'Cuanto más fuerte es el sistema, más alta la <b>amenaza</b> (⚠): la suben los mundos habitados, las grandes obras, las tecnologías y las colonias lejanas. Las invasiones empiezan cuando un pueblo llega a la era espacial, cuando terminas la primera gran obra o, como muy tarde, a los 25 minutos de asentar el sistema.<br><br>Con la amenaza alta, las invasiones llegan antes y con más naves; y cuantos más mundos y recursos acumules, más grandes son las oleadas: llegan <b>saqueadores</b> que roban tus reservas y <b>bombarderos</b> que queman ciudades. Tus llamaradas también los derriban.<br><br>Defiéndete en <b>Proyectos → Defensa</b>: la <b>flota</b> intercepta naves, los <b>escudos</b> paran asteroides y frenan desembarcos, y los <b>Space Patrols</b> lanzan cápsulas y disparan su lanza. Las <b>fortalezas</b> y las <b>Freedom Wings</b> derriban saqueadores y bombarderos.',
        'The stronger the system, the higher the <b>threat</b> (⚠): settled worlds, great works, technologies and distant colonies all raise it. Invasions begin when a people reaches the space age, when you finish the first great work or, at the latest, 25 minutes after the system is settled.<br><br>With a high threat, invasions come sooner and with more ships; and the more worlds and resources you pile up, the bigger the waves: <b>looters</b> come to steal your stores and <b>bombers</b> to burn cities. Your flares shoot them down too.<br><br>Defend yourself in <b>Projects → Defence</b>: the <b>fleet</b> intercepts ships, <b>shields</b> stop asteroids and slow down landings, and the <b>Space Patrols</b> drop pods and fire their lance. <b>Fortresses</b> and the <b>Freedom Wings</b> shoot down looters and bombers.',
      ),
    },
    {
      icon: '✶',
      title: tr('Más allá del sistema', 'Beyond the system'),
      text: tr(
        'Los pueblos fundarán colonias junto a <b>otras estrellas</b>. Si piden ayuda, envía a los <b>Space Patrols</b> (una compañía basta para un riesgo bajo o medio; dos para uno alto; con la amenaza alta pueden volver con bajas) o a las <b>Freedom Wings</b> en escuadrillas S, M o L. Puedes <b>conquistarlas</b>: los dominios pagan más que el comercio, pero atraen enemigos. Cada colonia puede <b>fortificarse</b>: sufre menos ataques y más leves.<br><br>Al final, el <b>arca estelar</b> sembrará otro sistema. Necesita el motor de curvatura, todos los mundos colonizables habitados, ninguna guerra y ninguna otra obra en marcha (su tarjeta lo marca). Al partir, eliges un <b>legado</b> para el sistema siguiente: <b>Memoria de la fe</b>, <b>Polvo fértil</b> o una <b>Reliquia de los Precursores</b>.',
        'The peoples will found colonies around <b>other stars</b>. If they ask for help, send the <b>Space Patrols</b> (one company is enough for a low or medium risk, two for a high one; with a high threat they may come back with losses) or the <b>Freedom Wings</b> in S, M or L squadrons. You can <b>conquer</b> them: dominions pay more than trade, but they attract enemies. Each colony can be <b>fortified</b>: it suffers fewer and milder attacks.<br><br>In the end, the <b>star ark</b> will seed another system. It needs the warp drive, every colonizable world settled, no wars and no other work under way (its card ticks them off). When it leaves, you choose an <b>heirloom</b> for the next system: <b>Memory of faith</b>, <b>Fertile dust</b> or a <b>Relic of the Precursors</b>.',
      ),
    },
    {
      icon: '❂',
      title: tr('Fe, Bendición e Ira', 'Faith, Blessing and Wrath'),
      text: tr(
        'Si prefieres ser amado, la <b>Bendición</b> (6) cura y calma un mundo. Los pueblos que la estrella salva, bendice y escucha <b>creen en ella</b>; su <b>fe</b> sube por niveles y te da más luz estelar, más capacidad de luz y acciones más baratas.<br><br>Si quieres ser temido, la <b>Ira</b> (5) desata plagas, lluvias de meteoritos, inviernos sin fin, discordia u ofrendas. La crueldad no borra la fe: la vuelve <b>miedo</b>, que también aviva tu luz. Pero los pueblos lo recuerdan.<br><br>Cuando muchos crean por amor y dos pueblos la veneren juntos, fundarán la <b>Orden de la Estrella</b>: leerá los cielos, excavará en las lunas las <b>reliquias de los Precursores</b> y con ellas forjará los <b>Space Patrols</b>. Si antes los invasores dominan varios mundos, los pueblos los fundan de urgencia, pero sin reliquias no pasan de dos compañías.',
        'If you would rather be loved, the <b>Blessing</b> (6) heals and calms a world. The peoples the star saves, blesses and listens to <b>believe in it</b>; their <b>faith</b> rises through levels and brings more starlight, a larger store of light and cheaper actions.<br><br>If you want to be feared, <b>Wrath</b> (5) unleashes plagues, meteor storms, endless winters, discord or offerings. Cruelty does not erase faith: it turns it into <b>fear</b>, which also feeds your light. But the peoples remember.<br><br>When many believe out of love and two peoples worship together, they will found the <b>Order of the Star</b>: it will read the heavens, dig up the <b>Precursors’ relics</b> on the moons and with them forge the <b>Space Patrols</b>. If invaders hold several worlds first, the peoples raise them in a hurry, but without relics they cannot grow past two companies.',
      ),
    },
    {
      icon: '⌨',
      title: tr('Controles', 'Controls'),
      text: keys([
        [tr('Arrastrar · flechas', 'Drag · arrows'), tr('Moverse por el sistema (botón izquierdo o un dedo)', 'Move around the system (left button or one finger)')],
        [tr('Botón derecho · dos dedos', 'Right button · two fingers'), tr('Girar y mirar alrededor', 'Turn and look around')],
        [tr('Rueda · pellizco · + −', 'Wheel · pinch · + −'), tr('Zoom', 'Zoom')],
        [tr('Clic en un mundo', 'Click a world'), tr('Centrarlo y seguirlo (también la estrella)', 'Centre and follow it (the star too)')],
        [tr('Espacio', 'Space'), tr('Pausa', 'Pause')],
        ['1–4', tr('En la formación: juntar, calentar, enfriar, empujar', 'During formation: gather, heat, cool, nudge')],
        ['1–6', tr('Con el sistema asentado: llamarada, volcán, cometas, migrar, ira, bendición', 'Once the system is settled: flare, volcano, comets, migrate, wrath, blessing')],
        ['P', tr('Proyectos (toca ⚠ para ir directo a Defensa; la línea de fe abre La fe)', 'Projects (tap ⚠ to go straight to Defence; the faith line opens Faith)')],
        ['C', tr('Crónica: toca un suceso con ◎ para ir a verlo', 'Chronicle: tap an event marked ◎ to go and see it')],
        ['Esc', tr('Cerrar una ventana, soltar una herramienta o abrir el menú', 'Close a window, drop a tool or open the menu')],
        [tr('Opciones', 'Options'), tr('Idioma, sonido, calidad y distancia entre mundos', 'Language, sound, quality and distance between worlds')],
      ]),
    },
  ];
}

export function howToPlay(host: HTMLElement) {
  const pages = howPages();
  let at = 0;
  const page = h('div', { class: 'howto-page' });
  const dots = h('div', { class: 'howto-dots' });
  const dotEls = pages.map((p, i) => {
    const d = h('button', { class: 'howto-dot', 'aria-label': p.title, 'data-tip': p.title, onclick: () => go(i) }) as HTMLButtonElement;
    dots.append(d);
    return d;
  });
  const prev = h('button', { class: 'btn small', onclick: () => go(at - 1) }, `← ${tr('Anterior', 'Previous')}`) as HTMLButtonElement;
  const next = h('button', { class: 'btn small', onclick: () => go(at + 1) }, `${tr('Siguiente', 'Next')} →`) as HTMLButtonElement;
  const go = (i: number) => {
    at = Math.max(0, Math.min(pages.length - 1, i));
    const p = pages[at];
    clear(page);
    page.append(
      h('div', { class: 'step' }, h('div', { class: 'num' }, p.icon), h('div', null, h('div', { class: 'howto-count small muted' }, `${at + 1} / ${pages.length}`), h('b', null, p.title))),
      h('div', { class: 'howto-text', html: p.text }),
    );
    dotEls.forEach((d, j) => d.classList.toggle('on', j === at));
    prev.disabled = at === 0;
    next.disabled = at === pages.length - 1;
  };
  go(0);
  // The page area is as tall as the tallest page, so the buttons below never jump.
  const fit = () => {
    if (!page.isConnected) return;
    let tallest = 0;
    page.style.minHeight = '';
    for (let i = 0; i < pages.length; i++) {
      go(i);
      tallest = Math.max(tallest, page.offsetHeight);
    }
    page.style.minHeight = `${tallest}px`;
    go(0);
  };
  requestAnimationFrame(fit);
  // ← → turn the pages while the dialog is open.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') go(at - 1);
    else if (e.key === 'ArrowRight') go(at + 1);
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  modal(host, {
    title: tr('Cómo se juega', 'How to play'),
    lore: tr('Somos polvo de estrellas. Este juego trata de devolverle al polvo su forma de mundo.', 'We are stardust. This game is about giving dust back its shape as worlds.'),
    wide: true,
    body: [h('div', { class: 'howto' }, page, h('div', { class: 'howto-nav' }, prev, dots, next))],
    buttons: [{ label: tr('Entendido', 'Got it'), primary: true }],
    onClose: () => window.removeEventListener('keydown', onKey),
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
    // The value is shown beside it.
    const out = h('output', { class: 'small muted' }, `${s.value} %`);
    s.addEventListener('input', () => {
      set(Number(s.value) / 100);
      out.textContent = `${s.value} %`;
    });
    return h('div', { class: 'spread-ctrl' }, s, out);
  };
  let ids = 0;
  // Each label belongs to its control; a group of buttons is a radio group named by its label.
  const row = (label: string, ctrl: HTMLElement) => {
    const input = (ctrl.matches('input') ? ctrl : ctrl.querySelector('input')) as HTMLInputElement | null;
    const id = `opt-${++ids}`;
    if (input) input.id = id;
    else {
      ctrl.setAttribute('role', 'radiogroup');
      ctrl.setAttribute('aria-label', label);
    }
    return h('div', { class: 'opt-row' }, h('label', input ? { for: id } : null, label), ctrl);
  };
  // One slider for planets and moons alike: left brings them together, right spreads them apart.
  const spread = () => {
    const s = h('input', { type: 'range', min: String(SPREAD_MIN * 100), max: String(SPREAD_MAX * 100), step: '5', style: 'width:160px' }) as HTMLInputElement;
    s.value = String(Math.round(st.spread * 100));
    s.addEventListener('input', () => on.apply({ ...st, spread: (st.spread = Number(s.value) / 100) }));
    return h('div', { class: 'spread-ctrl' }, h('small', { class: 'muted' }, tr('juntos', 'close')), s, h('small', { class: 'muted' }, tr('separados', 'apart')));
  };
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
      h('p', { class: 'small muted opt-help' }, tr('La calidad completa se aplica al volver a abrir el juego.', 'Full quality changes apply the next time you open the game.')),
      row(tr('Distancia entre mundos', 'Distance between worlds'), spread()),
      h('p', { class: 'small muted opt-help' }, tr('Acerca o aleja los planetas y sus lunas en el mapa del sistema. Solo cambia la vista: la partida sigue igual.', 'Brings the planets and their moons closer together or farther apart on the system map. It only changes the view: the game plays the same.')),
      h(
        'div',
        { style: 'text-align:center;margin-top:12px' },
        h(
          'button',
          {
            class: 'btn small danger',
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

export function chronicle(host: HTMLElement, s: GameState, hud: Hud, go?: (n: GameState['news'][number]) => boolean) {
  const list = h('div', { class: 'chron' });
  const items = [...s.news].reverse();
  if (!items.length) list.append(h('p', { class: 'muted', style: 'text-align:center' }, tr('Todavía no ha pasado nada digno de contarse.', 'Nothing worth telling has happened yet.')));
  let close = () => {};
  // The date is written once, as a heading, whenever it changes.
  let lastAge = '';
  for (const n of items) {
    const age = fmtAge(n.age);
    if (age !== lastAge) {
      list.append(h('div', { class: 'chron-age' }, age));
      lastAge = age;
    }
    const el = hud.newsItem(n, '');
    // Events that happened somewhere: a tap takes the camera there.
    if (n.focus && go)
      el.addEventListener('click', () => {
        if (go(n)) close();
      });
    list.append(el);
  }
  close = modal(host, {
    title: tr('Crónica del sistema', 'System chronicle'),
    lore: tr('Toca un suceso marcado con ◎ para ir a verlo.', 'Tap an event marked with ◎ to go and see it.'),
    wide: true,
    body: [list],
    buttons: [{ label: tr('Cerrar', 'Close'), primary: true }],
  });
}

/** Title screen with drifting dust motes. */
export class TitleScreen {
  el: HTMLElement;
  private motes: HTMLCanvasElement;
  private raf = 0;
  private stopMotes = () => {};

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
    // The canvas is resized only when its box changes (resizing it clears and reallocates it).
    const fit = () => {
      c.width = c.clientWidth;
      c.height = c.clientHeight;
    };
    fit();
    // With reduced motion the motes are drawn once and stay still.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resize = new ResizeObserver(() => {
      fit();
      if (still) tick(performance.now());
    });
    resize.observe(c);
    this.stopMotes = () => resize.disconnect();
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = c.width;
      const hh = c.height;
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
      if (!still) this.raf = requestAnimationFrame(tick);
    };
    if (still) tick(last);
    else this.raf = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.stopMotes();
    this.el.style.transition = 'opacity .8s';
    this.el.style.opacity = '0';
    setTimeout(() => this.el.remove(), 800);
  }
}

