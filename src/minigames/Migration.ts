import { num, tr } from '../i18n';
import { h, stone } from '../ui/dom';
import { clamp } from '../util';

const ROUNDS = 5;

/**
 * Orbital migration: a passing body tugs your planet. Stop the swinging needle inside the
 * glowing arc to time each gravity assist; every good push moves the orbit a little.
 */
export function playMigration(
  host: HTMLElement,
  o: { name: string; a: number; hz: [number, number]; preview: (a: number) => number },
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
  const card = stone(
    'mg',
    h('div', { class: 'top' }, h('h1', { class: 'carved' }, tr(`Migración orbital de ${o.name}`, `Orbital migration of ${o.name}`)), h('button', { class: 'btn small', onclick: () => finish() }, tr('Terminar', 'Finish'))),
    canvas,
    h('div', { class: 'bar' }, info, choose),
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
    if (d < zoneW * 0.22) {
      factor *= dir < 0 ? 0.92 : 1.08;
      msg = tr('¡Perfecto!', 'Perfect!');
      msgGood = true;
    } else if (d < zoneW * 0.5) {
      factor *= dir < 0 ? 0.95 : 1.05;
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
    // old orbit
    const ro = px(o.a) - SX;
    g.strokeStyle = 'rgba(220,187,122,0.35)';
    g.setLineDash([4, 6]);
    g.beginPath();
    g.arc(SX, SY, ro, -ARC - 0.1, ARC + 0.1);
    g.stroke();
    g.setLineDash([]);
    const rn = px(aNow()) - SX;
    g.strokeStyle = 'rgba(255,215,150,0.85)';
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
    info.innerHTML = `${tr('Órbita', 'Orbit')}: <b class="gold">${num(o.a, 2)}</b> → <b class="gold">${num(aNow(), 2)} UA</b> · ${tr('temperatura', 'temperature')} <b>${Math.round(T0 - 273)} °C</b> → <b class="${Tn > 273 && Tn < 315 ? 'moss' : 'ember'}">${Math.round(Tn - 273)} °C</b>`;
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
