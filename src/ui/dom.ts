type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny element builder: h('div', { class: 'x', onclick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'string') el.style.cssText = v;
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** A basalt panel with the carved inner line. */
export const stone = (cls = '', ...children: Child[]) => h('div', { class: `stone ${cls}` }, ...children);

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Hand-drawn glyphs for the tools (stroked with currentColor). */
export const ICONS = {
  gather: '<svg viewBox="0 0 32 32"><path d="M16 16m-2 0a2 2 0 1 0 4 0a4 4 0 1 0-8 0a6 6 0 1 0 12 0a8 8 0 1 0-16 0a10 10 0 0 0 10 10"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
  heat: '<svg viewBox="0 0 32 32"><path d="M16 28c-5 0-8-3.4-8-7.8 0-4.6 3.6-6.6 4.6-11 .3 2.5 1.8 3.8 3 4.6C16.5 9 18.2 6 20.4 4c-.3 3.6 1.2 6.2 2.8 8.5 1.2 1.8 2.8 4 2.8 7.7C26 24.6 21 28 16 28z"/><path d="M16 28c-2.2 0-3.6-1.5-3.6-3.5 0-2.4 2-3.4 2.6-5.6 1.3 1.6 4.6 2.8 4.6 5.6 0 2-1.4 3.5-3.6 3.5z"/></svg>',
  cool: '<svg viewBox="0 0 32 32"><path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13"/><path d="M12.5 4.8 16 8l3.5-3.2M12.5 27.2 16 24l3.5 3.2M4 14.2l4.6 1.1 1.4-4.5M28 17.8l-4.6-1.1-1.4 4.5M4 17.8l4.6-1.1 1.4 4.5M28 14.2l-4.6 1.1-1.4-4.5"/></svg>',
  nudge: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="2.5" fill="currentColor"/><path d="M16 16m-11 0a11 11 0 0 1 19-7.5"/><path d="M24.5 3.8 24 8.6l-4.7-.6"/><path d="M16 16m-6 0a6 6 0 0 0 10.5 4" stroke-dasharray="2 2.5"/><circle cx="26.5" cy="21" r="2"/></svg>',
  flare: '<svg viewBox="0 0 32 32"><circle cx="9" cy="16" r="5"/><path d="M15 16h13M15 12.5l11-4M15 19.5l11 4"/><path d="M3 16h1M9 9V8M9 24v-1M4.2 11.2l-.7-.7M4.2 20.8l-.7.7"/></svg>',
  volcano: '<svg viewBox="0 0 32 32"><path d="M3 28h26l-8.5-13h-9z"/><path d="M11.5 15c1.3 1.3 2.7 1.3 4.5 0s3.2-1.3 4.5 0"/><path d="M14 10c-1-2 0-4 2-5M18 11c1.5-1.5 1.5-3.5 0-5.5M16 12V4"/></svg>',
  comets: '<svg viewBox="0 0 32 32"><circle cx="22" cy="22" r="4"/><path d="M19 19 5 5M18 22 6 12M22 18 12 6"/><circle cx="22" cy="22" r="1.2" fill="currentColor"/></svg>',
  migrate: '<svg viewBox="0 0 32 32"><circle cx="5" cy="16" r="3"/><path d="M5 16m9 0a9 9 0 0 1-2.6 6.4M5 16m9 0a9 9 0 0 0-2.6-6.4" opacity=".55"/><path d="M5 16m17 0a17 17 0 0 1-5 12M5 16m17 0a17 17 0 0 0-5-12"/><circle cx="22" cy="16" r="2.2" fill="currentColor"/><path d="m24.5 12.5 3 3.5-3 3.5"/></svg>',
  chronicle: '<svg viewBox="0 0 32 32"><path d="M8 5h15a3 3 0 0 1 3 3v17a2 2 0 0 1-2 2H11a3 3 0 0 1-3-3z"/><path d="M8 5a3 3 0 0 0-3 3v2h3"/><path d="M12 11h10M12 15h10M12 19h7"/></svg>',
  works: '<svg viewBox="0 0 32 32"><path d="M16 3 23 28H9z"/><path d="M12.5 18h7M14 12h4"/><path d="M4 28h24"/><path d="M16 3v-1M6 8l2 1.5M26 8l-2 1.5"/></svg>',
  star: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="6"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></svg>',
  emblem:
    '<svg viewBox="0 0 100 100" fill="none" stroke-linecap="round"><defs><radialGradient id="eg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff1c4"/><stop offset=".35" stop-color="#ffb24a"/><stop offset=".7" stop-color="#e2541c"/><stop offset="1" stop-color="#e2541c" stop-opacity="0"/></radialGradient></defs><ellipse cx="50" cy="50" rx="44" ry="15" stroke="#9c8257" stroke-width="1" stroke-dasharray="1 4" transform="rotate(-18 50 50)"/><ellipse cx="50" cy="50" rx="32" ry="11" stroke="#dcbb7a" stroke-width="1.2" stroke-dasharray="0.5 3" transform="rotate(-18 50 50)"/><ellipse cx="50" cy="50" rx="21" ry="7" stroke="#dcbb7a" stroke-width="1.4" opacity=".7" transform="rotate(-18 50 50)"/><circle cx="50" cy="50" r="13" fill="url(#eg)"/><circle cx="50" cy="50" r="6" fill="#fff4d6"/><circle cx="80" cy="40" r="3.2" fill="#6fc6bd" stroke="#0b0907"/><circle cx="24" cy="62" r="2.2" fill="#c7663a" stroke="#0b0907"/><circle cx="66" cy="62" r="1.6" fill="#dcbb7a"/></svg>',
};

export const icon = (k: keyof typeof ICONS) => h('span', { class: 'ic-svg', html: ICONS[k], style: 'display:contents' });
