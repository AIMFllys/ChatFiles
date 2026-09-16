import * as THREE from 'three';
import { materials as M } from '../core/materials';
import { box, cyl, sphere, tubeBetween } from '../util/primitives';

/**
 * 就座的同学（照片3/4 右侧工位）：低多边形但比例写实，
 * 黑色 T 恤、灰裤、黑发，身体微前倾伏案。局部 -X 为朝向（面对墙面桌面）。
 */

function officeChair(): THREE.Group {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.65 });
  const darkFabric = M.fabric('#222428', 88, 0.95);
  // 五星脚
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(0.04, 0.03, 0.28, black);
    leg.position.set(Math.sin(a) * 0.13, 0.07, Math.cos(a) * 0.13);
    leg.rotation.y = a;
    g.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10), black);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(Math.sin(a) * 0.27, 0.035, Math.cos(a) * 0.27);
    g.add(wheel);
  }
  const gas = cyl(0.025, 0.03, 0.42, M.chrome(), 14);
  gas.position.y = 0.28;
  g.add(gas);
  const seat = box(0.44, 0.08, 0.42, darkFabric);
  seat.position.y = 0.52;
  g.add(seat);
  // 靠背（微倾）
  const backG = new THREE.Group();
  backG.position.set(0.18, 0.82, 0);
  backG.rotation.z = 0.12;
  const back = box(0.09, 0.62, 0.42, darkFabric);
  backG.add(back);
  for (let i = 0; i < 3; i++) {
    const seam = box(0.005, 0.01, 0.36, black, { cast: false });
    seam.position.set(-0.048, -0.18 + i * 0.16, 0);
    backG.add(seam);
  }
  g.add(backG);
  // 扶手
  for (const sz of [-1, 1]) {
    const arm = box(0.26, 0.03, 0.06, black);
    arm.position.set(-0.02, 0.66, sz * 0.24);
    g.add(arm);
    const support = box(0.03, 0.12, 0.03, black);
    support.position.set(0.08, 0.6, sz * 0.24);
    g.add(support);
  }
  return g;
}

export function createSeatedStudent(): THREE.Group {
  const g = new THREE.Group();
  g.add(officeChair());

  const skin = new THREE.MeshStandardMaterial({ color: 0xe2b79a, roughness: 0.7 });
  const shirt = M.fabric('#1f2125', 99, 0.92);
  const pants = M.fabric('#5c6068', 77, 0.9);
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x171312, roughness: 0.85 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.5 });

  // 骨盆 + 躯干（前倾）
  const torso = new THREE.Group();
  torso.position.set(-0.04, 0.78, 0);
  torso.rotation.z = 0.18;
  const chest = box(0.22, 0.42, 0.36, shirt);
  chest.position.y = 0.2;
  torso.add(chest);
  // 脖子 + 头
  const neck = cyl(0.035, 0.04, 0.06, skin, 12);
  neck.position.y = 0.44;
  torso.add(neck);
  const head = sphere(0.095, skin, 18);
  head.position.set(-0.01, 0.55, 0);
  head.scale.set(1.02, 1.1, 1.02);
  torso.add(head);
  const hair = sphere(0.098, hairMat, 18);
  hair.position.set(0.01, 0.58, 0);
  hair.scale.set(1.05, 0.9, 1.05);
  torso.add(hair);
  // 额前碎发
  const bang = box(0.12, 0.05, 0.18, hairMat);
  bang.position.set(-0.07, 0.56, 0);
  bang.rotation.z = -0.2;
  torso.add(bang);
  g.add(torso);

  // 手臂：肩 → 肘 → 手（伸向桌面，桌面在 -x 侧）
  const shoulderL = new THREE.Vector3(-0.06, 1.02, 0.13);
  const elbowL = new THREE.Vector3(-0.22, 0.82, 0.13);
  const handL = new THREE.Vector3(-0.4, 0.74, 0.06);
  g.add(tubeBetween(shoulderL, elbowL, 0.032, shirt, 10));
  g.add(tubeBetween(elbowL, handL, 0.026, skin, 10));
  const shoulderR = new THREE.Vector3(-0.06, 1.02, -0.13);
  const elbowR = new THREE.Vector3(-0.22, 0.84, -0.13);
  const handR = new THREE.Vector3(-0.4, 0.74, -0.06);
  g.add(tubeBetween(shoulderR, elbowR, 0.032, shirt, 10));
  g.add(tubeBetween(elbowR, handR, 0.026, skin, 10));
  for (const p of [handL, handR]) {
    const h = sphere(0.03, skin, 10);
    h.position.copy(p);
    g.add(h);
  }

  // 大腿（水平前伸 -x）+ 小腿（垂直）+ 鞋
  for (const sz of [-1, 1]) {
    const thigh = box(0.34, 0.1, 0.12, pants);
    thigh.position.set(-0.19, 0.5, sz * 0.09);
    g.add(thigh);
    const calf = box(0.1, 0.34, 0.11, pants);
    calf.position.set(-0.35, 0.3, sz * 0.09);
    g.add(calf);
    const shoe = box(0.16, 0.07, 0.1, shoeMat);
    shoe.position.set(-0.4, 0.075, sz * 0.09);
    g.add(shoe);
  }
  return g;
}
