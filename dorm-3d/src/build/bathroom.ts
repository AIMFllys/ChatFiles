import * as THREE from 'three';
import { BATH } from '../config';
import { materials as M } from '../core/materials';
import { box, cyl, plane, tubeBetween } from '../util/primitives';
import { floorMatTex, noticeTex, outsideTex, towelTex } from '../core/decals';
import { pipePath } from '../util/primitives';
import { wavyPlane } from '../util/cloth';
import { createSquatToilet, createStainDecal } from '../objects/toilet';

const { xNear, xFar, width: BW, zNear, zFar } = BATH;
const CX = (xNear + xFar) / 2;
const CEIL = 2.55;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 墙面（朝向室内 -X） */
function rightWall(parent: THREE.Object3D): void {
  const x = xFar;
  // 主砖面（窗洞 z -5.35~-4.55, y 1.55~2.2）
  const wz0 = -5.35, wz1 = -4.55, wy0 = 1.55, wy1 = 2.2;
  const full = (z0: number, z1: number, y0: number, y1: number) => {
    const p = plane(z1 - z0, y1 - y0, M.tile(2, Math.max(1, Math.round((z1 - z0) * 2)), Math.max(1, Math.round((y1 - y0) * 2))));
    p.rotation.y = -Math.PI / 2;
    p.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(p);
  };
  full(zFar, zNear, 0, CEIL); // 先整面（后用窗框盖住窗洞，避免共面片）
  // 高窗：深色玻璃 + 纱网纹理
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(wz1 - wz0, wy1 - wy0),
    new THREE.MeshBasicMaterial({ map: outsideTex(), toneMapped: false }));
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(x - 0.02, (wy0 + wy1) / 2, (wz0 + wz1) / 2);
  parent.add(glass);
  const frame = M.metalDark();
  for (const zz of [wz0, (wz0 + wz1) / 2, wz1]) {
    const f = box(0.05, wy1 - wy0, 0.04, frame);
    f.position.set(x - 0.01, (wy0 + wy1) / 2, zz);
    parent.add(f);
  }
  for (const yy of [wy0, wy1]) {
    const f = box(0.05, 0.04, wz1 - wz0, frame);
    f.position.set(x - 0.01, yy, (wz0 + wz1) / 2);
    parent.add(f);
  }
}

function farWall(parent: THREE.Object3D): void {
  const z = zFar + 0.02;
  const w1 = plane(BW, CEIL, M.tile(2, 4, 7));
  w1.position.set(CX, CEIL / 2, z);
  parent.add(w1);
  // 两张蓝色热水须知（照片1）
  const signs = [
    noticeTex('热水服务须知', ['· 使用前请确认水温', '· 洗浴时保持通风', '· 故障请拨值班室']),
    noticeTex('节约用水 安全用电', ['· 人走断电关水', '· 禁止私拉电线', '· 地面湿滑请慢行']),
  ];
  signs.forEach((tex, i) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    s.position.set(1.05, 1.75 - i * 0.3, z + 0.01);
    parent.add(s);
  });
}

function frontWall(parent: THREE.Object3D): void {
  // z=zNear，x 0.8..2.2（与主寝室后墙相接的外墙面，内侧贴砖）
  const p = plane(BW, CEIL, M.tile(2, 4, 7));
  p.rotation.y = Math.PI;
  p.position.set(CX, CEIL / 2, zNear - 0.02);
  parent.add(p);
}

function plumbing(parent: THREE.Object3D): void {
  const pipe = M.pipe();
  const z = zFar + 0.06;
  // 两根主立管 + 顶部横管 + 中部横管接到右墙
  pipePath([V(1.4, 0.25, z), V(1.4, 2.15, z), V(1.4, 2.4, z), V(1.25, 2.4, z), V(1.25, CEIL, z)], 0.022, pipe, parent);
  pipePath([V(1.7, 0.3, z), V(1.7, 1.5, z)], 0.018, pipe, parent);
  pipePath([V(1.4, 0.95, z), V(2.05, 0.95, z), V(2.05, 0.95, zFar + 0.25)], 0.02, pipe, parent);
  // U 型弯（照片里立管中部的小 U）
  pipePath([V(1.55, 0.55, z), V(1.55, 0.4, z), V(1.66, 0.4, z), V(1.66, 0.55, z)], 0.014, pipe, parent, 0.016);

  // 花洒：立管顶伸出 + 扁平喷头
  parent.add(tubeBetween(V(1.4, 1.95, z), V(1.4, 1.95, z + 0.16), 0.016, M.chrome(), 12));
  const head = cyl(0.06, 0.05, 0.03, M.chrome(), 24);
  head.position.set(1.4, 1.88, z + 0.18);
  head.scale.set(0.8, 1, 1.15);
  parent.add(head);
  for (let i = 0; i < 6; i++) {
    const dot = cyl(0.003, 0.003, 0.004, M.plastic(0x999994, 0.4), 6, { cast: false });
    dot.position.set(1.4 + (i % 3) * 0.025 - 0.025, 1.86, z + 0.18 + Math.floor(i / 3) * 0.03 - 0.015);
    parent.add(dot);
  }
  // 混水阀 + 出水嘴
  const mixer = cyl(0.05, 0.05, 0.06, M.chrome(), 20);
  mixer.rotation.x = Math.PI / 2;
  mixer.position.set(1.7, 1.25, z + 0.02);
  parent.add(mixer);
  parent.add(tubeBetween(V(1.7, 1.2, z + 0.05), V(1.7, 1.2, z + 0.18), 0.014, M.chrome(), 12));
  for (const xx of [1.62, 1.78]) {
    const knob = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 6, 14), M.chrome());
    knob.position.set(xx, 1.32, z + 0.03);
    parent.add(knob);
  }
  // 灰色控制盒 + 电线
  const boxy = box(0.16, 0.12, 0.08, M.plastic(0xb8bcb6, 0.6));
  boxy.position.set(1.95, 1.22, z + 0.03);
  parent.add(boxy);
  pipePath([V(1.86, 1.2, z + 0.05), V(1.84, 1.05, z + 0.05), V(1.75, 1.0, z + 0.08)], 0.005, M.plastic(0x2a2a2a, 0.9), parent, 0.005);

  // 墙面管卡
  for (const yy of [0.6, 1.3, 2.0]) {
    const clamp = box(0.05, 0.02, 0.02, M.pipe());
    clamp.position.set(1.4, yy, z - 0.005);
    parent.add(clamp);
  }
}

function rackAndTowels(parent: THREE.Object3D): void {
  const x = xFar - 0.12;
  const zc = -5.6;
  const aluminum = M.chrome();
  // 铝线置物架（框 + 纵向线）
  const y0 = 1.42, y1 = 1.6;
  const segs = [
    [x, y0, zc - 0.35, x, y0, zc + 0.35],
    [x, y1, zc - 0.35, x, y1, zc + 0.35],
  ] as const;
  for (const s of segs) parent.add(tubeBetween(V(s[0], s[1], s[2]), V(s[3], s[4], s[5]), 0.012, aluminum, 8));
  for (const zz of [-0.35, 0.35]) {
    parent.add(tubeBetween(V(x, y0, zc + zz), V(x, y1, zc + zz), 0.012, aluminum, 8));
  }
  for (let i = 0; i < 9; i++) {
    parent.add(tubeBetween(V(x, y0, zc - 0.32 + i * 0.08), V(x - 0.26, y0, zc - 0.32 + i * 0.08), 0.006, aluminum, 6));
  }
  parent.add(tubeBetween(V(x - 0.26, y0, zc - 0.35), V(x - 0.26, y0, zc + 0.35), 0.008, aluminum, 8));
  // 洗护瓶
  const shampoo = cyl(0.035, 0.04, 0.2, new THREE.MeshStandardMaterial({ color: 0x4a3548, roughness: 0.4 }), 16);
  shampoo.position.set(x - 0.13, y0 + 0.1, zc - 0.15);
  parent.add(shampoo);
  const pump = box(0.05, 0.03, 0.02, M.plastic(0x222226, 0.5));
  pump.position.set(x - 0.13, y0 + 0.21, zc - 0.15);
  parent.add(pump);
  // 吹风机（黑色筒）
  parent.add(tubeBetween(V(x - 0.1, y0 + 0.08, zc + 0.15), V(x - 0.26, y0 + 0.1, zc + 0.22), 0.035, M.plastic(0x2a2f38, 0.4), 14));
  // 挂杆 + 两条毛巾
  parent.add(tubeBetween(V(xFar - 0.1, 1.34, zc - 0.3), V(xFar - 0.1, 1.34, zc + 0.3), 0.012, aluminum, 8));
  const towel1 = wavyPlane(0.24, 0.5, new THREE.MeshStandardMaterial({ map: towelTex('stripe'), roughness: 0.95, side: THREE.DoubleSide }), { amp: 0.02, freq: 8 });
  towel1.rotation.y = -Math.PI / 2;
  towel1.position.set(xFar - 0.12, 1.08, zc - 0.12);
  parent.add(towel1);
  const towel2 = wavyPlane(0.26, 0.44, new THREE.MeshStandardMaterial({ map: towelTex('leaf'), roughness: 0.95, side: THREE.DoubleSide }), { amp: 0.02, freq: 7, phase: 1 });
  towel2.rotation.y = -Math.PI / 2;
  towel2.position.set(xFar - 0.12, 1.1, zc + 0.13);
  parent.add(towel2);
  // 马桶刷（红柄）
  const brush = cyl(0.012, 0.012, 0.4, M.plastic(0xc4503e, 0.5), 10);
  brush.position.set(xFar - 0.08, 0.55, -4.5);
  parent.add(brush);
  const cup = cyl(0.05, 0.045, 0.1, M.plastic(0xe8e8e2, 0.6), 16);
  cup.position.set(xFar - 0.08, 0.05, -4.5);
  parent.add(cup);
}

function drainPipe(parent: THREE.Object3D): void {
  // 右墙粗排污立管（照片1 右侧带黑垢的铸铁管）
  const pipe = new THREE.MeshStandardMaterial({ color: 0x8f8f88, roughness: 0.5, metalness: 0.7 });
  const x = xFar - 0.04;
  const zc = -4.2;
  const main = cyl(0.055, 0.055, CEIL, pipe, 18);
  main.position.set(x, CEIL / 2, zc);
  parent.add(main);
  for (const yy of [0.35, 1.2, 2.1]) {
    const ring = cyl(0.062, 0.062, 0.08, M.pipe(), 18);
    ring.position.set(x, yy, zc);
    parent.add(ring);
    const grime = cyl(0.058, 0.058, 0.03, new THREE.MeshStandardMaterial({ color: 0x3f3e38, roughness: 1 }), 16, { cast: false });
    grime.position.set(x, yy - 0.06, zc);
    parent.add(grime);
  }
  parent.add(tubeBetween(V(x, 2.0, zc), V(x, 2.0, zc - 0.35), 0.05, pipe, 16));
}

function ventPanel(parent: THREE.Object3D): void {
  // 斜靠墙角的白色通风百叶板（照片1 左角）
  const g = new THREE.Group();
  const panel = box(0.04, 0.5, 0.34, M.plastic(0xecece8, 0.7));
  g.add(panel);
  for (let i = 0; i < 10; i++) {
    const slat = box(0.005, 0.012, 0.28, M.plastic(0x70747a, 0.8), { cast: false });
    slat.position.set(0.023, -0.2 + i * 0.044, 0);
    g.add(slat);
  }
  g.position.set(0.92, 0.27, -4.25);
  g.rotation.z = 0.12;
  parent.add(g);
}

export function buildBathroom(parent: THREE.Object3D): Record<string, THREE.Vector3> {
  const g = new THREE.Group();
  parent.add(g);

  // 地面（重污瓷砖）+ 顶板
  const floor = box(BW, 0.04, BATH.length, M.tile(3, 4, 7));
  floor.position.set(CX, -0.04, (zNear + zFar) / 2);
  floor.castShadow = false;
  g.add(floor);
  const ceil = plane(BW, BATH.length, M.tilePlain(), { receive: true, cast: false });
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(CX, CEIL, (zNear + zFar) / 2);
  g.add(ceil);

  // 门洞朝阳台的另一面（与阳台侧贴面成对，双面可见）
  const doorZ0 = -5.5, doorZ1 = -4.7, doorTop = 1.95;
  const face = (z0: number, z1: number, y0: number, y1: number) => {
    const p = plane(z1 - z0, y1 - y0, M.tile(2, Math.max(1, Math.round((z1 - z0) * 2)), Math.max(1, Math.round((y1 - y0) * 2))));
    p.rotation.y = Math.PI / 2;
    p.position.set(0.8, (y0 + y1) / 2, (z0 + z1) / 2);
    g.add(p);
  };
  face(zFar, doorZ0, 0, CEIL);
  face(doorZ1, zNear, 0, CEIL);
  face(doorZ0, doorZ1, doorTop, CEIL);
  // 门框
  const fm = M.metalDark();
  for (const zz of [doorZ0, doorZ1]) {
    const f = box(0.06, doorTop, 0.06, fm);
    f.position.set(0.8, doorTop / 2, zz);
    g.add(f);
  }
  const ftop = box(0.06, 0.06, doorZ1 - doorZ0 + 0.06, fm);
  ftop.position.set(0.8, doorTop, (doorZ0 + doorZ1) / 2);
  g.add(ftop);

  rightWall(g);
  farWall(g);
  frontWall(g);
  plumbing(g);
  drainPipe(g);
  ventPanel(g);
  rackAndTowels(g);

  // 蹲便器（贴右侧，面朝门）
  const toilet = createSquatToilet();
  toilet.position.set(1.55, 0, -4.8);
  g.add(toilet);

  // 黑色镂空防滑垫
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95),
    new THREE.MeshStandardMaterial({ map: floorMatTex(), roughness: 0.85 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(1.12, 0.006, -4.75);
  g.add(mat);

  // 墙角 / 便器周边污渍
  const s1 = createStainDecal(0.7, 0.6, 71, 0.9); s1.position.set(1.5, 0, -5.2); g.add(s1);
  const s2 = createStainDecal(0.5, 0.4, 72, 0.8); s2.position.set(1.0, 0, -4.15); g.add(s2);
  const s3 = createStainDecal(0.6, 0.4, 73, 0.7); s3.position.set(1.9, 0, -5.9); g.add(s3);

  return {
    toilet: new THREE.Vector3(1.55, 0.2, -4.8),
    shower: new THREE.Vector3(1.4, 1.85, zFar + 0.2),
    rack: new THREE.Vector3(xFar - 0.15, 1.5, -5.6),
    mat: new THREE.Vector3(1.12, 0.05, -4.75),
  };
}
