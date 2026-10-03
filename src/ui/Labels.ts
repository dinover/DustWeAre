import type { Stage } from '../render/Stage';
import { h } from './dom';

/** HTML labels that follow points in the 3D scene. */
export class Labels {
  private pool = new Map<string, { el: HTMLElement; used: boolean }>();
  private p = { x: 0, y: 0, vis: false };

  constructor(
    private host: HTMLElement,
    private stage: Stage,
  ) {}

  begin() {
    for (const v of this.pool.values()) v.used = false;
  }

  put(key: string, cls: string, html: string, x: number, y: number, z: number, dy = 0) {
    let e = this.pool.get(key);
    if (!e) {
      e = { el: h('div', { class: cls }), used: true };
      this.host.append(e.el);
      this.pool.set(key, e);
    }
    e.used = true;
    if (e.el.className !== cls) e.el.className = cls;
    if (e.el.dataset.html !== html) {
      e.el.innerHTML = html;
      e.el.dataset.html = html;
    }
    const p = this.stage.project(x, y, z, this.p);
    const r = this.host.getBoundingClientRect();
    if (!p.vis) {
      e.el.style.display = 'none';
      return;
    }
    e.el.style.display = '';
    e.el.style.left = `${p.x - r.left}px`;
    e.el.style.top = `${p.y - r.top + dy}px`;
  }

  end() {
    for (const [k, v] of this.pool) {
      if (v.used) continue;
      v.el.remove();
      this.pool.delete(k);
    }
  }

  clear() {
    for (const v of this.pool.values()) v.el.remove();
    this.pool.clear();
  }
}
