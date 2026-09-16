import * as THREE from 'three';
import { BALCONY } from '../config';
import { materials as M } from '../core/materials';
import { box, cyl, plane, tubeBetween } from '../util/primitives';
import { outsideTex } from '../core/decals';
import { hangingPants, hangingShirt } from '../util/cloth';
import { addWaterSurface, createBasin, createBucket } from '../objects/props';

const { halfW: HW, zNear, zFar, length: LEN } = BALCONY;

/** 波轮洗衣机（深灰，顶盖玻璃 + 前盖凹凸线条） */
function washingMachine(): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.58, 0.86, 0.6, M.darkAppliance());
  body.position.y = 0.43;
  g.add(body);
  // 顶盖深色玻璃
  const lid = box(0.5, 0.02, 0.5, new THREE.MeshPhysicalMaterial({ color: 0x20262e, roughness: 0.12, metalness: 0.3, clearcoat: 0.8 }));
  lid.position.set(0, 0.87, -0.02);
  g.add(lid);
  const consolePanel = box(0.5, 0.08, 0.08, M.plastic(0x4a4f56, 0.4));
  consolePanel.position.set(0, 0.83, 0.28);
  g.add(consolePanel);
  for (let i = 0; i < 3; i++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 12), M.plastic(i === 0 ? 0x6fb8e0 : 0xd8d8d2, 0.4));
    btn.rotation.x = Math.PI / 2;
    btn.position.set(-0.15 + i * 0.1, 0.83, 0.325);
    g.add(btn);
  }
  // 前面板压纹
  for (let i = 0; i < 3; i++) {
    const groove = box(0.4, 0.012, 0.008, M.plastic(0x30353b, 0.5), { cast: false });
    groove.position.set(0, 0.25 + i * 0.12, 0.305);
    g.add(groove);
  }
  return g;
}

/** 壁挂白色陶瓷水槽 + 生锈钢支架 + 水龙头（照片2 右侧） */
function wallSink(): THREE.Group {
  const g = new THREE.Group();
  const ceramic = M.porcelain();
  const bowl = box(0.42, 0.16, 0.5, ceramic);
  bowl.position.y = 0.72;
  g.add(bowl);
  const inner = box(0.32, 0.02, 0.38, new THREE.MeshStandardMaterial({ color: 0xd8dad3, roughness: 0.35 }), { cast: false });
  inner.position.set(0, 0.805, 0.02);
  g.add(inner);
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 14), M.chrome());
  drain.position.set(0, 0.82, 0.05);
  g.add(drain);
  // 支架（生锈角钢）
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a5c46, roughness: 0.7, metalness: 0.5 });
  for (const sz of [-1, 1]) {
    g.add(tubeBetween(new THREE.Vector3(sz * 0.17, 0.66, -0.2), new THREE.Vector3(sz * 0.17, 0.66, 0.18), 0.015, rust, 8));
    g.add(tubeBetween(new THREE.Vector3(sz * 0.17, 0.66, -0.2), new THREE.Vector3(sz * 0.17, 0.3, -0.24), 0.015, rust, 8));
  }
  // 龙头
  g.add(tubeBetween(new THREE.Vector3(0, 0.82, -0.2), new THREE.Vector3(0, 0.95, -0.2), 0.015, M.chrome(), 10));
  g.add(tubeBetween(new THREE.Vector3(0, 0.95, -0.2), new THREE.Vector3(0, 0.95, -0.05), 0.015, M.chrome(), 10));
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12), M.chrome());
  knob.position.set(0.06, 0.97, -0.2);
  g.add(knob);
  // 下水波纹软管
  g.add(tubeBetween(new THREE.Vector3(0, 0.66, 0.05), new THREE.Vector3(0.04, 0.35, 0.1), 0.02, M.plastic(0xd8d8d2, 0.8), 8));
  return g;
}

/** 洗涤剂瓶（高/矮/按色） */
function detergentBottle(color: number, pump = false): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.1, 0.22, 0.08, new THREE.MeshStandardMaterial({ color, roughness: 0.45 }));
  body.position.y = 0.11;
  g.add(body);
  const neck = cyl(0.02, 0.025, 0.05, M.plastic(color, 0.45), 12);
  neck.position.y = 0.245;
  g.add(neck);
  if (pump) {
    const pumpHead = box(0.05, 0.02, 0.02, M.plastic(0xf2f2ee, 0.4));
    pumpHead.position.set(0.015, 0.285, 0);
    g.add(pumpHead);
  } else {
    const cap = cyl(0.025, 0.025, 0.03, M.plastic(0xf0f0ea, 0.4), 12);
    cap.position.y = 0.285;
    g.add(cap);
  }
  const label = box(0.075, 0.1, 0.002, M.plastic(0xf4f2ea, 0.7), { cast: false });
  label.position.set(0, 0.11, 0.041);
  g.add(label);
  return g;
}

function bigWindow(parent: THREE.Object3D): void {
  const z0 = zFar + 0.1;
  const z1 = zNear - 0.1;
  const y0 = 0.85;
  const y1 = 2.35;
  const x = -HW;
  const out = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, y1 - y0),
    new THREE.MeshBasicMaterial({ map: outsideTex(), toneMapped: false }));
  out.rotation.y = Math.PI / 2;
  out.position.set(x - 0.1, (y0 + y1) / 2, (z0 + z1) / 2);
  parent.add(out);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, y1 - y0), M.glass());
  glass.rotation.y = Math.PI / 2;
  glass.position.set(x - 0.02, (y0 + y1) / 2, (z0 + z1) / 2);
  parent.add(glass);
  const frame = M.metalDark();
  for (let i = 0; i <= 3; i++) {
    const zz = z0 + (i / 3) * (z1 - z0);
    const f = box(0.05, y1 - y0 + 0.08, 0.05, frame);
    f.position.set(x, (y0 + y1) / 2, zz);
    parent.add(f);
  }
  for (const yy of [y0, y1]) {
    const f = box(0.05, 0.05, z1 - z0 + 0.1, frame);
    f.position.set(x, yy, (z0 + z1) / 2);
    parent.add(f);
  }
  // 窗台
  const sill = box(0.16, 0.04, z1 - z0, M.tilePlain());
  sill.position.set(x + 0.06, y0 - 0.03, (z0 + z1) / 2);
  parent.add(sill);
}

export function buildBalcony(parent: THREE.Object3D): Record<string, THREE.Vector3> {
  const g = new THREE.Group();
  parent.add(g);

  // 地面（比寝室低 2cm，瓷砖）
  const floor = box(HW * 2, 0.04, LEN, M.tile(1, 3, 5));
  floor.position.set(0, -0.04, (zNear + zFar) / 2);
  floor.castShadow = false;
  g.add(floor);

  // 顶板
  const ceil = plane(HW * 2, LEN, M.tilePlain(), { receive: true, cast: false });
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 2.55, (zNear + zFar) / 2);
  g.add(ceil);

  // 左墙：窗下瓷砖矮墙（朝室内 +X）
  const low = plane(LEN - 0.1, 0.85, M.tile(0, 5, 2));
  low.rotation.y = Math.PI / 2;
  low.position.set(-HW, 0.425, (zNear + zFar) / 2);
  g.add(low);
  bigWindow(g);
  // 左墙窗上梁
  const upperL = plane(LEN, 0.2, M.tile(0, 5, 1));
  upperL.rotation.y = Math.PI / 2;
  upperL.position.set(-HW, 2.45, (zNear + zFar) / 2);
  g.add(upperL);

  // 远墙（z=zFar）：瓷砖矮墙 + 中部高窗 + 上梁
  const farZ = zFar - 0.03;
  const w1 = plane(HW * 2, 0.9, M.tile(1, 4, 3));
  w1.position.set(0, 0.45, farZ);
  g.add(w1);
  const w2 = plane(HW * 2, 0.35, M.tile(0, 4, 1));
  w2.position.set(0, 2.375, farZ);
  g.add(w2);
  const farWin = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 1.15),
    new THREE.MeshBasicMaterial({ map: outsideTex(), toneMapped: false }));
  farWin.position.set(0, 1.625, farZ + 0.02);
  g.add(farWin);

  // 与卫生间隔墙 x=0.8（贴砖），门洞 z -5.5~-4.7 高 1.95
  const xWall = HW;
  const doorZ0 = -5.5, doorZ1 = -4.7, doorTop = 1.95;
  const segA = plane(doorZ0 - zFar, 2.55, M.tile(0, 2, 6));
  segA.rotation.y = -Math.PI / 2;
  segA.position.set(xWall, 1.275, (zFar + doorZ0) / 2);
  g.add(segA);
  const segB = plane(zNear - doorZ1, 2.55, M.tile(1, 2, 6));
  segB.rotation.y = -Math.PI / 2;
  segB.position.set(xWall, 1.275, (doorZ1 + zNear) / 2);
  g.add(segB);
  const segC = plane(doorZ1 - doorZ0, 2.55 - doorTop, M.tile(0, 2, 1));
  segC.rotation.y = -Math.PI / 2;
  segC.position.set(xWall, doorTop + (2.55 - doorTop) / 2, (doorZ0 + doorZ1) / 2);
  g.add(segC);

  // 洗衣机 + 台面 + 洗涤用品
  const wm = washingMachine();
  wm.position.set(-0.2, 0, -5.85);
  g.add(wm);
  const counter = box(1.5, 0.04, 0.4, M.tilePlain());
  counter.position.set(0, 0.86, -6.16);
  g.add(counter);
  const bottles: Array<[number, number, boolean]> = [[0x7bb7e8, -0.62, true], [0x7fc98a, -0.36, false], [0x4a90d9, -0.1, false], [0xe8b341, 0.5, false]];
  bottles.forEach(([c, x, p], i) => {
    const b = detergentBottle(c, p);
    b.position.set(x, 0.88, -6.12 + (i % 2) * 0.08);
    g.add(b);
  });
  const basket = box(0.22, 0.14, 0.16, M.plastic(0x8fc0b8, 0.7));
  basket.position.set(0.28, 0.95, -6.15);
  g.add(basket);
  // 沥水篮格孔（深色细条）
  for (let i = 0; i < 5; i++) {
    const slot = box(0.012, 0.08, 0.14, M.plastic(0x6fa89e, 0.8), { cast: false });
    slot.position.set(0.2 + i * 0.04, 0.95, -6.15);
    g.add(slot);
  }

  // 壁挂水槽（靠右墙）
  const sink = wallSink();
  sink.position.set(0.58, 0, -5.1);
  sink.rotation.y = -Math.PI / 2;
  g.add(sink);

  // 三只脸盆 + 桶（照片2 前景）
  const basin1 = createBasin(0x9fc6dd); basin1.position.set(-0.45, 0, -4.5); g.add(basin1);
  addWaterSurface(basin1);
  const basin2 = createBasin(0x8fb8d8); basin2.position.set(-0.4, 0.02, -4.78); basin2.scale.setScalar(0.92); g.add(basin2);
  const basin3 = createBasin(0xcfe3a8); basin3.position.set(0.25, 0, -4.55); g.add(basin3);
  const bucket = createBucket(0xdfe3dc); bucket.position.set(0.25, 0.14, -4.55); bucket.scale.setScalar(0.9); g.add(bucket);

  // 拖把斜靠左窗
  g.add(tubeBetween(new THREE.Vector3(-0.62, 0.1, -4.5), new THREE.Vector3(-0.3, 1.6, -5.4), 0.015, M.metalDark(), 10));
  const mopHead = box(0.18, 0.05, 0.1, M.plastic(0x9aa0a6, 0.9));
  mopHead.position.set(-0.64, 0.05, -4.45);
  g.add(mopHead);

  // 顶杆晾晒衣物（照片2 头顶黑/灰/绿衣物）
  for (const [zz, n] of [[-5.0, 5], [-5.75, 4]] as const) {
    g.add(tubeBetween(new THREE.Vector3(-0.68, 2.12, zz), new THREE.Vector3(0.68, 2.12, zz), 0.012, M.chrome(), 8));
    for (let i = 0; i < n; i++) {
      const x = -0.55 + i * (1.1 / (n - 1));
      const cloth = i % 2 === 0
        ? hangingShirt(0.42, 0.62, M.fabric(i === 1 ? '#2c2f34' : '#5a636b', 200 + i), i)
        : hangingPants(0.4, 0.72, M.fabric(i === 1 ? '#6f7a5e' : '#3c4148', 210 + i), i);
      cloth.position.set(x, 2.1, zz + (i % 2) * 0.05);
      cloth.rotation.y = (i - 2) * 0.06;
      g.add(cloth);
    }
  }

  // 地漏
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.006, 16), M.chrome());
  drain.position.set(0.1, 0.0, -5.7);
  g.add(drain);

  return {
    washer: new THREE.Vector3(-0.2, 0.5, -5.85),
    sink: new THREE.Vector3(0.55, 0.8, -5.1),
    basins: new THREE.Vector3(-0.1, 0.25, -4.55),
    laundry: new THREE.Vector3(0, 1.8, -5.4),
  };
}
