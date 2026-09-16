/** HUD 覆盖层：加载状态机、视角预设按钮、开关按钮。 */

export interface ViewButton {
  id: string;
  label: string;
  hint?: string;
}

export const VIEW_BUTTONS: ViewButton[] = [
  { id: 'overview', label: '全景', hint: '入户视角' },
  { id: 'desk', label: '书桌工位', hint: '照片5 机位' },
  { id: 'beds', label: '上下铺', hint: '六组高架床' },
  { id: 'student', label: '自习同学', hint: '右中工位' },
  { id: 'balcony', label: '阳台洗衣区', hint: '照片2' },
  { id: 'bathroom', label: '卫生间', hint: '照片1' },
  { id: 'door', label: '入口与吊柜', hint: '照片4' },
];

export type ToggleId = 'rotate' | 'night' | 'labels';

export interface ToggleState {
  rotate: boolean;
  night: boolean;
  labels: boolean;
}

export class Overlay {
  private loader = document.getElementById('loader') as HTMLDivElement;
  private loaderMsg = document.getElementById('loaderMsg') as HTMLDivElement;
  onView?: (id: string) => void;
  onToggle?: (id: ToggleId, on: boolean) => void;
  private state: ToggleState = { rotate: false, night: false, labels: true };

  constructor() {
    const bar = document.getElementById('viewBar') as HTMLElement;
    VIEW_BUTTONS.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.id = b.id;
      btn.innerHTML = `<span>${b.label}</span>${b.hint ? `<em>${b.hint}</em>` : ''}`;
      btn.addEventListener('click', () => {
        bar.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        this.onView?.(b.id);
      });
      bar.appendChild(btn);
    });

    const toggles: Array<[ToggleId, string]> = [
      ['rotate', '自动旋转'], ['night', '夜间模式'], ['labels', '热点标注'],
    ];
    const tbar = document.getElementById('toggleBar') as HTMLElement;
    toggles.forEach(([id, label]) => {
      const btn = document.createElement('button');
      btn.className = 'chip toggle';
      if (id === 'labels') btn.classList.add('active');
      btn.innerHTML = `<i></i><span>${label}</span>`;
      btn.addEventListener('click', () => {
        const on = !this.state[id];
        this.state[id] = on;
        btn.classList.toggle('active', on);
        this.onToggle?.(id, on);
      });
      tbar.appendChild(btn);
    });
  }

  setMessage(msg: string): void { this.loaderMsg.textContent = msg; }

  hideLoader(): void {
    this.loader.classList.add('done');
    setTimeout(() => { this.loader.style.display = 'none'; }, 700);
  }

  failLoader(reason: string): void {
    this.loader.classList.add('error');
    this.loader.querySelector('.loader-ring')?.remove();
    this.loader.querySelector('.loader-title')!.textContent = '初始化失败';
    this.loaderMsg.textContent = reason.slice(0, 180);
  }
}
