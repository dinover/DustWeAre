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

/** A carved stone dialog over a dusky veil. Returns a function that closes it. */
export function modal(host: HTMLElement, o: ModalOpts) {
  const card = stone(`modal ${o.wide ? 'wide' : ''} ${o.cls ?? ''}`);
  if (o.title) card.append(h('h1', null, o.title), h('div', { class: 'rule' }));
  if (o.lore) card.append(h('p', { class: 'lore' }, o.lore));
  for (const b of o.body ?? []) card.append(typeof b === 'string' ? h('div', { html: b }) : b);
  const veil = h('div', { class: 'veil' }, card);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const i = open.findIndex((x) => x.close === close);
    if (i >= 0) open.splice(i, 1);
    veil.style.transition = 'opacity .3s';
    veil.style.opacity = '0';
    setTimeout(() => veil.remove(), 300);
    o.onClose?.();
  };
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
  (card.querySelector('.btn.primary') as HTMLElement | null)?.focus({ preventScroll: true });
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
