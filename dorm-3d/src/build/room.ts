import * as THREE from 'three';
import { ROOM } from '../config';
import { materials } from '../core/materials';
import { box, plane } from '../util/primitives';
import { outsideTex } from '../core/decals';

/**
 * 主寝室建筑壳体。
 * 内墙使用单面 Plane（朝向室内），让墙面贴图的"底部返潮带"与世界 Y 对齐；
 * 门窗洞口用多块面片拼出，洞口侧面补白色贴脸（reveal）表现墙厚。
 */

const M = materials;
const HW = ROOM.halfW;

interface Rect { x0: number; x1: number; y0: number; y1: number; }

function wallZ(parent: THREE.Object3D, z: number, r: Rect, faceSign: 1 | -1): void {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const p = plane(w, h, M.wallRepeated(Math.max(1, Math.round(w * 1.2)), Math.max(1, Math.round(h * 1.5))));
  p.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, z);
  p.rotation.y = faceSign > 0 ? 0 : Math.PI;
  parent.add(p);
}

function wallX(parent: THREE.Object3D, x: number, z0: number, z1: number, y0: number, y1: number, faceSign: 1 | -1): void {
  const w = z1 - z0;
  const h = y1 - y0;
  const p = plane(w, h, M.wallRepeated(Math.max(1, Math.round(w * 1.2)), Math.max(1, Math.round(h * 1.5))));
  p.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
  p.rotation.y = faceSign > 0 ? Math.PI / 2 : -Math.PI / 2;
  parent.add(p);
}

/** 在墙面上做一个矩形洞：返回时墙面已被切成 4 块 */
function wallZWithHole(parent: THREE.Object3D, z: number, full: Rect, hole: Rect, faceSign: 1 | -1): void {
  wallZ(parent, z, { x0: full.x0, x1: hole.x0, y0: full.y0, y1: full.y1 }, faceSign);
  wallZ(parent, z, { x0: hole.x1, x1: full.x1, y0: full.y0, y1: full.y1 }, faceSign);
  wallZ(parent, z, { x0: hole.x0, x1: hole.x1, y0: full.y0, y1: hole.y0 }, faceSign);
  wallZ(parent, z, { x0: hole.x0, x1: hole.x1, y0: hole.y1, y1: full.y1 }, faceSign);
}

function wallXWithHole(parent: THREE.Object3D, x: number, zFull: [number, number], fullY: Rect, hole: { z0: number; z1: number; y0: number; y1: number }, faceSign: 1 | -1): void {
  wallX(parent, x, zFull[0], hole.z0, fullY.y0, fullY.y1, faceSign);
  wallX(parent, x, hole.z1, zFull[1], fullY.y0, fullY.y1, faceSign);
  wallX(parent, x, hole.z0, hole.z1, fullY.y0, hole.y0, faceSign);
  wallX(parent, x, hole.z0, hole.z1, hole.y1, fullY.y1, faceSign);
}

function windowAssembly(parent: THREE.Object3D, x: number, zc: number, w: number, y0: number, h: number): void {
  const frameMat = M.metalDark();
  const revealMat = M.wall();
  // 玻璃
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass());
  glass.rotation.y = Math.PI / 2;
  glass.position.set(x - 0.005, y0 + h / 2, zc);
  glass.receiveShadow = false;
  parent.add(glass);
  // 过曝外景
  const out = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, h + 0.3),
    new THREE.MeshBasicMaterial({ map: outsideTex(), toneMapped: false }));
  out.rotation.y = Math.PI / 2;
  out.position.set(x - 0.13, y0 + h / 2, zc);
  parent.add(out);
  // 铝合金分格（边框 + 中梃）
  const fz = 0.04;
  for (const zz of [zc - w / 2, zc, zc + w / 2]) {
    const f = box(fz, h, fz, frameMat);
    f.position.set(x, y0 + h / 2, zz);
    parent.add(f);
  }
  for (const yy of [y0, y0 + h / 2, y0 + h]) {
    const f = box(fz, fz, w, frameMat);
    f.position.set(x, yy, zc);
    parent.add(f);
  }
  // 窗台（磨损水泥）
  const sill = box(0.18, 0.04, w + 0.16, revealMat);
  sill.position.set(x + 0.05, y0 - 0.03, zc);
  parent.add(sill);
}

function entryDoor(parent: THREE.Object3D): void {
  const z = ROOM.zDoor - 0.03;
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a3528, roughness: 0.55, metalness: 0.05 });
  const door = box(0.92, 2.02, 0.05, doorMat);
  door.position.set(0, 1.01, z);
  parent.add(door);
  // 凹凸门板造型
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.6 });
  for (const cy of [0.55, 1.45]) {
    const t1 = box(0.62, 0.03, 0.02, trimMat); t1.position.set(0, cy + 0.32, z - 0.035); parent.add(t1);
    const t2 = box(0.62, 0.03, 0.02, trimMat); t2.position.set(0, cy - 0.32, z - 0.035); parent.add(t2);
    const t3 = box(0.03, 0.66, 0.02, trimMat); t3.position.set(-0.31, cy, z - 0.035); parent.add(t3);
    const t4 = box(0.03, 0.66, 0.02, trimMat); t4.position.set(0.31, cy, z - 0.035); parent.add(t4);
  }
  // 门把手 + 猫眼 + 通知纸
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), M.chrome());
  knob.position.set(0.34, 1.0, z - 0.05);
  parent.add(knob);
  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), M.chrome());
  eye.rotation.x = Math.PI / 2;
  eye.position.set(0, 1.62, z - 0.035);
  parent.add(eye);
  // 门框
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cb, roughness: 0.8 });
  const fL = box(0.08, 2.1, 0.1, frameMat); fL.position.set(-0.5, 1.05, z + 0.01); parent.add(fL);
  const fR = box(0.08, 2.1, 0.1, frameMat); fR.position.set(0.5, 1.05, z + 0.01); parent.add(fR);
  const fT = box(1.08, 0.08, 0.1, frameMat); fT.position.set(0, 2.1, z + 0.01); parent.add(fT);
}

function balconyDoor(parent: THREE.Object3D): void {
  const z = ROOM.zBalcony + 0.03;
  const x0 = -0.8, x1 = 0.8, top = 2.28;
  const frameMat = M.metalDark();
  // 两扇推拉玻璃
  for (const [cx, w] of [[-0.4, 0.78], [0.4, 0.78]] as const) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, top - 0.08), M.glass());
    g.position.set(cx, top / 2, z + 0.01);
    parent.add(g);
    const f = box(0.05, top, 0.06, frameMat);
    f.position.set(cx + w / 2, top / 2, z);
    parent.add(f);
  }
  const fT = box(1.64, 0.07, 0.08, frameMat); fT.position.set(0, top, z); parent.add(fT);
  const fB = box(1.64, 0.06, 0.08, frameMat); fB.position.set(0, 0.03, z); parent.add(fB);
  // 黑色门槛石
  const stone = box(1.6, 0.025, 0.22, new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.3, metalness: 0.1 }));
  stone.position.set(0, 0.012, -3.92);
  parent.add(stone);
  // 推拉把手
  const handle = box(0.025, 0.22, 0.03, M.chrome());
  handle.position.set(0.12, 1.1, z - 0.02);
  parent.add(handle);
}

function overDoorCabinet(parent: THREE.Object3D): void {
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xd9d2bd, roughness: 0.7 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0xcfc7b0, roughness: 0.65 });
  const body = box(1.5, 0.55, 0.28, cabMat);
  body.position.set(0, 2.45, 3.86);
  parent.add(body);
  for (let i = 0; i < 3; i++) {
    const d = box(0.48, 0.48, 0.02, doorMat, { cast: false });
    d.position.set(-0.5 + i * 0.5, 2.45, 3.71);
    parent.add(d);
    const k = box(0.02, 0.08, 0.02, M.metalDark(), { cast: false });
    k.position.set(-0.5 + i * 0.5 + 0.18, 2.4, 3.69);
    parent.add(k);
  }
}

function airConditioner(parent: THREE.Object3D): void {
  const g = new THREE.Group();
  g.position.set(-1.14, 2.2, -3.9);
  const shell = box(0.82, 0.28, 0.22, M.plastic(0xf2f2ee, 0.4));
  g.add(shell);
  // 正面导风板与散热缝
  const vent = box(0.7, 0.07, 0.01, M.plastic(0xdde2e4, 0.6), { cast: false });
  vent.position.set(0, -0.07, 0.115);
  g.add(vent);
  for (let i = 0; i < 8; i++) {
    const slat = box(0.008, 0.05, 0.012, M.plastic(0xbfc6ca, 0.7), { cast: false });
    slat.position.set(-0.3 + i * 0.085, -0.07, 0.122);
    g.add(slat);
  }
  // 指示灯
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), M.emissive(0x66ff99, 2));
  led.position.set(0.32, 0.06, 0.12);
  g.add(led);
  parent.add(g);
}

/** 构建完整主寝室壳体，返回供热点标注使用的关键锚点 */
export function buildRoom(parent: THREE.Object3D): Record<string, THREE.Vector3> {
  const g = new THREE.Group();
  parent.add(g);

  // 地板（顶面 y=0）
  const floor = box(ROOM.width, ROOM.slab, ROOM.length, M.floorWood(2, 6));
  floor.position.set(0, -ROOM.slab / 2, 0);
  floor.castShadow = false;
  g.add(floor);

  // 天花板
  const ceil = plane(ROOM.width, ROOM.length, M.ceiling());
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, ROOM.height, 0);
  ceil.receiveShadow = true;
  g.add(ceil);

  // 端墙：z=+4 入户门洞（宽0.92 高2.08）
  wallZWithHole(g, ROOM.zDoor, { x0: -HW, x1: HW, y0: 0, y1: ROOM.height },
    { x0: -0.46, x1: 0.46, y0: 0, y1: 2.08 }, -1);
  entryDoor(g);
  overDoorCabinet(g);

  // 端墙：z=-4 阳台门洞（宽1.6 高2.28）
  wallZWithHole(g, ROOM.zBalcony, { x0: -HW, x1: HW, y0: 0, y1: ROOM.height },
    { x0: -0.8, x1: 0.8, y0: 0, y1: 2.28 }, 1);
  balconyDoor(g);
  airConditioner(g);

  // 左墙：近门大窗（照片5）+ 尽端小窗（照片3 远端透光）。两洞严格分段，避免共面重叠。
  const xWall = -HW;
  wallX(g, xWall, -4, 4, 0, 0.95, 1);            // 窗下墙
  wallX(g, xWall, -4, 4, 2.2, ROOM.height, 1);   // 窗上墙
  // y0.95~2.2 带内的实墙段（两窗之间与两侧）
  for (const [za, zb] of [[-4, -3.4], [-2.5, 1.9], [3.15, 4]] as const) {
    wallX(g, xWall, za, zb, 0.95, 2.2, 1);
  }
  // 远端小窗的上下楣墙
  wallX(g, xWall, -3.4, -2.5, 0.95, 1.35, 1);
  wallX(g, xWall, -3.4, -2.5, 2.15, 2.2, 1);
  windowAssembly(g, xWall, 2.525, 1.25, 0.95, 1.25);
  windowAssembly(g, xWall, -2.95, 0.9, 1.35, 0.8);

  // 右墙：完整白墙（衣柜/床架贴墙）
  wallX(g, HW, -ROOM.zDoor, ROOM.zDoor, 0, ROOM.height, -1);

  // 踢脚线（深色磨损）
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x9b978c, roughness: 0.9 });
  const baseL = box(0.04, 0.1, ROOM.length - 0.2, baseMat, { cast: false });
  baseL.position.set(-HW + 0.015, 0.05, 0);
  g.add(baseL);
  const baseR = baseL.clone(); baseR.position.x = HW - 0.015; g.add(baseR);

  // 烟感 + 天花板拉线/挂钩（照片3/4 可见）
  const smoke = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.04, 20), M.plastic(0xf5f5f2, 0.6));
  smoke.position.set(0, 2.775, 0.6);
  g.add(smoke);
  for (const hx of [-0.8, 0.8]) {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 8, 16), M.plastic(0xe0e0da));
    hook.position.set(hx, 2.72, -0.8);
    hook.rotation.x = Math.PI / 2;
    g.add(hook);
  }

  return {
    entry: new THREE.Vector3(0, 1.1, 3.7),
    balcony: new THREE.Vector3(0, 1.2, -3.7),
    ac: new THREE.Vector3(-1.14, 2.2, -3.8),
    window: new THREE.Vector3(-1.42, 1.5, 2.5),
  };
}
