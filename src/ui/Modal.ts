import { h, stone } from './dom';
import { tr } from '../i18n';

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?: () => void | boolean;
}

export interface ModalOpts {
  title?: string;
  lore?: string;
  body?: (HTMLElement | string)[];
  buttons?: ModalButton[];
  wide?: boolean;
  cls?: string;
  /** Clicking outside / Escape closes it. */
  dismissable?: boolean;
  onClose?: () => void;
}

const open: { close: () => void; dismiss: boolean }[] = [];
let seq = 0;

/** Everything in a dialog the keyboard can reach, in order. */
const focusables = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);

/**
 * A carved stone dialog over a dusky veil. Its title stays on top and its buttons at the bottom;
 * only the body between them scrolls. Returns a function that closes it.
 */
export function modal(host: HTMLElement, o: ModalOpts) {
  // Whoever had the focus gets it back when the dialog closes.
  const prev = document.activeElement as HTMLElement | null;
  const card = stone(`modal ${o.wide ? 'wide' : ''} ${o.cls ?? ''}`);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  if (o.title) {
    const id = `dlg-${++seq}`;
    card.setAttribute('aria-labelledby', id);
    card.append(h('div', { class: 'modal-head' }, h('h1', { id }, o.title), h('div', { class: 'rule' })));
  }
  const body = h('div', { class: 'modal-body' });
  if (o.lore) body.append(h('p', { class: 'lore' }, o.lore));
  for (const b of o.body ?? []) body.append(typeof b === 'string' ? h('div', { html: b }) : b);
  card.append(body);
  // The body fades at an edge only when there is more to read beyond it.
  const edges = () => {
    body.classList.toggle('can-up', body.scrollTop > 2);
    body.classList.toggle('can-down', body.scrollTop + body.clientHeight < body.scrollHeight - 2);
  };
  body.addEventListener('scroll', edges, { passive: true });
  const watch = new ResizeObserver(edges);
  watch.observe(body);
  for (const c of [...body.children]) watch.observe(c);
  const veil = h('div', { class: 'veil' }, card);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    watch.disconnect();
    const i = open.findIndex((x) => x.close === close);
    if (i >= 0) open.splice(i, 1);
    veil.style.transition = 'opacity .3s';
    veil.style.opacity = '0';
    setTimeout(() => veil.remove(), 300);
    o.onClose?.();
    if (prev?.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
  };
  // Tab and Shift+Tab go round the dialog's own controls.
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables(card);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !card.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !card.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  });
  if (o.buttons?.length) {
    const row = h('div', { class: 'buttons' });
    for (const b of o.buttons) {
      row.append(
        h(
          'button',
          {
            class: `btn ${b.primary ? 'primary' : ''}`,
            onclick: () => {
              if (b.onClick?.() === false) return;
              close();
            },
          },
          b.label,
        ),
      );
    }
    card.append(row);
  }
  if (o.dismissable !== false)
    veil.addEventListener('pointerdown', (e) => {
      if (e.target === veil) close();
    });
  host.append(veil);
  open.push({ close, dismiss: o.dismissable !== false });
  const first = (card.querySelector('.btn.primary') as HTMLElement | null) ?? focusables(card)[0];
  if (first) first.focus({ preventScroll: true });
  else {
    // Nothing to focus yet: the dialog itself holds the focus, so Tab starts inside it.
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  }
  return close;
}

/** Escape closes the top dialog. Returns true when something was closed. */
export function closeTopModal() {
  const top = open[open.length - 1];
  if (!top || !top.dismiss) return !!top;
  top.close();
  return true;
}

export const anyModal = () => open.length > 0;

/** Closes every dialog (when the whole game changes, e.g. a new system begins). */
export function closeAllModals() {
  for (const m of [...open].reverse()) m.close();
}

export function confirmBox(host: HTMLElement, title: string, text: string, yes: string, onYes: () => void) {
  modal(host, { title, body: [h('p', { style: 'text-align:center' }, text)], buttons: [{ label: tr('Cancelar', 'Cancel') }, { label: yes, primary: true, onClick: onYes }] });
}
