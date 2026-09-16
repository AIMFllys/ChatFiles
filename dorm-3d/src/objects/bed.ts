import * as THREE from 'three';
import { BED, type StationStyle } from '../config';
import { materials as M } from '../core/materials';
import { box, cyl, tubeBetween } from '../util/primitives';
import { blanket, saggyTop, wavyPlane } from '../util/cloth';

/**
 * 单侧"上床下桌"的高架床（照片3/4 两侧各三组）：
 * 黑色方钢立柱 + 实木条床板（照片5 仰视可见）+ 护栏 + 被褥 + 蚊帐纱幔。
 * 局部坐标：-X 靠墙，+X 朝过道；搭建后右墙站位旋转 180°。
 */

const BEDDING_COLORS = ['#43566e', '#8b949c', '#c9c4b8'];
const HEM_COLORS = [0x33506e, 0x555c64, 0x6e7a86];

function steelPost(x: number, z: number, frameMat: THREE.Material): THREE.Mesh {
  const p = box(BED.postSize, BED.railTop, BED.postSize, frameMat);
  p.position.set(x, BED.railTop / 2, z);
  return p;
}

function buildNet(g: THREE.Group, w: number, l: number, hemColor: number, phase: number): void {
  const net = M.mosquitoNet();
  const topY = BED.railTop + 0.05;
  // 顶部（微下垂）
  const top = saggyTop(w + 0.12, l + 0.12, net, 0.05);
  top.position.y = topY;
  g.add(top);
  // 四面纱幔：过道侧与两端下摆到底，靠墙侧短一些（照片中靠墙纱较收拢）
  const hAisle = 1.05;
  const aisle = wavyPlane(l, hAisle, net, { segW: 28, segH: 14, amp: 0.03, freq: 8, phase, sag: 0.05 });
  aisle.position.set(w / 2 + 0.03, topY - hAisle / 2, 0);
  aisle.rotation.y = Math.PI / 2;
  g.add(aisle);
  const wall = wavyPlane(l, 0.5, net, { segW: 20, segH: 8, amp: 0.02, freq: 8, phase: phase + 2 });
  wall.position.set(-w / 2 - 0.02, topY - 0.25, 0);
  wall.rotation.y = -Math.PI / 2;
  g.add(wall);
  for (const zs of [-1, 1]) {
    const end = wavyPlane(w, hAisle * 0.9, net, { segW: 16, segH: 12, amp: 0.03, freq: 9, phase: zs });
    end.position.set(0, topY - hAisle * 0.45, zs * (l / 2 + 0.02));
    end.rotation.y = zs > 0 ? Math.PI : 0;
    g.add(end);
  }
  // 蓝色下摆包边（照片里蚊帐底边的深色横条）
  const hemMat = new THREE.MeshStandardMaterial({ color: hemColor, roughness: 0.85, side: THREE.DoubleSide });
  const hem = new THREE.Mesh(new THREE.PlaneGeometry(l, 0.07), hemMat);
  hem.position.set(w / 2 + 0.035, topY - hAisle + 0.04, 0);
  hem.rotation.y = Math.PI / 2;
  g.add(hem);
  // 两根蚊帐支架杆
  const rodMat = M.metalDark();
  g.add(tubeBetween(new THREE.Vector3(w / 2, topY + 0.02, -l / 2), new THREE.Vector3(w / 2, topY + 0.02, l / 2), 0.012, rodMat, 8));
}

function buildLadder(g: THREE.Group, w: number, l: number, frameMat: THREE.Material): void {
  // 绿色钢管爬梯，固定在床头过道侧（照片4 右床可见）
  const mat = M.metalGreen();
  const z = -l / 2 - 0.06;
  const x0 = w / 2 - 0.02;
  for (const xx of [x0, x0 - 0.32]) {
    g.add(tubeBetween(new THREE.Vector3(xx, 0.05, z), new THREE.Vector3(xx, BED.railY + 0.1, z), 0.022, mat, 10));
  }
  for (let i = 0; i < 6; i++) {
    const y = 0.25 + i * 0.26;
    g.add(tubeBetween(new THREE.Vector3(x0, y, z), new THREE.Vector3(x0 - 0.32, y, z), 0.022, mat, 10));
  }
  void frameMat;
}

/** 挂篮 / 挂衣钩（照片4 床架上的白色收纳篮） */
function buildBasket(g: THREE.Group, w: number, l: number, seed: number): void {
  const basketMat = M.plastic(0xecece8, 0.7);
  const bz = seed > 0.5 ? -l / 2 + 0.3 : l / 2 - 0.3;
  const basket = new THREE.Group();
  // 篮筐用格栅条拼
  const ww = 0.34, hh = 0.16, dd = 0.2;
  for (let i = 0; i < 5; i++) {
    const slat = box(0.008, hh, 0.008, basketMat, { cast: false });
    slat.position.set(-ww / 2 + i * (ww / 4), hh / 2, 0);
    basket.add(slat);
  }
  const b1 = box(ww, 0.01, dd, basketMat, { cast: false }); b1.position.y = 0.005; basket.add(b1);
  const b2 = box(ww, 0.01, dd, basketMat, { cast: false }); b2.position.y = hh; basket.add(b2);
  basket.position.set(w / 2 + 0.04, BED.deckY - 0.42, bz);
  g.add(basket);
}

export interface BedOpts {
  style: StationStyle;
  side: 'left' | 'right';
  withLadder?: boolean;
  seed?: number;
}

export function createLoftBed(opts: BedOpts): THREE.Group {
  const g = new THREE.Group();
  const w = BED.width;
  const l = BED.length;
  const frameMat = M.metalDark();

  // 四角立柱
  for (const px of [-w / 2, w / 2]) {
    for (const pz of [-l / 2, l / 2]) {
      g.add(steelPost(px, pz, frameMat));
    }
  }
  // 床板框架
  const railH = 0.08;
  const side1 = box(0.06, railH, l, frameMat); side1.position.set(-w / 2, BED.deckY, 0); g.add(side1);
  const side2 = side1.clone(); side2.position.x = w / 2; g.add(side2);
  const end1 = box(w, railH, 0.06, frameMat); end1.position.set(0, BED.deckY, -l / 2); g.add(end1);
  const end2 = end1.clone(); end2.position.z = l / 2; g.add(end2);

  // 实木条板（照片5 床底仰视的木条）
  const slatCount = 11;
  for (let i = 0; i < slatCount; i++) {
    const slat = box(w - 0.1, 0.025, 0.1, M.plankWood());
    slat.position.set(0, BED.deckY + 0.045, -l / 2 + 0.14 + i * ((l - 0.28) / (slatCount - 1)));
    g.add(slat);
  }

  // 床垫 + 被褥
  const mattressMat = M.fabric('#e6e2d6', 11 + opts.style.bedding);
  const mattress = box(w - 0.06, 0.12, l - 0.1, mattressMat);
  mattress.position.set(0, BED.deckY + 0.115, 0);
  g.add(mattress);
  const cover = blanket(w - 0.08, l * 0.62, M.fabric(BEDDING_COLORS[opts.style.bedding], 31 + opts.style.bedding), opts.style.bedding * 2);
  cover.position.set(0, BED.deckY + 0.185, 0.12);
  g.add(cover);
  // 枕头
  const pillow = box(0.42, 0.1, 0.62, M.fabric('#f0ece2', 41), undefined);
  pillow.position.set(0, BED.deckY + 0.22, -l / 2 + 0.35);
  pillow.rotation.z = 0.04;
  g.add(pillow);
  // 叠放的被子卷（照片里床头常有一团）
  const roll = cyl(0.11, 0.11, w - 0.2, M.fabric('#b9c2cc', 51), 16);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, BED.deckY + 0.24, -l / 2 + 0.12);
  g.add(roll);

  // 过道侧护栏（两端留出入口）
  const guardH = BED.railTop - BED.railY;
  const gr1 = box(0.04, guardH, 0.04, frameMat); gr1.position.set(w / 2, (BED.railY + BED.railTop) / 2, -l / 2 + 0.12); g.add(gr1);
  const gr2 = gr1.clone(); gr2.position.z = l / 2 - 0.12; g.add(gr2);
  const grMid = box(0.04, 0.04, l - 0.5, frameMat); grMid.position.set(w / 2, BED.railTop - 0.02, 0); g.add(grMid);
  for (let i = 0; i < 3; i++) {
    const bar = box(0.03, guardH, 0.03, frameMat);
    bar.position.set(w / 2, (BED.railY + BED.railTop) / 2, -0.5 + i * 0.5);
    g.add(bar);
  }

  // 蚊帐
  buildNet(g, w, l, HEM_COLORS[opts.style.curtain], opts.style.curtain * 3 + 1);
  if (opts.withLadder) buildLadder(g, w, l, frameMat);
  buildBasket(g, w, l, (opts.seed ?? 5) % 7);

  if (opts.side === 'right') g.rotation.y = Math.PI;
  return g;
}
