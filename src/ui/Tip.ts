import { h } from './dom';

/**
 * One floating tooltip for every element with a `data-tip` (HTML allowed): it follows the
 * mouse on desktop, and a tap shows it for a moment on touch screens.
 */
export function installTips(host: HTMLElement) {
  const pop = h('div', { class: 'tip-pop', role: 'tooltip' });
  host.append(pop);
  let cur: HTMLElement | null = null;
  let timer = 0;
  let mouse: { x: number; y: number } | null = null;
  let shown = '';

  const place = (t: HTMLElement) => {
    const r = t.getBoundingClientRect();
    const w = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    let y = r.top - ph - 8;
    if (y < 8) y = r.bottom + 8;
    pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const show = (t: HTMLElement) => {
    cur = t;
    shown = t.dataset.tip ?? '';
    pop.innerHTML = shown;
    pop.classList.add('on');
    place(t);
  };
  const hide = () => {
    cur = null;
    pop.classList.remove('on');
  };
  const tipOf = (e: Event) => ((e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null;

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouse = { x: e.clientX, y: e.clientY };
    const t = tipOf(e);
    if (!t) {
      if (cur) hide();
    } else if (t !== cur || shown !== t.dataset.tip) show(t);
  });
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = tipOf(e);
      if (e.pointerType !== 'touch' || !t) return hide();
      show(t);
      clearTimeout(timer);
      timer = window.setTimeout(hide, 3200);
    },
    true,
  );
  window.addEventListener('scroll', hide, true);
  // Panels re-render or close under a still mouse: follow the new element there, or let go.
  window.setInterval(() => {
    if (!cur || (cur.isConnected && cur.offsetParent !== null)) return;
    const under = mouse ? (document.elementFromPoint(mouse.x, mouse.y)?.closest('[data-tip]') as HTMLElement | null) : null;
    if (under) show(under);
    else hide();
  }, 200);
  window.addEventListener('blur', hide);
}
