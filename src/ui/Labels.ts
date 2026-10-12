import type { Stage } from '../render/Stage';
import { h, setHtml } from './dom';

/** HTML labels that follow points in the 3D scene. */
export class Labels {
  private pool = new Map<string, { el: HTMLElement; used: boolean }>();
  private p = { x: 0, y: 0, vis: false };
  /** The host's box, read once a frame (reading it per label forced a layout for each one). */
  private r: DOMRect | null = null;

  constructor(
    private host: HTMLElement,
    private stage: Stage,
  ) {}

  begin() {
    this.r = this.host.getBoundingClientRect();
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
    // Patched in place: a blinking warning on a label keeps its rhythm when a number beside it changes.
    setHtml(e.el, html);
    const p = this.stage.project(x, y, z, this.p);
    const r = (this.r ??= this.host.getBoundingClientRect());
    if (!p.vis) {
      if (e.el.style.display !== 'none') e.el.style.display = 'none';
      return;
    }
    if (e.el.style.display) e.el.style.display = '';
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
