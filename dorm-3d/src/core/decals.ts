import * as THREE from 'three';
import { makeRng } from '../util/primitives';

/** 标牌 / 屏幕 / 海报类"印刷品"纹理：内容用矢量图形拼出，不引用版权图。 */

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 动漫风海报（照片5 桌面墙上海报的程序化替代：暖色街道 + 三个可爱人物剪影） */
export function posterTex(): THREE.CanvasTexture {
  const [c, x] = cv(640, 460);
  const grd = x.createLinearGradient(0, 0, 0, 460);
  grd.addColorStop(0, '#f6c98d'); grd.addColorStop(0.55, '#e88f6b'); grd.addColorStop(1, '#7c5a86');
  x.fillStyle = grd; x.fillRect(0, 0, 640, 460);
  // 远景楼群
  x.fillStyle = 'rgba(70,52,82,.55)';
  for (let i = 0; i < 9; i++) {
    const bw = 60 + (i % 3) * 26, bx = i * 74 - 20, bh = 150 + (i % 4) * 36;
    x.fillRect(bx, 300 - bh, bw, bh);
    x.fillStyle = 'rgba(255,230,170,.5)';
    for (let wy = 0; wy < 4; wy++) for (let wx2 = 0; wx2 < 2; wx2++) x.fillRect(bx + 12 + wx2 * 26, 300 - bh + 16 + wy * 30, 10, 14);
    x.fillStyle = 'rgba(70,52,82,.55)';
  }
  // 星星
  const rng = makeRng(11);
  x.fillStyle = '#fff3c4';
  for (let i = 0; i < 40; i++) {
    x.beginPath(); x.arc(rng() * 640, rng() * 190, 1 + rng() * 2.2, 0, Math.PI * 2); x.fill();
  }
  // 三个 Q 版人物
  const people: Array<[number, string, string]> = [[210, '#d94f5c', '#3a2740'], [330, '#5aa0d9', '#2a2a3a'], [450, '#e8b341', '#40331f']];
  for (const [px, cloth, hair] of people) {
    x.fillStyle = cloth;
    x.beginPath(); x.moveTo(px - 46, 420); x.quadraticCurveTo(px, 320, px + 46, 420); x.fill();
    x.fillStyle = '#f3d3b8';
    x.beginPath(); x.arc(px, 300, 34, 0, Math.PI * 2); x.fill();
    x.fillStyle = hair;
    x.beginPath(); x.arc(px, 286, 37, Math.PI, 0); x.lineTo(px + 37, 306); x.lineTo(px - 37, 306); x.fill();
    x.fillStyle = '#333';
    x.beginPath(); x.arc(px - 11, 302, 3.4, 0, Math.PI * 2); x.arc(px + 11, 302, 3.4, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#b06a55'; x.lineWidth = 2.5;
    x.beginPath(); x.arc(px, 312, 8, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
  }
  // 标题字块
  x.font = 'bold 42px sans-serif';
  x.fillStyle = '#fff6e0';
  x.strokeStyle = 'rgba(80,40,60,.45)'; x.lineWidth = 6;
  x.strokeText('DAYS · 日常', 34, 64); x.fillText('DAYS · 日常', 34, 64);
  return tex(c);
}

/** IDE 代码屏幕（照片5 笔记本亮屏） */
export function codeScreenTex(): THREE.CanvasTexture {
  const [c, x] = cv(640, 400);
  x.fillStyle = '#1e2430'; x.fillRect(0, 0, 640, 400);
  x.fillStyle = '#2a3140'; x.fillRect(0, 0, 640, 34);
  const dot = ['#e06c75', '#e5c07b', '#98c379'];
  dot.forEach((d2, i) => { x.fillStyle = d2; x.beginPath(); x.arc(18 + i * 20, 17, 6, 0, Math.PI * 2); x.fill(); });
  const colors = ['#c678dd', '#61afef', '#98c379', '#e06c75', '#abb2bf', '#d19a66'];
  const lines = [
    [['import ', 0], ['* as THREE ', 1], ['from ', 0], ["'three'", 4]],
    [['class ', 0], ['DormBuilder ', 1], ['{', 5]],
    [['  constructor', 2], ['() {', 5]],
    [['    this.scene ', 5], ['= ', 0], ['new ', 0], ['THREE.Scene', 1], ['();', 5]],
    [['    this.build', 2], ['Room', 1], ['();', 5]],
    [['    this.build', 2], ['Stations', 1], ['();', 5]],
    [['  }', 5]],
    [['  build', 2], ['Room', 1], ['() {', 5]],
    [['    const ', 0], ['floor ', 5], ['= make', 2], ['Wood', 1], ['();', 5]],
    [['    this.scene', 1], ['.add', 2], ['(floor);', 5]],
    [['  }', 5]],
    [['}', 5]],
  ];
  x.font = '17px Menlo, Consolas, monospace';
  lines.forEach((segments, i) => {
    const y = 62 + i * 26;
    x.fillStyle = '#5b6472'; x.fillText(String(i + 1).padStart(2, ' '), 14, y);
    let xx = 52;
    for (const [str, ci] of segments as Array<[string, number]>) {
      x.fillStyle = colors[ci];
      x.fillText(str, xx, y);
      xx += x.measureText(str).width;
    }
  });
  return tex(c);
}

/** 深色待机副屏 */
export function darkScreenTex(): THREE.CanvasTexture {
  const [c, x] = cv(320, 200);
  const g = x.createLinearGradient(0, 0, 320, 200);
  g.addColorStop(0, '#10141a'); g.addColorStop(1, '#222a36');
  x.fillStyle = g; x.fillRect(0, 0, 320, 200);
  x.strokeStyle = 'rgba(150,180,220,.12)';
  x.beginPath(); x.moveTo(0, 160); x.lineTo(320, 60); x.stroke();
  return tex(c);
}

/** 蓝色热水使用须知（照片1 墙面两张蓝牌） */
export function noticeTex(title: string, lines: string[]): THREE.CanvasTexture {
  const [c, x] = cv(420, 300);
  x.fillStyle = '#1f5e94'; x.fillRect(0, 0, 420, 46);
  x.fillStyle = '#fff'; x.font = 'bold 24px sans-serif';
  x.fillText(title, 16, 31);
  x.fillStyle = '#eaf2fa'; x.fillRect(0, 46, 420, 254);
  x.fillStyle = '#24507a'; x.font = '17px sans-serif';
  lines.forEach((l, i) => x.fillText(l, 18, 82 + i * 26));
  x.fillStyle = '#1f5e94'; x.fillRect(0, 272, 420, 28);
  x.fillStyle = '#cfe2f2'; x.font = '14px sans-serif';
  x.fillText('热水服务 · 二十四小时', 18, 291);
  return tex(c);
}

/** 毛巾纹样：蓝条纹 / 米色树叶（照片1 两条毛巾） */
export function towelTex(kind: 'stripe' | 'leaf'): THREE.CanvasTexture {
  const [c, x] = cv(256, 360);
  if (kind === 'stripe') {
    x.fillStyle = '#5b7fa6'; x.fillRect(0, 0, 256, 360);
    for (let i = 0; i < 256; i += 24) { x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(i, 0, 8, 360); }
    x.fillStyle = 'rgba(20,40,70,.35)'; x.fillRect(0, 0, 256, 26); x.fillRect(0, 334, 256, 26);
  } else {
    x.fillStyle = '#e8e2d2'; x.fillRect(0, 0, 256, 360);
    x.fillStyle = '#b7ac90';
    for (let ry = 40; ry < 340; ry += 64) for (let rx = 30; rx < 230; rx += 64) {
      x.save(); x.translate(rx, ry); x.rotate(-0.5);
      x.beginPath(); x.ellipse(0, 0, 8, 18, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
  }
  return tex(c);
}

/** 黑色镂空防滑垫（照片1 地面） */
export function floorMatTex(): THREE.CanvasTexture {
  const [c, x] = cv(256, 512);
  x.fillStyle = '#23262a'; x.fillRect(0, 0, 256, 512);
  x.fillStyle = '#9aa0a6';
  for (let row = 0; row < 15; row++) for (let col = 0; col < 3; col++) {
    const ww = col === 1 ? 56 : 40;
    x.beginPath();
    const px = 40 + col * 72 - ww / 2;
    x.roundRect(px, 26 + row * 32, ww, 12, 6); x.fill();
  }
  return tex(c);
}

/** 窗外景：过曝天光 + 对面学生楼轮廓（照片2 阳台窗） */
export function outsideTex(): THREE.CanvasTexture {
  const [c, x] = cv(512, 512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#fdfdf6'); g.addColorStop(1, '#dfe8ee');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  x.fillStyle = 'rgba(150,165,178,.5)';
  x.fillRect(60, 120, 180, 392); x.fillRect(280, 70, 170, 442);
  x.fillStyle = 'rgba(250,250,235,.75)';
  for (let by = 150; by < 490; by += 56) for (let bx = 84; bx < 220; bx += 46) x.fillRect(bx, by, 26, 34);
  for (let by = 100; by < 490; by += 56) for (let bx = 304; bx < 420; bx += 46) x.fillRect(bx, by, 26, 34);
  return tex(c);
}

/** 地面污渍透明贴花 */
export function stainTex(seed = 1, hue = '96,80,48'): THREE.CanvasTexture {
  const [c, x] = cv(256, 256);
  const rng = makeRng(seed);
  for (let i = 0; i < 14; i++) {
    const r = 20 + rng() * 90;
    const g = x.createRadialGradient(128, 128, 4, 128, 128, r);
    g.addColorStop(0, `rgba(${hue},${0.2 + rng() * 0.18})`);
    g.addColorStop(1, `rgba(${hue},0)`);
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(128 + (rng() - 0.5) * 90, 128 + (rng() - 0.5) * 90, r, r * (0.5 + rng() * 0.6), rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  return tex(c);
}
