import * as THREE from 'three';
import { materials as M } from '../core/materials';
import { box, cyl, makeRng, tubeBetween } from '../util/primitives';

/** 桌面生活道具：按照片3/5 的桌面密度随机但确定性地布置。 */

const BOOK_COLORS = [0x2e5d8c, 0x8c3f3f, 0x3f7a4e, 0xc9a13b, 0x5a4a7a, 0x2f7a7a, 0xb06a2e, 0x444a55];

/** 一排竖立的书（wall=true 时放在墙面书架上） */
export function createBookRow(count: number, seed: number, totalWidth = 0.55): THREE.Group {
  const rng = makeRng(seed * 997 + 13);
  const g = new THREE.Group();
  let x = -totalWidth / 2;
  for (let i = 0; i < count; i++) {
    const th = totalWidth / count * (0.7 + rng() * 0.5);
    const h = 0.16 + rng() * 0.08;
    const d = 0.13 + rng() * 0.04;
    const mat = new THREE.MeshStandardMaterial({ color: BOOK_COLORS[(seed + i) % BOOK_COLORS.length], roughness: 0.75 });
    const b = box(th, h, d, mat);
    b.position.set(x + th / 2, h / 2, 0);
    b.rotation.z = (rng() - 0.5) * 0.08;
    g.add(b);
    // 白色书标签
    if (rng() > 0.4) {
      const lab = box(th * 0.7, 0.02, 0.002, M.plastic(0xf2eee0, 0.8), { cast: false, receive: false });
      lab.position.set(x + th / 2, h * 0.62, d / 2 + 0.002);
      g.add(lab);
    }
    x += th + 0.004;
  }
  return g;
}

/** 平放的一摞书 */
export function createBookStack(seed: number): THREE.Group {
  const rng = makeRng(seed * 331 + 7);
  const g = new THREE.Group();
  let y = 0;
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const th = 0.02 + rng() * 0.02;
    const w = 0.26 + rng() * 0.06;
    const d = 0.18 + rng() * 0.04;
    const b = box(w, th, d, new THREE.MeshStandardMaterial({ color: BOOK_COLORS[(seed + i * 3) % BOOK_COLORS.length], roughness: 0.8 }));
    b.position.set((rng() - 0.5) * 0.02, y + th / 2, 0);
    b.rotation.y = (rng() - 0.5) * 0.06;
    g.add(b);
    y += th + 0.002;
  }
  return g;
}

/** 透明塑料水瓶 + 橙色饮料瓶 */
export function createWaterBottle(kind: 'water' | 'tea' = 'water'): THREE.Group {
  const g = new THREE.Group();
  const clear = new THREE.MeshPhysicalMaterial({
    color: kind === 'water' ? 0xdfeef5 : 0xe8b56a, transparent: true, opacity: 0.38,
    roughness: 0.1, transmission: 0.55, thickness: 0.02,
  });
  const body = cyl(0.032, 0.036, 0.2, clear, 18);
  body.position.y = 0.1;
  g.add(body);
  const water = cyl(0.03, 0.034, 0.12, new THREE.MeshStandardMaterial({ color: kind === 'water' ? 0xaacbe0 : 0xc8813a, transparent: true, opacity: 0.5, roughness: 0.2 }), 18);
  water.position.y = 0.07;
  g.add(water);
  const neck = cyl(0.016, 0.02, 0.04, clear, 14);
  neck.position.y = 0.22;
  g.add(neck);
  const cap = cyl(0.018, 0.018, 0.022, M.plastic(kind === 'water' ? 0x3f7a4e : 0xd9682e, 0.45), 14);
  cap.position.y = 0.25;
  g.add(cap);
  // 标签纸
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.045, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: kind === 'water' ? 0x4a90c2 : 0xf0f0e8, roughness: 0.6, side: THREE.DoubleSide }));
  label.position.y = 0.11;
  g.add(label);
  return g;
}

/** 抽纸盒 */
export function createTissueBox(): THREE.Group {
  const g = new THREE.Group();
  const boxy = box(0.18, 0.07, 0.11, new THREE.MeshStandardMaterial({ color: 0xe6ddc8, roughness: 0.8 }));
  boxy.position.y = 0.035;
  g.add(boxy);
  const slit = box(0.1, 0.004, 0.02, M.plastic(0x88837a, 0.8), { cast: false });
  slit.position.set(0, 0.072, 0);
  g.add(slit);
  const tissue = box(0.06, 0.03, 0.04, M.plastic(0xf8f8f5, 0.95), { cast: false });
  tissue.position.set(0, 0.085, 0);
  g.add(tissue);
  return g;
}

/** 马克杯 */
export function createMug(color = 0xe8e4da): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.038, 0.034, 0.085, M.plastic(color, 0.4), 20);
  body.position.y = 0.042;
  g.add(body);
  const coffee = cyl(0.032, 0.032, 0.004, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.3 }), 20, { cast: false });
  coffee.position.y = 0.086;
  g.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 8, 14, Math.PI * 1.3), M.plastic(color, 0.4));
  handle.position.set(0.038, 0.045, 0);
  handle.rotation.z = -0.3;
  g.add(handle);
  return g;
}

/** 插线板 + 一根凌乱线缆 */
export function createPowerStrip(): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.24, 0.03, 0.06, M.plastic(0xf2f2ee, 0.5));
  body.position.y = 0.015;
  g.add(body);
  for (let i = 0; i < 4; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 10), M.plastic(0x55575c, 0.7));
    hole.position.set(-0.08 + i * 0.05, 0.032, 0);
    g.add(hole);
  }
  const cable = tubeBetween(
    new THREE.Vector3(0.12, 0.012, 0), new THREE.Vector3(0.3, 0.012, 0.12), 0.006,
    M.plastic(0x303236, 0.8), 8,
  );
  g.add(cable);
  return g;
}

/** 耳机（头梁 + 两个耳罩的简化体） */
export function createHeadphones(): THREE.Group {
  const g = new THREE.Group();
  const mat = M.plastic(0x22252a, 0.5);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.01, 8, 24, Math.PI), mat);
  band.position.y = 0.05;
  g.add(band);
  for (const sx of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 16), mat);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(sx * 0.09, 0.05, 0);
    g.add(cup);
  }
  return g;
}
