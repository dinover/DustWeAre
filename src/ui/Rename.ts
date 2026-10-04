import { h } from './dom';
import { modal } from './Modal';
import { tr } from '../i18n';

export interface RenameOpts {
  title: string;
  label: string;
  value: string;
  max?: number;
  /** Returns why a name cannot be used (null: it can). */
  validate?(name: string): string | null;
  /** Suggests another name (the dice button). */
  suggest?(): string;
  onSave(name: string): void;
}

/** A small carved dialog to give something a name of your own. */
export function renameDialog(host: HTMLElement, o: RenameOpts) {
  const max = o.max ?? 18;
  const input = h('input', { class: 'name-input', type: 'text', maxlength: String(max), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  input.value = o.value;
  const err = h('div', { class: 'name-err small' });
  const row = h('div', { class: 'name-row' }, input);
  if (o.suggest) {
    row.append(
      h(
        'button',
        {
          class: 'btn small icon',
          title: tr('Otro nombre al azar', 'Another random name'),
          onclick: () => {
            input.value = o.suggest!();
            err.textContent = '';
            input.focus();
          },
        },
        '⚄',
      ),
    );
  }
  const save = () => {
    const v = input.value.trim().replace(/\s+/g, ' ').slice(0, max);
    const why = !v ? tr('Escribe un nombre.', 'Type a name.') : (o.validate?.(v) ?? null);
    if (why) {
      err.textContent = why;
      input.focus();
      return false;
    }
    o.onSave(v);
    return true;
  };
  const close = modal(host, {
    title: o.title,
    cls: 'rename',
    body: [h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 10px' }, o.label), row, err],
    buttons: [{ label: tr('Cancelar', 'Cancel') }, { label: tr('Guardar', 'Save'), primary: true, onClick: save }],
    dismissable: true,
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && save()) close();
    if (e.key === 'Escape') close();
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 60);
  return close;
}
