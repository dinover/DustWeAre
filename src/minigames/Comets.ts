import { tr } from '../i18n';
import { h, stone } from '../ui/dom';
import type { Look } from '../render/Planet';
import { clamp } from '../util';

export type CometType = 'ice' | 'carbon' | 'nitrogen' | 'iron';

const TYPES: Record<CometType, { color: string; tail: string; weight: number; name: () => string; gives: () => string }> = {
  ice: { color: '#e4f6ff', tail: '150, 210, 240', weight: 0.36, name: () => tr('Helado', 'Icy'), gives: () => tr('agua', 'water') },
  carbon: { color: '#e0a466', tail: '200, 130, 70', weight: 0.27, name: () => tr('Carbonáceo', 'Carbon-rich'), gives: () => tr('orgánicos', 'organics') },
  nitrogen: { color: '#e2d2ff', tail: '180, 150, 240', weight: 0.23, name: () => tr('Nitrogenado', 'Nitrogen-rich'), gives: () => tr('aire', 'air') },
  iron: { color: '#ffb48a', tail: '230, 110, 60', weight: 0.14, name: () => tr('Férrico', 'Iron-rich'), gives: () => tr('campo magnético', 'magnetic field') },
};

export interface CometGain {
  water: number;
  org: number;
  atm: number;
  metal: number;
}

interface Comet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: CometType;
  caught: boolean;
  trail: { x: number; y: number }[];
  r: number;
}

const DURATION = 26;

/**
 * Comet shower: comets cross the sky around one of your worlds. Tap one to nudge it
 * into the world; each kind brings something different.
 */
export function playComets(host: HTMLElement, worldName: string, look: Look, done: (gain: CometGain | null) => void) {
  const portrait = window.innerWidth < window.innerHeight;
  const W = portrait ? 600 : 960;
  const H = portrait ? 780 : 600;
  const canvas = h('canvas', { style: `aspect-ratio:${W} / ${H}` }) as HTMLCanvasElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const counts: Record<CometType, number> = { ice: 0, carbon: 0, nitrogen: 0, iron: 0 };
  const chips = h('div', { class: 'chips' });
  const timer = h('div', { class: 'vessel gold', style: 'width:160px' }, h('i'));
  const endBtn = h('button', { class: 'btn small', onclick: () => finish() }, tr('Terminar', 'Finish'));
  const card = stone(
    'mg',
    h('div', { class: 'top' }, h('h1', { class: 'carved' }, tr(`Lluvia de cometas sobre ${worldName}`, `Comet shower over ${worldName}`)), endBtn),
    canvas,
    h('div', { class: 'bar' }, chips, h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('span', { class: 'muted small' }, tr('Tiempo', 'Time')), timer)),
  );
  const veil = h('div', { class: 'veil' }, card);
  host.append(veil);

  const drawChips = () => {
    chips.innerHTML = (Object.keys(TYPES) as CometType[])
      .map((k) => `<span class="chip" style="--c:${TYPES[k].color}"><i></i>${TYPES[k].name()} → ${TYPES[k].gives()} <b>${counts[k]}</b></span>`)
      .join('');
  };
  drawChips();

  const cx = W / 2;
  const cy = H / 2 + 20;
  const PR = 74;
  const comets: Comet[] = [];
  const flashes: { x: number; y: number; t: number; c: string }[] = [];
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 0.6 + 0.1 }));
  let t = -3.2; // intro countdown
  let spawn = 0;
  let running = true;
  let last = performance.now();

  const pickType = (): CometType => {
    let r = Math.random();
    for (const k of Object.keys(TYPES) as CometType[]) {
      r -= TYPES[k].weight;
      if (r <= 0) return k;
    }
    return 'ice';
  };

  const spawnComet = () => {
    // Enter from an edge, cross the sky and miss the world on its own.
    const side = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    if (side === 0) (x = -30), (y = Math.random() * H);
    else if (side === 1) (x = W + 30), (y = Math.random() * H);
    else if (side === 2) (x = Math.random() * W), (y = -30);
    else (x = Math.random() * W), (y = H + 30);
    const miss = (Math.random() < 0.5 ? -1 : 1) * (PR + 60 + Math.random() * 150);
    const dx = cx - x;
    const dy = cy - y;
    const d = Math.hypot(dx, dy);
    const tx = cx + (-dy / d) * miss;
    const ty = cy + (dx / d) * miss;
    const sp = 120 + Math.random() * 90 + Math.max(0, t) * 3;
    const ddx = tx - x;
    const ddy = ty - y;
    const dd = Math.hypot(ddx, ddy);
    comets.push({ x, y, vx: (ddx / dd) * sp, vy: (ddy / dd) * sp, type: pickType(), caught: false, trail: [], r: 5 + Math.random() * 3 });
  };

  const onDown = (e: PointerEvent) => {
    if (t < 0) return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    let best: Comet | null = null;
    let bd = 46;
    for (const c of comets) {
      if (c.caught) continue;
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) best.caught = true;
  };
  canvas.addEventListener('pointerdown', onDown);

  const rgb = (c: [number, number, number], k = 1) => `rgb(${Math.round(c[0] * 255 * k)},${Math.round(c[1] * 255 * k)},${Math.round(c[2] * 255 * k)})`;

  const drawPlanet = (time: number) => {
    // Atmosphere glow
    const glow = g.createRadialGradient(cx, cy, PR * 0.9, cx, cy, PR * 1.5);
    glow.addColorStop(0, `rgba(${look.atmCol.map((v) => Math.round(v * 255)).join(',')},${0.15 + look.atm * 0.35})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(cx - PR * 2, cy - PR * 2, PR * 4, PR * 4);
    g.save();
    g.beginPath();
    g.arc(cx, cy, PR, 0, Math.PI * 2);
    g.clip();
    const base = g.createLinearGradient(cx - PR, cy - PR, cx + PR, cy + PR);
    base.addColorStop(0, rgb(look.rock, 1.15));
    base.addColorStop(1, rgb(look.rock2, 0.9));
    g.fillStyle = base;
    g.fillRect(cx - PR, cy - PR, PR * 2, PR * 2);
    // Seas, blotches, ice caps
    const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898 + look.seed * 78.233) * 43758.5453) % 1;
    for (let i = 0; i < 18; i++) {
      const a = rnd(i) * Math.PI * 2 + time * 0.05;
      const rr = rnd(i + 50) * PR * 0.8;
      const s = 12 + rnd(i + 99) * 30;
      g.fillStyle = look.ocean > 0.1 && i % 3 !== 0 ? `rgba(30,90,110,${0.5 + look.ocean * 0.4})` : `rgba(0,0,0,0.18)`;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9, s, s * 0.7, a, 0, Math.PI * 2);
      g.fill();
    }
    if (look.veg > 0.05) {
      for (let i = 0; i < 10; i++) {
        const a = rnd(i + 200) * Math.PI * 2 + time * 0.05;
        const rr = rnd(i + 230) * PR * 0.7;
        g.fillStyle = `rgba(80,130,50,${look.veg * 0.6})`;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 10 + rnd(i) * 14, 8, a, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (look.ice > 0.05) {
      g.fillStyle = 'rgba(235,245,250,0.9)';
      g.fillRect(cx - PR, cy - PR, PR * 2, PR * look.ice * 0.5);
      g.fillRect(cx - PR, cy + PR - PR * look.ice * 0.5, PR * 2, PR * look.ice * 0.5);
    }
    if (look.gas > 0.5) {
      for (let i = 0; i < 9; i++) {
        g.fillStyle = i % 2 ? rgb(look.band1) : rgb(look.band2);
        g.globalAlpha = 0.7;
        g.fillRect(cx - PR, cy - PR + (i * PR * 2) / 9, PR * 2, PR / 6);
      }
      g.globalAlpha = 1;
    }
    // Night side
    const shade = g.createLinearGradient(cx - PR, cy, cx + PR, cy);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.55, 'rgba(0,0,0,0.15)');
    shade.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = shade;
    g.fillRect(cx - PR, cy - PR, PR * 2, PR * 2);
    g.restore();
    g.strokeStyle = `rgba(${look.atmCol.map((v) => Math.round(v * 255)).join(',')},0.5)`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, PR + 1, 0, Math.PI * 2);
    g.stroke();
  };

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (t >= 0) {
      spawn -= dt;
      if (spawn <= 0 && t < DURATION - 1.5) {
        spawn = 0.45 + Math.random() * 0.55;
        spawnComet();
      }
    }
    for (const c of comets) {
      if (c.caught) {
        // Curve gently into the world.
        const dx = cx - c.x;
        const dy = cy - c.y;
        const d = Math.hypot(dx, dy);
        const sp = Math.max(260, Math.hypot(c.vx, c.vy));
        c.vx += ((dx / d) * sp - c.vx) * Math.min(1, dt * 5);
        c.vy += ((dy / d) * sp - c.vy) * Math.min(1, dt * 5);
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.trail.unshift({ x: c.x, y: c.y });
      if (c.trail.length > 22) c.trail.pop();
    }
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (d < PR) {
        counts[c.type]++;
        flashes.push({ x: c.x, y: c.y, t: 0, c: TYPES[c.type].tail });
        drawChips();
        comets.splice(i, 1);
      } else if (c.x < -80 || c.x > W + 80 || c.y < -80 || c.y > H + 80) comets.splice(i, 1);
    }

    g.fillStyle = '#060504';
    g.fillRect(0, 0, W, H);
    for (const s of stars) {
      g.fillStyle = `rgba(255,236,210,${s.a})`;
      g.fillRect(s.x, s.y, 1.2, 1.2);
    }
    drawPlanet(now / 1000);
    for (const c of comets) {
      const ty = TYPES[c.type];
      for (let j = c.trail.length - 1; j > 0; j--) {
        const p = c.trail[j];
        const a = (1 - j / c.trail.length) * 0.5;
        g.fillStyle = `rgba(${ty.tail},${a})`;
        g.beginPath();
        g.arc(p.x, p.y, c.r * (1 - j / c.trail.length) * 1.4 + 1, 0, Math.PI * 2);
        g.fill();
      }
      g.shadowColor = ty.color;
      g.shadowBlur = 16;
      g.fillStyle = ty.color;
      g.beginPath();
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      if (c.caught) {
        g.strokeStyle = 'rgba(255,220,150,0.7)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(c.x, c.y, c.r + 6, 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt;
      const k = f.t / 0.8;
      if (k >= 1) {
        flashes.splice(i, 1);
        continue;
      }
      g.strokeStyle = `rgba(${f.c},${1 - k})`;
      g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath();
      g.arc(f.x, f.y, 6 + k * 40, 0, Math.PI * 2);
      g.stroke();
    }
    if (t < 0) {
      g.fillStyle = 'rgba(6,5,4,0.6)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#eedfbd';
      g.font = `600 ${portrait ? 24 : 26}px Cinzel, Georgia, serif`;
      g.fillText(tr('Toca los cometas para desviarlos', 'Tap the comets to steer them'), W / 2, H / 2 - 70);
      g.font = '18px "Alegreya Sans", sans-serif';
      g.fillStyle = '#b9a681';
      g.fillText(tr(`Cada cometa que caiga en ${worldName} le dejará algo:`, `Every comet that falls on ${worldName} will leave something behind:`), W / 2, H / 2 - 34);
      let y = H / 2 + 6;
      for (const k of Object.keys(TYPES) as CometType[]) {
        g.fillStyle = TYPES[k].color;
        g.fillText(`●  ${TYPES[k].name()} → ${TYPES[k].gives()}`, W / 2, y);
        y += 28;
      }
      g.font = '700 40px Cinzel, Georgia, serif';
      g.fillStyle = '#ffcf8a';
      g.fillText(String(Math.ceil(-t)), W / 2, H / 2 + 150);
    }
    (timer.firstChild as HTMLElement).style.setProperty('--v', `${clamp(1 - Math.max(0, t) / DURATION) * 100}%`);
    if (t >= DURATION && !comets.some((c) => c.caught)) {
      finish();
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  function finish() {
    if (!running) return;
    running = false;
    const gain: CometGain = {
      water: Math.min(0.6, counts.ice * 0.06),
      org: Math.min(0.6, counts.carbon * 0.07),
      atm: Math.min(2.5, counts.nitrogen * 0.14),
      metal: Math.min(0.5, counts.iron * 0.06),
    };
    veil.style.transition = 'opacity .3s';
    veil.style.opacity = '0';
    setTimeout(() => veil.remove(), 300);
    done(gain);
  }
}
