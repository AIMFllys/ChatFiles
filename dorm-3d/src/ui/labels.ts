import * as THREE from 'three';

export interface Hotspot {
  position: THREE.Vector3;
  text: string;
  /** 小序号显示在圆点中 */
  index?: number;
}

/**
 * 3D 热点标注：每帧将世界坐标投影到屏幕，相机背后/过远时隐藏。
 * 纯 DOM 实现（不引入 CSS2DRenderer），最终内联体积更小。
 */
export class LabelManager {
  private items: Array<{ hotspot: Hotspot; el: HTMLDivElement }> = [];
  private visible = true;
  private tmp = new THREE.Vector3();

  constructor(private container: HTMLDivElement) {}

  setHotspots(hotspots: Hotspot[]): void {
    this.container.innerHTML = '';
    this.items = hotspots.map((h, i) => {
      const el = document.createElement('div');
      el.className = 'hotspot';
      el.innerHTML = `<span class="hotspot-dot">${i + 1}</span><span class="hotspot-text">${h.text}</span>`;
      this.container.appendChild(el);
      return { hotspot: h, el };
    });
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.container.style.display = v ? '' : 'none';
  }

  get isVisible(): boolean { return this.visible; }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.visible) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const { hotspot, el } of this.items) {
      this.tmp.copy(hotspot.position).project(camera);
      const behind = this.tmp.z > 1;
      const dist = camera.position.distanceTo(hotspot.position);
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      const onScreen = sx > -80 && sx < w + 80 && sy > -40 && sy < h + 40;
      el.style.display = !behind && onScreen && dist < 12 ? 'block' : 'none';
      el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px)`;
      el.style.opacity = dist > 9 ? '0.45' : '1';
      el.style.pointerEvents = dist > 12 ? 'none' : 'auto';
    }
  }
}
