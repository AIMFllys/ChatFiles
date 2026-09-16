import * as THREE from 'three';
import { materials as M } from '../core/materials';
import { box, cyl, sphere, tubeBetween } from '../util/primitives';

/** 寝室地面/墙边的大件杂物（照片3/4）。 */

/** 米黄色双门铁皮衣柜（照片3 右侧） */
export function createWardrobe(): THREE.Group {
  const g = new THREE.Group();
  const w = 0.72, h = 1.95, d = 0.55;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.75, metalness: 0.2 });
  const body = box(w, h, d, bodyMat);
  body.position.y = h / 2;
  g.add(body);
  // 柜门压线
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xb4ab96, roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const doorLine = box(0.008, h - 0.06, 0.008, lineMat, { cast: false });
    doorLine.position.set(sx * (w / 2 - 0.06), h / 2, d / 2 + 0.006);
    g.add(doorLine);
    const handle = tubeBetween(
      new THREE.Vector3(sx * 0.06, 0.8, d / 2 + 0.03),
      new THREE.Vector3(sx * 0.06, 1.15, d / 2 + 0.03),
      0.012, M.chrome(), 10,
    );
    g.add(handle);
  }
  const centerLine = box(0.01, h - 0.08, 0.01, lineMat, { cast: false });
  centerLine.position.set(0, h / 2, d / 2 + 0.007);
  g.add(centerLine);
  // 顶部纸箱/被褥堆
  const bundle = box(0.6, 0.16, 0.45, M.fabric('#b9b2a2', 123));
  bundle.position.set(0, h + 0.08, 0);
  g.add(bundle);
  // 凹痕/贴纸
  const dent = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16),
    new THREE.MeshStandardMaterial({ color: 0xb0a792, roughness: 0.9 }));
  dent.position.set(-0.2, 1.4, d / 2 + 0.008);
  g.add(dent);
  return g;
}

/** 硬壳行李箱（黑色横纹，照片4 床架之间） */
export function createSuitcase(color = 0x26292e): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 });
  const body = box(0.42, 0.58, 0.26, mat);
  body.position.y = 0.33;
  g.add(body);
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x35393f, roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const rib = box(0.38, 0.015, 0.01, ribMat, { cast: false });
    rib.position.set(0, 0.12 + i * 0.09, 0.135);
    g.add(rib);
  }
  // 拉链边
  const seam = box(0.4, 0.008, 0.012, M.chrome(), { cast: false });
  seam.position.set(0, 0.33, 0.138);
  g.add(seam);
  // 轮子
  for (const sx of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), M.plastic(0x111111, 0.6));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 0.15, 0.03, 0.1);
    g.add(wheel);
  }
  // 拉杆
  g.add(tubeBetween(new THREE.Vector3(-0.12, 0.6, 0), new THREE.Vector3(-0.12, 0.78, 0), 0.01, M.chrome(), 8));
  g.add(tubeBetween(new THREE.Vector3(0.12, 0.6, 0), new THREE.Vector3(0.12, 0.78, 0), 0.01, M.chrome(), 8));
  g.add(tubeBetween(new THREE.Vector3(-0.12, 0.78, 0), new THREE.Vector3(0.12, 0.78, 0), 0.01, M.chrome(), 8));
  // 托运吊牌
  const tag = box(0.05, 0.09, 0.004, M.plastic(0xf0eee2, 0.8), { cast: false });
  tag.position.set(0.15, 0.42, 0.14);
  tag.rotation.z = 0.2;
  g.add(tag);
  return g;
}

/** 开口纸箱（照片4 床底收纳） */
export function createCardboardBox(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 0.92 });
  const w = 0.5, d = 0.4, h = 0.36, t = 0.02;
  const bottom = box(w, t, d, mat); bottom.position.y = t / 2; g.add(bottom);
  const sides: Array<[number, number, number, number, number, number]> = [
    [w, h, t, 0, h / 2, d / 2], [w, h, t, 0, h / 2, -d / 2],
    [t, h, d, w / 2, h / 2, 0], [t, h, d, -w / 2, h / 2, 0],
  ];
  for (const [sw, sh, sd, px, py, pz] of sides) {
    const s = box(sw, sh, sd, mat);
    s.position.set(px, py, pz);
    g.add(s);
  }
  // 外翻的摇盖
  const flap1 = box(w, t, d * 0.4, mat);
  flap1.position.set(0, h + 0.06, d * 0.62);
  flap1.rotation.x = -0.35;
  g.add(flap1);
  const flap2 = box(w, t, d * 0.4, mat);
  flap2.position.set(0, h + 0.05, -d * 0.6);
  flap2.rotation.x = 0.3;
  g.add(flap2);
  // 箱内露出的衣物
  const cloth = sphere(0.14, M.fabric('#3a3d42', 144), 12);
  cloth.scale.set(1.2, 0.7, 1);
  cloth.position.set(0.04, h + 0.02, 0);
  g.add(cloth);
  return g;
}

/** 黑色 A 字踏步梯（照片5 床架旁，蓝色踏面条） */
export function createStepLadder(): THREE.Group {
  const g = new THREE.Group();
  const frameMat = M.metalDark();
  const treadMat = M.plastic(0x3c6aa3, 0.55);
  const h = 1.4;
  // 两侧 A 字架（局部沿 z 展开）
  for (const sx of [-1, 1]) {
    g.add(tubeBetween(new THREE.Vector3(sx * 0.22, 0, 0.18), new THREE.Vector3(sx * 0.16, h, 0), 0.02, frameMat, 10));
    g.add(tubeBetween(new THREE.Vector3(sx * 0.22, 0, -0.18), new THREE.Vector3(sx * 0.16, h, 0), 0.02, frameMat, 10));
  }
  for (let i = 1; i <= 4; i++) {
    const y = (h * i) / 5;
    const half = 0.22 - (y / h) * 0.06;
    const step = box(0.2, 0.03, 0.34, treadMat);
    step.position.set(half - 0.22, y, 0);
    g.add(step);
  }
  const top = box(0.18, 0.05, 0.3, frameMat);
  top.position.set(-0.02, h, 0);
  g.add(top);
  // 防滑脚垫
  for (const sz of [-1, 1]) {
    const foot = cyl(0.03, 0.035, 0.03, M.plastic(0x111111, 0.8), 10);
    foot.position.set(0.22, 0.015, sz * 0.18);
    g.add(foot);
  }
  return g;
}

/** 落地风扇（照片4 远处黑色风扇简化体） */
export function createStandFan(): THREE.Group {
  const g = new THREE.Group();
  const mat = M.plastic(0x23262b, 0.5);
  g.add(tubeBetween(new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, 1.05, 0), 0.018, mat, 10));
  const base = cyl(0.16, 0.18, 0.04, mat, 24);
  base.position.y = 0.02;
  g.add(base);
  const head = new THREE.Group();
  head.position.set(0, 1.2, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 32), mat);
  head.add(ring);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.006, 6, 24), mat);
  head.add(innerRing);
  for (let i = 0; i < 3; i++) {
    const blade = box(0.13, 0.03, 0.006, new THREE.MeshStandardMaterial({ color: 0x55606b, transparent: true, opacity: 0.55, roughness: 0.4 }), { cast: false });
    blade.position.set(0.07, 0, 0);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    head.add(blade);
    blade.geometry.translate(0.065, 0, 0);
  }
  const hub = sphere(0.035, mat, 12);
  head.add(hub);
  g.add(head);
  return g;
}
