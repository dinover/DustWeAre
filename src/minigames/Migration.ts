import { num, tr } from '../i18n';
import { h, setHtml, stone } from '../ui/dom';
import { clamp } from '../util';

const ROUNDS = 5;
/** Size of a push: [good, perfect], as a share of the orbit. Fine pushes are for settling into a narrow lane. */
const PUSH = { normal: [0.05, 0.08], fine: [0.01, 0.02] } as const;
/** How far one migration can go at best (five perfect pushes). */
const REACH_IN = Math.pow(0.92, ROUNDS);
const REACH_OUT = Math.pow(1.08, ROUNDS);

/**
 * Orbital migration: a passing body tugs your planet. Stop the swinging needle inside the
 * glowing arc to time each gravity assist; every good push moves the orbit a little.
 */
/** What the migration needs to know about the neighbourhood (radii in AU). */
export interface MigrationGuide {
  /** Every other planet: its orbit and the band where this one could not stay. */
  neighbours: { name: string; a: number; band: [number, number] }[];
  /** Stretches where this planet would be stable. */
  zones: [number, number][];
  /** The next stable orbits inwards and outwards. */
  inner?: number;
  outer?: number;
  /** How an orbit would turn out, and the stable orbit it would settle into (if close enough). */
  check(a: number): { state: 'stable' | 'edge' | 'unstable'; other?: string; outcome?: 'moon' | 'impact'; heavier?: boolean; snap: number | null };
}

export function playMigration(
  host: HTMLElement,
  o: { name: string; a: number; hz: [number, number]; preview: (a: number) => number; guide?: MigrationGuide },
  done: (factor: number | null) => void,
) {
  const portrait = window.innerWidth < window.innerHeight;
  const W = portrait ? 600 : 960;
  const H = portrait ? 820 : 600;
  const canvas = h('canvas', { style: `aspect-ratio:${W} / ${H}` }) as HTMLCanvasElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const info = h('div', { class: 'small' });
  const choose = h('div', { class: 'chips' });
  let fine = false;
  // Fine pushes: a twentieth of the normal ones, to land inside a narrow stable lane (F toggles it).
  const fineBtn = h('button', { class: 'btn small', 'aria-pressed': 'false', onclick: () => setFine(!fine) }) as HTMLButtonElement;
  const setFine = (v: boolean) => {
    fine = v;
    fineBtn.classList.toggle('on', v);
    fineBtn.setAttribute('aria-pressed', String(v));
    fineBtn.textContent = v ? tr('Empuje fino: sí', 'Fine push: on') : tr('Empuje fino: no', 'Fine push: off');
    fineBtn.dataset.tip = tr('Cada empuje mueve la órbita un 1–2 % en lugar de un 5–8 %. Tecla F.', 'Each push moves the orbit 1–2% instead of 5–8%. Key F.');
  };
  setFine(false);
  const card = stone(
    'mg',
    h('div', { class: 'top' }, h('h1', { class: 'carved' }, tr(`Migración orbital de ${o.name}`, `Orbital migration of ${o.name}`)), h('button', { class: 'btn small', onclick: () => finish() }, tr('Terminar', 'Finish'))),
    canvas,
    h('div', { class: 'bar' }, info, h('div', { class: 'chips' }, choose, fineBtn)),
  );
  const veil = h('div', { class: 'veil' }, card);
  host.append(veil);

  let dir = 0; // -1 inwards, +1 outwards
  let factor = 1;
  let round = 0;
  let needle = 0;
  let nv = 1;
  let zone = 0.6;
  let zoneW = 0.24;
  let msg = '';
  let msgGood = false;
  let msgT = 0;
  let running = true;
  let last = performance.now();
  const T0 = o.preview(o.a);
  const cold = T0 < 273;
  const hot = T0 > 315;

  const newZone = () => {
    zoneW = 0.26 - round * 0.032;
    zone = 0.15 + Math.random() * 0.7;
  };

  const start = (d: number) => {
    dir = d;
    newZone();
    choose.innerHTML = '';
    choose.append(h('span', { class: 'muted small' }, tr('Toca, haz clic o pulsa espacio cuando la aguja cruce el arco.', 'Tap, click or press space when the needle crosses the arc.')));
  };
  const btn = (label: string, d: number, rec: boolean) => h('button', { class: `btn small ${rec ? 'primary' : ''}`, onclick: () => start(d) }, label);
  choose.append(
    btn(tr('☀ Acercar a la estrella', '☀ Move closer to the star'), -1, cold),
    btn(tr('❄ Alejar de la estrella', '❄ Move away from the star'), 1, hot),
  );

  const press = () => {
    if (!dir || round >= ROUNDS || !running) return;
    const d = Math.abs(needle - zone);
    const [good, perfect] = PUSH[fine ? 'fine' : 'normal'];
    if (d < zoneW * 0.22) {
      factor *= 1 + dir * perfect;
      msg = tr('¡Perfecto!', 'Perfect!');
      msgGood = true;
    } else if (d < zoneW * 0.5) {
      factor *= 1 + dir * good;
      msg = tr('Bien', 'Good');
      msgGood = true;
    } else {
      msg = tr('Se escapó…', 'It slipped away…');
      msgGood = false;
    }
    msgT = 1.2;
    round++;
    if (round >= ROUNDS) setTimeout(finish, 1300);
    else newZone();
  };
  canvas.addEventListener('pointerdown', press);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      press();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      e.stopPropagation();
      setFine(!fine);
    }
  };
  window.addEventListener('keydown', onKey, true);

  const aNow = () => clamp(o.a * factor, 0.3, 16);
  const aMax = Math.max(3, o.a * 2.3, o.hz[1] * 1.7);
  const px = (a: number) => 70 + (portrait ? 470 : 440) * Math.pow(a / aMax, 0.6);
  const SX = portrait ? 40 : 60;
  const SY = portrait ? 230 : 320;
  // How far the orbit arcs open (radians either side): flatter on tall screens.
  const ARC = portrait ? 0.42 : 1.1;

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dir && round < ROUNDS) {
      needle += nv * dt * (0.55 + round * 0.14);
      if (needle > 1) (needle = 1), (nv = -1);
      if (needle < 0) (needle = 0), (nv = 1);
    }
    msgT -= dt;

    g.fillStyle = '#060504';
    g.fillRect(0, 0, W, H);
    // Map: star, habitable band and orbits.
    const sg = g.createRadialGradient(SX, SY, 0, SX, SY, 70);
    sg.addColorStop(0, 'rgba(255,240,200,1)');
    sg.addColorStop(0.25, 'rgba(255,170,70,0.9)');
    sg.addColorStop(1, 'rgba(255,100,30,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(SX, SY, 70, 0, Math.PI * 2);
    g.fill();
    const r0 = px(o.hz[0]) - SX;
    const r1 = px(o.hz[1]) - SX;
    g.fillStyle = 'rgba(140,200,100,0.13)';
    g.beginPath();
    g.arc(SX, SY, r1, -ARC, ARC);
    g.arc(SX, SY, r0, ARC, -ARC, true);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(150,210,110,0.5)';
    g.lineWidth = 1;
    for (const r of [r0, r1]) {
      g.beginPath();
      g.arc(SX, SY, r, -ARC, ARC);
      g.stroke();
    }
    g.fillStyle = 'rgba(160,205,130,0.8)';
    g.font = 'italic 15px "Cormorant Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.fillText(tr('zona habitable', 'habitable zone'), SX + Math.cos(ARC) * (r0 + r1) / 2, SY - Math.sin(ARC) * r1 - 10);
    // The neighbourhood: where this planet would be stable (green), its neighbours' reach (ember),
    // their orbits, and the next stable orbits either way.
    const gd = o.guide;
    if (gd) {
      const arcBand = (lo: number, hi: number, fill: string) => {
        const ra = px(Math.min(lo, aMax)) - SX;
        const rb = px(Math.min(hi, aMax)) - SX;
        if (rb - ra < 0.5) return;
        g.fillStyle = fill;
        g.beginPath();
        g.arc(SX, SY, rb, -ARC, ARC);
        g.arc(SX, SY, ra, ARC, -ARC, true);
        g.closePath();
        g.fill();
      };
      for (const n of gd.neighbours) {
        if (n.band[0] >= aMax) continue;
        arcBand(n.band[0], n.band[1], 'rgba(255,110,50,0.16)');
        // Crisp edges: where the neighbour's reach begins and ends.
        g.strokeStyle = 'rgba(255,123,53,0.45)';
        g.lineWidth = 1;
        for (const e of n.band) {
          if (e >= aMax) continue;
          g.beginPath();
          g.arc(SX, SY, px(e) - SX, -ARC, ARC);
          g.stroke();
        }
      }
      g.font = '600 13px "Alegreya Sans", sans-serif';
      g.textAlign = 'center';
      for (const n of gd.neighbours) {
        if (n.a > aMax) continue;
        const rr = px(n.a) - SX;
        g.strokeStyle = 'rgba(255,170,120,0.45)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(SX, SY, rr, -ARC, ARC);
        g.stroke();
        g.fillStyle = 'rgba(255,190,150,0.9)';
        g.beginPath();
        g.arc(SX + Math.cos(ARC * 0.55) * rr, SY + Math.sin(ARC * 0.55) * rr, 6, 0, Math.PI * 2);
        g.fill();
        g.fillText(n.name, SX + Math.cos(ARC * 0.55) * rr, SY + Math.sin(ARC * 0.55) * rr + 20);
      }
      for (const [a, label, side] of [
        [gd.inner, tr('estable', 'stable'), -1],
        [gd.outer, tr('estable', 'stable'), 1],
      ] as [number | undefined, string, number][]) {
        if (a === undefined || a > aMax) continue;
        const rr = px(a) - SX;
        g.strokeStyle = 'rgba(184,224,138,0.95)';
        g.lineWidth = 2;
        g.setLineDash([6, 5]);
        g.beginPath();
        g.arc(SX, SY, rr, -ARC - 0.1, ARC + 0.1);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(190,230,150,1)';
        // Five perfect pushes reach ×0.66 inwards and ×1.47 outwards: further than that is out of reach.
        const far = a < o.a * REACH_IN || a > o.a * REACH_OUT;
        // The inner one is named at the top end of its arc, the outer one at the bottom end.
        const at = side < 0 ? -ARC - 0.1 : ARC + 0.1;
        g.fillText(`${label} · ${num(a, 2)} ${tr('UA', 'AU')}${far ? tr(' (fuera de alcance)', ' (out of reach)') : ''}`, SX + Math.cos(at) * rr, SY + Math.sin(at) * rr + (side < 0 ? -8 : 18));
      }
    }
    // old orbit
    const ro = px(o.a) - SX;
    g.strokeStyle = 'rgba(220,187,122,0.35)';
    g.setLineDash([4, 6]);
    g.beginPath();
    g.arc(SX, SY, ro, -ARC - 0.1, ARC + 0.1);
    g.stroke();
    g.setLineDash([]);
    const rn = px(aNow()) - SX;
    const fate = o.guide?.check(aNow());
    g.strokeStyle = !fate ? 'rgba(255,215,150,0.85)' : fate.state === 'unstable' && fate.snap === null ? 'rgba(255,123,53,0.95)' : fate.state === 'edge' ? 'rgba(229,182,90,0.95)' : 'rgba(184,224,138,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(SX, SY, rn, -ARC - 0.1, ARC + 0.1);
    g.stroke();
    const pg = g.createRadialGradient(SX + rn - 4, SY - 4, 1, SX + rn, SY, 13);
    pg.addColorStop(0, '#f6e2b4');
    pg.addColorStop(1, '#6b4a2c');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(SX + rn, SY, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#eedfbd';
    g.font = '600 15px Cinzel, Georgia, serif';
    g.fillText(o.name, SX + rn, SY + 34);

    // Dial.
    const DX = portrait ? 300 : 760;
    const DY = portrait ? 610 : 360;
    const DR = portrait ? 140 : 150;
    const a0 = Math.PI * 0.85;
    const a1 = Math.PI * 2.15;
    const ang = (v: number) => a0 + (a1 - a0) * v;
    g.lineCap = 'round';
    g.strokeStyle = '#1c1612';
    g.lineWidth = 26;
    g.beginPath();
    g.arc(DX, DY, DR, a0, a1);
    g.stroke();
    g.strokeStyle = 'rgba(220,187,122,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i <= 24; i++) {
      const a = ang(i / 24);
      g.beginPath();
      g.moveTo(DX + Math.cos(a) * (DR - 22), DY + Math.sin(a) * (DR - 22));
      g.lineTo(DX + Math.cos(a) * (DR - (i % 6 ? 16 : 10)), DY + Math.sin(a) * (DR - (i % 6 ? 16 : 10)));
      g.stroke();
    }
    if (dir && round < ROUNDS) {
      g.strokeStyle = 'rgba(255,120,40,0.55)';
      g.lineWidth = 22;
      g.shadowColor = '#ff7b35';
      g.shadowBlur = 18;
      g.beginPath();
      g.arc(DX, DY, DR, ang(zone - zoneW / 2), ang(zone + zoneW / 2));
      g.stroke();
      g.strokeStyle = 'rgba(255,215,140,0.95)';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(DX, DY, DR, ang(zone - zoneW * 0.11), ang(zone + zoneW * 0.11));
      g.stroke();
      g.shadowBlur = 0;
    }
    const na = ang(needle);
    g.strokeStyle = '#eedfbd';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(DX, DY);
    g.lineTo(DX + Math.cos(na) * (DR + 10), DY + Math.sin(na) * (DR + 10));
    g.stroke();
    g.fillStyle = '#2b221b';
    g.strokeStyle = '#8c6b45';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(DX, DY, 16, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#b9a681';
    g.font = '600 14px Cinzel, Georgia, serif';
    g.fillText(tr('EMPUJE GRAVITATORIO', 'GRAVITY ASSIST'), DX, DY + 70);
    g.font = '700 22px Cinzel, Georgia, serif';
    g.fillStyle = '#dcbb7a';
    g.fillText(`${Math.min(round + (dir ? 1 : 0), ROUNDS)} / ${ROUNDS}`, DX, DY + 100);
    if (msgT > 0) {
      g.globalAlpha = clamp(msgT);
      g.font = '700 30px Cinzel, Georgia, serif';
      g.fillStyle = msgGood ? '#ffd08a' : '#c98a6a';
      g.fillText(msg, DX, DY - 30);
      g.globalAlpha = 1;
    }
    if (!dir) {
      g.font = '600 20px Cinzel, Georgia, serif';
      g.fillStyle = '#eedfbd';
      g.fillText(tr('¿Hacia dónde lo llevamos?', 'Which way shall we take it?'), DX, DY - 20);
    }
    const Tn = o.preview(aNow());
    // Live: will the new orbit hold?
    let safety = '';
    if (gd) {
      const c = gd.check(aNow());
      safety =
        c.state === 'stable'
          ? `<b class="moss">${tr('Órbita estable ✓', 'Stable orbit ✓')}</b>`
          : c.state === 'edge'
            ? `<b class="gold">${tr(`Estable, al límite de ${c.other}`, `Stable, close to ${c.other}`)}</b>`
            : c.snap !== null
              ? `<b class="moss">${tr(`Se asentará en ${num(c.snap, 2)} UA, estable`, `It will settle at ${num(c.snap, 2)} AU, stable`)}</b>`
              : `<b class="ember">${
                  c.outcome === 'moon'
                    ? c.heavier
                      ? tr(`${c.other} entra en su zona: lo capturará como luna`, `${c.other} falls inside its reach: it will capture it as a moon`)
                      : tr(`En la zona de ${c.other}: acabará como su luna`, `Inside the reach of ${c.other}: it will end up as its moon`)
                    : tr(`Demasiado cerca de ${c.other}: chocarán`, `Too close to ${c.other}: they will collide`)
                }</b>`;
    }
    setHtml(info, `${tr('Órbita', 'Orbit')}: <b class="gold">${num(o.a, 2)}</b> → <b class="gold">${num(aNow(), 2)} UA</b> · ${tr('temperatura', 'temperature')} <b>${Math.round(T0 - 273)} °C</b> → <b class="${Tn > 273 && Tn < 315 ? 'moss' : 'ember'}">${Math.round(Tn - 273)} °C</b>${safety ? ` · ${safety}` : ''}`);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  function finish() {
    if (!running) return;
    running = false;
    window.removeEventListener('keydown', onKey, true);
    veil.style.transition = 'opacity .3s';
    veil.style.opacity = '0';
    setTimeout(() => veil.remove(), 300);
    done(dir ? factor : null);
  }
}
