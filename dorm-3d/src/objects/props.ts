import * as THREE from 'three';
import { materials as M } from '../core/materials';
import { box, cyl, makeRng, sphere, tubeBetween } from '../util/primitives';

/** 寝室 / 阳台 / 卫生间共用的小道具集合。 */

/** 塑料脸盆（Lathe 旋转成型，照片2 蓝/绿三只盆） */
export function createBasin(color = 0x8fb8d8): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector2(0.05, 0),
    new THREE.Vector2(0.14, 0.0),
    new THREE.Vector2(0.2, 0.02),
    new THREE.Vector2(0.23, 0.1),
    new THREE.Vector2(0.225, 0.12),
    new THREE.Vector2(0.2, 0.11),
    new THREE.Vector2(0.13, 0.03),
    new THREE.Vector2(0.05, 0.02),
  ];
  const geo = new THREE.LatheGeometry(pts, 28);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

/** 水桶（锥形桶身 + 提手） */
export function createBucket(color = 0xdfe3dc): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.13, 0.28, 24, 1, true),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide }),
  );
  body.position.y = 0.14;
  body.castShadow = true;
  g.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 8, 24), M.plastic(color, 0.5));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.28;
  g.add(rim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.005, 6, 20, Math.PI), M.chrome());
  handle.position.y = 0.2;
  g.add(handle);
  return g;
}

/** 一双拖鞋（鞋底 + 一条鞋带） */
export function createSlippers(color = 0xd8d8d2): THREE.Group {
  const g = new THREE.Group();
  const mat = M.plastic(color, 0.7);
  for (const sz of [-1, 1]) {
    const sole = box(0.1, 0.02, 0.26, mat);
    sole.position.set(sz * 0.07, 0.01, 0);
    g.add(sole);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 16, Math.PI), mat);
    strap.rotation.x = Math.PI / 2;
    strap.rotation.z = Math.PI;
    strap.position.set(sz * 0.07, 0.035, -0.02);
    g.add(strap);
  }
  return g;
}

/** 一双运动鞋（低帮简化造型） */
export function createShoes(color = 0x22252a, seed = 1): THREE.Group {
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  for (const sz of [-1, 1]) {
    const shoe = new THREE.Group();
    const sole = box(0.1, 0.03, 0.27, M.plastic(0xe8e8e0, 0.7));
    sole.position.y = 0.015;
    shoe.add(sole);
    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), mat);
    upper.scale.set(0.72, 0.55, 1.5);
    upper.position.set(0, 0.06, -0.02);
    upper.castShadow = true;
    shoe.add(upper);
    const tongue = box(0.07, 0.05, 0.08, mat);
    tongue.position.set(0, 0.08, -0.07);
    tongue.rotation.x = 0.5;
    shoe.add(tongue);
    shoe.position.set(sz * 0.075, 0, 0);
    shoe.rotation.y = (rng() - 0.5) * 0.25;
    g.add(shoe);
  }
  return g;
}

/** 皱塑料袋（半透明白色团） */
export function createPlasticBag(color = 0xf0f0ea): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.9, side: THREE.DoubleSide });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), mat);
  blob.scale.set(0.9, 1.15, 0.8);
  blob.position.y = 0.16;
  blob.castShadow = true;
  g.add(blob);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14, Math.PI * 1.2), mat);
  handle.position.y = 0.33;
  g.add(handle);
  return g;
}

/** 帆布袋（红/白购物袋，照片4 地面红色袋） */
export function createToteBag(color = 0xb23a3a): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.34, 0.4, 0.12, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  body.position.y = 0.2;
  g.add(body);
  for (const hx of [-0.1, 0.1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.01, 6, 14, Math.PI), M.plastic(0x2a2a2a, 0.8));
    h.position.set(hx, 0.44, 0);
    g.add(h);
  }
  return g;
}

/** 金属衣架（可多只叠挂） */
export function createHangers(count = 3): THREE.Group {
  const g = new THREE.Group();
  const mat = M.chrome();
  for (let i = 0; i < count; i++) {
    const h = new THREE.Group();
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 10, Math.PI * 1.3), mat);
    hook.position.y = 0.1;
    hook.rotation.z = 0.4;
    h.add(hook);
    const a = new THREE.Vector3(0, 0.07, 0);
    h.add(tubeBetween(a, new THREE.Vector3(-0.17, -0.03, 0), 0.0035, mat, 6));
    h.add(tubeBetween(a, new THREE.Vector3(0.17, -0.03, 0), 0.0035, mat, 6));
    h.add(tubeBetween(new THREE.Vector3(-0.17, -0.03, 0), new THREE.Vector3(0.17, -0.03, 0), 0.0035, mat, 6));
    h.position.z = i * 0.03;
    h.rotation.y = (i - count / 2) * 0.08;
    g.add(h);
  }
  return g;
}

/** 叠放的塑料凳（照片3 尽端摞起的凳子） */
export function createStools(count = 3): THREE.Group {
  const g = new THREE.Group();
  const mat = M.plastic(0x3a4a52, 0.6);
  for (let i = 0; i < count; i++) {
    const st = new THREE.Group();
    const seat = cyl(0.16, 0.15, 0.03, mat, 24);
    seat.position.y = 0.015;
    st.add(seat);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = cyl(0.012, 0.016, 0.42, mat, 8);
      leg.position.set(Math.cos(a) * 0.11, 0.21, Math.sin(a) * 0.11);
      st.add(leg);
    }
    st.position.y = i * 0.05;
    g.add(st);
  }
  return g;
}

/** 圆形盆内的一点水面（照片2 盆里有水） */
export function addWaterSurface(basin: THREE.Group, r = 0.15, y = 0.075): void {
  const w = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
    new THREE.MeshStandardMaterial({ color: 0x9fc6dd, transparent: true, opacity: 0.55, roughness: 0.15 }));
  w.rotation.x = -Math.PI / 2;
  w.position.y = y;
  w.receiveShadow = false;
  basin.add(w);
}

/** 垃圾桶（锥形绿/灰桶 + 溢出的纸团） */
export function createTrashBin(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.3, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x6f8a6a, roughness: 0.7, side: THREE.DoubleSide }));
  body.position.y = 0.15;
  body.castShadow = true;
  g.add(body);
  const paper = sphere(0.05, M.plastic(0xf2f0e8, 0.95), 10);
  paper.position.set(0.03, 0.3, 0.02);
  g.add(paper);
  return g;
}
