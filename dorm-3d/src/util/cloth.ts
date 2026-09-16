import * as THREE from 'three';

/**
 * 程序化布料：用带正弦褶皱的高细分网格模拟蚊帐、被毯、毛巾、晾晒衣物。
 * 所有褶皱均为确定性函数，避免帧间抖动（除非显式加入微风动画）。
 */

export interface ClothOpts {
  segW?: number;
  segH?: number;
  /** 褶皱幅度（米） */
  amp?: number;
  /** 褶皱频率 */
  freq?: number;
  phase?: number;
  /** 底部垂坠量：下边缘中部额外下垂 */
  sag?: number;
  /** 动画相位偏移（多件衣物错峰摆动） */
}

export function wavyPlane(
  w: number, h: number,
  mat: THREE.Material,
  o: ClothOpts = {},
): THREE.Mesh {
  const segW = o.segW ?? 24;
  const segH = o.segH ?? 16;
  const amp = o.amp ?? 0.02;
  const freq = o.freq ?? 10;
  const phase = o.phase ?? 0;
  const sag = o.sag ?? 0;
  const geo = new THREE.PlaneGeometry(w, h, segW, segH);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const v = y / h + 0.5; // 0=底 1=顶
    const strength = 0.35 + (1 - v) * 0.65; // 越靠下摆幅越大
    let z = Math.sin(x * freq + phase) * amp * strength;
    z += Math.sin(x * freq * 2.7 + phase * 1.7) * amp * 0.35 * strength;
    let yy = y;
    if (sag > 0 && v < 0.12) yy -= sag * (1 - Math.abs(x) / (w / 2)) * (1 - v / 0.12);
    pos.setXYZ(i, x, yy, z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 顶部纱帐：中部微微下垂的水平面 */
export function saggyTop(w: number, d: number, mat: THREE.Material, drop = 0.06): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d, 24, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const cx = Math.abs(x) / (w / 2);
    const cy = Math.abs(y) / (d / 2);
    pos.setZ(i, -drop * (1 - Math.max(cx, cy) * 0.55));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.castShadow = false;
  return m;
}

/** 被褥：一块有厚度感的波浪毯（双层边缘用盒子压边） */
export function blanket(w: number, d: number, mat: THREE.Material, phase = 0): THREE.Group {
  const g = new THREE.Group();
  const top = wavyPlane(w, d, mat, { segW: 30, segH: 20, amp: 0.025, freq: 7, phase, sag: 0.03 });
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0;
  g.add(top);
  // 四边垂落
  const drop = wavyPlane(w, 0.18, mat, { segW: 24, segH: 6, amp: 0.015, freq: 9, phase });
  drop.position.set(0, -0.09, d / 2 - 0.02);
  g.add(drop);
  return g;
}

/** 一件挂着的上衣（正面片 + 两个袖片的简化 T 恤轮廓） */
export function hangingShirt(w: number, h: number, mat: THREE.Material, phase = 0): THREE.Group {
  const g = new THREE.Group();
  const body = wavyPlane(w, h * 0.72, mat, { amp: 0.02, freq: 8, phase, sag: 0.05 });
  body.position.y = -h * 0.14;
  g.add(body);
  const sleeveMat = mat;
  const ls = wavyPlane(w * 0.34, h * 0.4, sleeveMat, { amp: 0.025, freq: 9, phase: phase + 1 });
  ls.position.set(-w * 0.58, -h * 0.12, 0);
  ls.rotation.z = 0.5;
  g.add(ls);
  const rs = wavyPlane(w * 0.34, h * 0.4, sleeveMat, { amp: 0.025, freq: 9, phase: phase + 2 });
  rs.position.set(w * 0.58, -h * 0.12, 0);
  rs.rotation.z = -0.5;
  g.add(rs);
  // 领口小三角缺口用深色细环暗示
  return g;
}

/** 一条长裤：两条腿的垂坠布料 */
export function hangingPants(w: number, h: number, mat: THREE.Material, phase = 0): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const leg = wavyPlane(w * 0.42, h * 0.96, mat, { amp: 0.02, freq: 8, phase: phase + sx, sag: 0.04 });
    leg.position.set(sx * w * 0.23, -h * 0.02, 0);
    g.add(leg);
  }
  const seat = wavyPlane(w, h * 0.28, mat, { amp: 0.018, freq: 7, phase });
  seat.position.set(0, -h * 0.82, 0.005);
  g.add(seat);
  return g;
}
