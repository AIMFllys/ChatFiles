import * as THREE from 'three';
import { BED, DESK, type StationStyle } from '../config';
import { materials as M } from '../core/materials';
import { box, makeRng } from '../util/primitives';
import { wavyPlane } from '../util/cloth';
import { posterTex } from '../core/decals';
import { createDeskLamp, createKettle, createLaptop, createMonitor } from './electronics';
import {
  createBookRow, createBookStack, createHeadphones, createMug,
  createPowerStrip, createTissueBox, createWaterBottle,
} from './deskProps';

/**
 * 上床下桌工位：桌体 + 木椅 + 墙面书架/海报/插座 + 床架收纳袋 + 白大褂。
 * 局部坐标与床共用中心：-X 靠墙（墙面 x=-0.46），+X 朝过道。
 */

/** 桌面中心相对组中心的 X 偏移（桌深 0.72 贴墙放置） */
const TOP_CX = BED.width / 2 - DESK.depth / 2; // = 0.10

function createWoodChair(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x9c6f3e, roughness: 0.62 });
  const seat = box(0.42, 0.035, 0.4, wood);
  seat.position.y = 0.45;
  g.add(seat);
  for (let i = 0; i < 3; i++) {
    const slat = box(0.36, 0.02, 0.05, wood);
    slat.position.set(0, 0.475, -0.12 + i * 0.12);
    g.add(slat);
  }
  for (const [px, pz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]] as const) {
    const leg = box(0.04, 0.45, 0.04, wood);
    leg.position.set(px, 0.225, pz);
    g.add(leg);
  }
  for (const px of [-0.18, 0.18]) {
    const post = box(0.04, 0.55, 0.04, wood);
    post.position.set(px, 0.72, 0.17);
    g.add(post);
  }
  for (let i = 0; i < 3; i++) {
    const rail = box(0.4, 0.05, 0.025, wood);
    rail.position.set(0, 0.62 + i * 0.14, 0.175);
    g.add(rail);
  }
  const st1 = box(0.38, 0.03, 0.03, wood); st1.position.set(0, 0.2, -0.17); g.add(st1);
  const st2 = st1.clone(); st2.position.z = 0.17; g.add(st2);
  return g;
}

function createDeskBody(): THREE.Group {
  const g = new THREE.Group();
  const wood = M.deskWood();
  const top = box(DESK.depth, DESK.topThick, DESK.length, wood);
  top.position.set(TOP_CX, DESK.topY, 0);
  g.add(top);
  // 过道端抽屉柜（靠 +z 端）
  const pedCx = TOP_CX + 0.02;
  const ped = box(0.5, 0.7, 0.34, wood);
  ped.position.set(pedCx, 0.35, DESK.length / 2 - 0.22);
  g.add(ped);
  const faceX = pedCx + 0.258;
  for (let i = 0; i < 3; i++) {
    const face = box(0.012, 0.18, 0.28, M.plastic(0xd3bd95, 0.6), { cast: false });
    face.position.set(faceX, 0.15 + i * 0.22, DESK.length / 2 - 0.22);
    g.add(face);
    const handle = box(0.015, 0.015, 0.1, M.metalDark(), { cast: false });
    handle.position.set(faceX + 0.006, 0.15 + i * 0.22, DESK.length / 2 - 0.22);
    g.add(handle);
  }
  // 另一端开放书架格
  const shelfZ = -DESK.length / 2 + 0.22;
  for (const sx of [-0.24, 0.24]) {
    const side = box(0.47, 0.7, 0.025, wood);
    side.position.set(TOP_CX, 0.35, shelfZ + sx);
    g.add(side);
  }
  for (const sy of [0.18, 0.46, 0.69]) {
    const sh = box(0.46, 0.025, 0.46, wood);
    sh.position.set(TOP_CX, sy, shelfZ);
    g.add(sh);
  }
  const books = createBookRow(6, 4, 0.36);
  books.position.set(TOP_CX, 0.19, shelfZ);
  g.add(books);
  // 靠墙背板
  const back = box(0.02, 0.72, DESK.length, M.plastic(0xcdb78f, 0.7), { cast: false });
  back.position.set(-BED.width / 2 + 0.01, 0.36, 0);
  g.add(back);
  return g;
}

/** 床架悬挂收纳袋（照片5 米白黑边四层袋） */
function createOrganizer(): THREE.Group {
  const g = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: 0xe5ddc7, roughness: 0.9, side: THREE.DoubleSide });
  const binding = M.plastic(0x2a2a2a, 0.8);
  const bw = 0.42, bh = 0.86;
  const backing = wavyPlane(bw, bh, cream, { segW: 10, segH: 14, amp: 0.012, freq: 6 });
  backing.position.set(0, -bh / 2, 0);
  g.add(backing);
  for (const sx of [-1, 1]) {
    const edge = box(0.012, bh, 0.008, binding, { cast: false });
    edge.position.set(sx * bw / 2, -bh / 2, 0.006);
    g.add(edge);
  }
  for (let i = 0; i < 4; i++) {
    const py = -0.12 - i * 0.2;
    const pocket = box(0.36, 0.15, 0.05, M.fabric('#ddd5bf', 60 + i), { cast: false });
    pocket.position.set(0, py, 0.03);
    g.add(pocket);
    const trim = box(0.36, 0.015, 0.012, binding, { cast: false });
    trim.position.set(0, py + 0.07, 0.06);
    g.add(trim);
  }
  for (const hx of [-0.14, 0.14]) {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 12, Math.PI), binding);
    hook.position.set(hx, 0.02, 0);
    g.add(hook);
  }
  return g;
}

function createPoster(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.38),
    new THREE.MeshStandardMaterial({ map: posterTex(), roughness: 0.85 })));
  const tape = M.plastic(0xd9c36a, 0.6);
  for (const [tx, ty] of [[-0.24, 0.17], [0.24, 0.17], [-0.24, -0.17], [0.24, -0.17]] as const) {
    const t = box(0.06, 0.022, 0.002, tape, { cast: false });
    t.position.set(tx, ty, 0.003);
    t.rotation.z = tx * ty > 0 ? 0.4 : -0.4;
    g.add(t);
  }
  return g;
}

function createLabCoat(): THREE.Group {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.92, side: THREE.DoubleSide });
  const body = wavyPlane(0.42, 0.82, coat, { segW: 14, segH: 18, amp: 0.02, freq: 8, sag: 0.04 });
  body.position.y = -0.4;
  g.add(body);
  const se = wavyPlane(0.13, 0.5, coat, { amp: 0.02, freq: 9 });
  se.position.set(-0.24, -0.22, 0); se.rotation.z = 0.32; g.add(se);
  const se2 = se.clone(); se2.position.x = 0.24; se2.rotation.z = -0.32; g.add(se2);
  const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.005, 6, 16, Math.PI), M.metalDark());
  hanger.position.y = 0.03;
  g.add(hanger);
  return g;
}

export function createDeskStation(style: StationStyle, index: number): THREE.Group {
  const g = new THREE.Group();
  g.add(createDeskBody());
  const rng = makeRng(index * 713 + 29);
  const surf = DESK.topY + DESK.topThick / 2;

  if (style.laptopOpen) {
    const laptop = createLaptop();
    laptop.position.set(TOP_CX - 0.02, surf, 0.05);
    laptop.rotation.y = -Math.PI / 2 + (rng() - 0.5) * 0.12;
    g.add(laptop);
  }
  if (style.hasMonitor) {
    const monitor = createMonitor();
    monitor.position.set(TOP_CX, surf, -0.42);
    monitor.rotation.y = -Math.PI / 2;
    g.add(monitor);
  }
  if (style.clutter > 0.55) {
    const lamp = createDeskLamp();
    lamp.position.set(-0.36, surf, 0.42);
    g.add(lamp);
  }
  const props: Array<() => THREE.Object3D> = [
    () => createWaterBottle(rng() > 0.5 ? 'water' : 'tea'),
    () => createTissueBox(),
    () => createMug(),
    () => createKettle(),
  ];
  const spots: Array<[number, number]> = [[-0.36, 0.55], [0.14, 0.6], [-0.34, -0.6], [0.1, -0.12]];
  spots.forEach(([x, z], i) => {
    if (rng() < style.clutter + 0.15 || i === 0) {
      const item = props[i]();
      item.position.set(x, surf, z);
      item.rotation.y = rng() * Math.PI;
      g.add(item);
    }
  });
  const stack = createBookStack(index + 5);
  stack.position.set(-0.24, surf, 0.62);
  stack.rotation.y = 0.1;
  g.add(stack);
  const strip = createPowerStrip();
  strip.position.set(TOP_CX - 0.04, surf, -0.05);
  strip.rotation.y = rng() * Math.PI;
  g.add(strip);
  if (style.clutter > 0.7) {
    const hp = createHeadphones();
    hp.position.set(-0.24, surf + 0.03, 0.2);
    hp.rotation.x = -0.3;
    g.add(hp);
  }

  if (style.chair === 'wood') {
    const chair = createWoodChair();
    chair.position.set(0.42, 0, 0.02);
    g.add(chair);
  }

  // 墙面书架（位于桌面上方，书脊朝过道）
  const shelf = box(0.22, 0.03, 0.72, M.deskWood());
  shelf.position.set(-0.35, 1.18, -0.3);
  g.add(shelf);
  const shelfBooks = createBookRow(8, index + 9, 0.62);
  shelfBooks.position.set(-0.26, 1.2, -0.3);
  shelfBooks.rotation.y = Math.PI / 2;
  g.add(shelfBooks);

  if (style.poster) {
    const poster = createPoster();
    poster.position.set(-BED.width / 2 + 0.012, 1.42, 0.15);
    poster.rotation.y = Math.PI / 2;
    g.add(poster);
  }
  for (const [pz, py] of [[0.68, 1.0], [-0.7, 1.05]] as const) {
    const plate = box(0.012, 0.1, 0.08, M.plastic(0xefefea, 0.7), { cast: false });
    plate.position.set(-BED.width / 2 + 0.008, py, pz);
    g.add(plate);
  }

  // 床架收纳袋 + 白大褂
  const org = createOrganizer();
  org.position.set(BED.width / 2 - 0.02, BED.deckY - 0.02, 0.55);
  org.rotation.y = Math.PI / 2;
  g.add(org);
  if (index % 2 === 1) {
    const coat = createLabCoat();
    coat.position.set(BED.width / 2 - 0.05, 1.32, -BED.length / 2 + 0.15);
    coat.rotation.y = Math.PI / 2;
    g.add(coat);
  }
  return g;
}
