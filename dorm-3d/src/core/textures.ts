import * as THREE from 'three';
import { makeRng } from '../util/primitives';

/**
 * 全部贴图均由 Canvas2D 程序化生成：木纹、瓷砖、旧墙面、镀锌金属、织物……
 * 不引用任何外部图片，确保最终单文件 HTML 完全离线可用。
 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 复合木地板（照片3/4 的暖棕色长条地板） */
export function floorWoodTex(size = 1024): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(101);
  x.fillStyle = '#8a5f38';
  x.fillRect(0, 0, size, size);
  const rows = 8;
  const ph = size / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * ph;
    let xx = -((r % 2) * 180);
    while (xx < size) {
      const len = 260 + rng() * 220;
      const hue = 28 + rng() * 8;
      const light = 34 + rng() * 12;
      x.fillStyle = `hsl(${hue}, 38%, ${light}%)`;
      x.fillRect(xx, y0, len, ph);
      // 木纹
      for (let i = 0; i < 26; i++) {
        const gy = y0 + rng() * ph;
        x.strokeStyle = `rgba(60,38,18,${0.05 + rng() * 0.1})`;
        x.lineWidth = 1 + rng() * 1.4;
        x.beginPath();
        x.moveTo(xx + 6, gy);
        x.bezierCurveTo(xx + len * 0.3, gy + rng() * 6 - 3, xx + len * 0.7, gy + rng() * 6 - 3, xx + len - 6, gy);
        x.stroke();
      }
      if (rng() > 0.6) { // 木节
        const kx = xx + 40 + rng() * (len - 80);
        const ky = y0 + ph * (0.3 + rng() * 0.4);
        x.strokeStyle = 'rgba(55,34,15,.35)';
        for (let k = 0; k < 3; k++) {
          x.beginPath();
          x.ellipse(kx, ky, 6 + k * 5, 3 + k * 2.4, 0, 0, Math.PI * 2);
          x.stroke();
        }
      }
      x.strokeStyle = 'rgba(40,26,12,.55)';
      x.lineWidth = 2;
      x.strokeRect(xx, y0, len, ph);
      xx += len;
    }
    x.strokeStyle = 'rgba(35,22,10,.7)';
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, y0); x.lineTo(size, y0); x.stroke();
  }
  return toTexture(c, 1);
}

/** 浅色书桌木纹（米黄色直纹） */
export function deskWoodTex(size = 512): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(202);
  x.fillStyle = '#d8c098';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const y = rng() * size;
    x.strokeStyle = `rgba(120,90,50,${0.05 + rng() * 0.09})`;
    x.lineWidth = 0.8 + rng() * 1.4;
    x.beginPath();
    x.moveTo(0, y);
    x.bezierCurveTo(size * 0.3, y + rng() * 8 - 4, size * 0.7, y + rng() * 8 - 4, size, y);
    x.stroke();
  }
  return toTexture(c, 1);
}

/** 床板木条（照片5 上铺底部可见的实木条板） */
export function plankWoodTex(size = 512): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(303);
  x.fillStyle = '#b08a5c';
  x.fillRect(0, 0, size, size);
  const n = 7;
  const pw = size / n;
  for (let i = 0; i < n; i++) {
    x.fillStyle = `hsl(${32 + rng() * 6}, 40%, ${42 + rng() * 12}%)`;
    x.fillRect(i * pw, 0, pw - 3, size);
    for (let g = 0; g < 10; g++) {
      x.strokeStyle = `rgba(70,48,22,${0.08 + rng() * 0.1})`;
      x.beginPath();
      const gx = i * pw + rng() * pw;
      x.moveTo(gx, 0); x.lineTo(gx + rng() * 10 - 5, size); x.stroke();
    }
  }
  return toTexture(c, 1);
}

/** 白色方格瓷砖（卫生间/阳台）。dirt>0 时叠加泛黄污渍。 */
export function whiteTileTex(size = 512, cells = 4, dirt = 0): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(404 + dirt * 17);
  x.fillStyle = '#c9c7bf';
  x.fillRect(0, 0, size, size);
  const t = size / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const l = 88 + rng() * 6 - dirt * 4;
      x.fillStyle = `hsl(${42 + rng() * 8}, 10%, ${l}%)`;
      x.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      // 釉面微弱杂点
      for (let k = 0; k < 30; k++) {
        x.fillStyle = `rgba(120,120,110,${rng() * 0.05})`;
        x.fillRect(i * t + rng() * t, j * t + rng() * t, 2, 2);
      }
    }
  }
  if (dirt > 0) {
    // 沿砖缝的霉黑 + 局部黄渍
    x.strokeStyle = `rgba(70,62,48,${0.25 * dirt})`;
    x.lineWidth = 5;
    for (let i = 0; i <= cells; i++) {
      x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, size); x.stroke();
      x.beginPath(); x.moveTo(0, i * t); x.lineTo(size, i * t); x.stroke();
    }
    for (let s = 0; s < 5 * dirt; s++) {
      const gx = x.createRadialGradient(0, 0, 2, 0, 0, 90);
      gx.addColorStop(0, 'rgba(120,96,50,.28)');
      gx.addColorStop(1, 'rgba(120,96,50,0)');
      x.save();
      x.translate(rng() * size, rng() * size);
      x.fillStyle = gx;
      x.beginPath(); x.arc(0, 0, 90, 0, Math.PI * 2); x.fill();
      x.restore();
    }
  }
  return toTexture(c, 1);
}

/** 旧白墙：底部返潮霉斑、零星污痕（照片3/4 墙面观感） */
export function wallPaintTex(size = 512): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(505);
  x.fillStyle = '#e7e5dd';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 200 + rng() * 45;
    x.fillStyle = `rgba(${v},${v},${v - 6},${0.12 + rng() * 0.12})`;
    const s = 1 + rng() * 2;
    x.fillRect(rng() * size, rng() * size, s, s);
  }
  // 底部 1/5 的返潮带
  const grad = x.createLinearGradient(0, size * 0.78, 0, size);
  grad.addColorStop(0, 'rgba(120,116,100,0)');
  grad.addColorStop(1, 'rgba(96,92,76,.28)');
  x.fillStyle = grad;
  x.fillRect(0, 0, size, size);
  // 几道黑灰色划痕
  for (let i = 0; i < 7; i++) {
    x.strokeStyle = `rgba(90,88,80,${0.08 + rng() * 0.1})`;
    x.lineWidth = 1 + rng() * 2;
    x.beginPath();
    const sx0 = rng() * size;
    const sy0 = rng() * size;
    x.moveTo(sx0, sy0);
    x.lineTo(sx0 + rng() * 40 - 20, sy0 + 30 + rng() * 90);
    x.stroke();
  }
  return toTexture(c, 1);
}

/** 镀锌金属管：银灰底色 + 不规则氧化斑 */
export function galvanizedTex(size = 256): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(606);
  x.fillStyle = '#b4b4ad';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const v = 140 + rng() * 80;
    x.fillStyle = `rgba(${v},${v},${v - 8},${0.15 + rng() * 0.25})`;
    const s = 2 + rng() * 9;
    x.beginPath();
    x.ellipse(rng() * size, rng() * size, s, s * 0.6, rng() * 3, 0, Math.PI * 2);
    x.fill();
  }
  const t = toTexture(c, 2);
  return t;
}

/** 织物底纹（被罩 / 衣物通用）：细经纬线 + 噪点 */
export function fabricTex(base: string, seed = 707, size = 256): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = makeRng(seed);
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);
  x.strokeStyle = 'rgba(255,255,255,.05)';
  x.lineWidth = 1;
  for (let i = 0; i < size; i += 4) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, size); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(size, i); x.stroke();
  }
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = `rgba(0,0,0,${rng() * 0.08})`;
    x.fillRect(rng() * size, rng() * size, 1.4, 1.4);
  }
  return toTexture(c, 2);
}
