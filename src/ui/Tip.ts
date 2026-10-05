import { h } from './dom';

/** Hover this long before a tooltip appears (moving between tips is instant). */
const DELAY = 220;

/**
 * One floating tooltip for every element with a `data-tip` (HTML allowed): it follows the
 * mouse on desktop, and a tap shows it for a moment on touch screens. The tooltip itself never
 * takes the pointer, so it can never hide what lies under it.
 */
export function installTips(host: HTMLElement) {
  const pop = h('div', { class: 'tip-pop', role: 'tooltip' });
  host.append(pop);
  let cur: HTMLElement | null = null;
  let pending: HTMLElement | null = null;
  let wait = 0;
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
    clearTimeout(wait);
    pending = null;
    cur = t;
    shown = t.dataset.tip ?? '';
    pop.innerHTML = shown;
    pop.classList.add('on');
    place(t);
  };
  const hide = () => {
    clearTimeout(wait);
    pending = null;
    cur = null;
    pop.classList.remove('on');
  };
  /**
   * Shows after a short hover; at once if a tooltip is already open (sliding along a list). When
   * the wait is over, whatever tip is under the mouse then is shown: panels redraw themselves
   * all the time, and the element first hovered may already have been replaced by a twin.
   */
  const soon = (t: HTMLElement) => {
    if (cur) return show(t);
    if (pending) return;
    pending = t;
    wait = window.setTimeout(() => {
      pending = null;
      const now = mouse ? tipAt(mouse.x, mouse.y) : t.isConnected ? t : null;
      if (now) show(now);
    }, DELAY);
  };
  const tipAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-tip]') as HTMLElement | null) ?? null;
  const tipOf = (e: Event) => ((e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null;

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouse = { x: e.clientX, y: e.clientY };
    const t = tipOf(e);
    if (!t) {
      if (cur || pending) hide();
    } else if (t === cur) {
      if (shown !== t.dataset.tip) show(t);
    } else soon(t);
  });
  document.addEventListener('pointerleave', hide);
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
  window.addEventListener('blur', hide);
  // Panels re-render under a still mouse: follow the new element there (or let go), and keep
  // the text fresh as values change.
  window.setInterval(() => {
    if (!mouse) return;
    const under = tipAt(mouse.x, mouse.y);
    if (!under) {
      if (cur || pending) hide();
      return;
    }
    if (cur && (under !== cur || shown !== under.dataset.tip)) show(under);
    else if (cur) place(cur);
    else soon(under);
  }, 200);
}
