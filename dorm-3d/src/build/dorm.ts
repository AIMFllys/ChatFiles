import * as THREE from 'three';
import { BED, STATION_STYLES, STATION_Z } from '../config';
import { createLoftBed } from '../objects/bed';
import { createDeskStation } from '../objects/deskStation';
import { createSeatedStudent } from '../objects/person';
import {
  createCardboardBox, createStepLadder, createSuitcase, createStandFan, createWardrobe,
} from '../objects/misc';
import {
  createHangers, createPlasticBag, createShoes, createSlippers, createStools,
  createToteBag, createTrashBin,
} from '../objects/props';
import { wavyPlane } from '../util/cloth';
import { materials as M } from '../core/materials';

/**
 * 主寝室总装：左右各三组"上床下桌" + 入口衣柜 + 就座的同学 +
 * 地面箱包/鞋/袋/踏步梯 + 尽端摞凳/落地扇，布局对照照片3/4。
 */

const BED_X = 1.5 - BED.width / 2 - 0.02; // 1.02：床体贴墙
/** 右侧站位整体向门端错 0.25m，给入口衣柜让位（真实宿舍也并非严格对称） */
const RIGHT_OFFSET = -0.25;

function stations(parent: THREE.Object3D): void {
  for (const side of ['left', 'right'] as const) {
    const styles = STATION_STYLES[side];
    STATION_Z.forEach((z, i) => {
      const style = styles[i];
      const zz = side === 'right' ? z + RIGHT_OFFSET : z;
      const x = side === 'left' ? -BED_X : BED_X;
      const rotY = side === 'left' ? 0 : Math.PI;

      const bed = createLoftBed({ style, side, withLadder: !!style.ladder, seed: i });
      bed.position.set(x, 0, zz);
      parent.add(bed);

      const desk = createDeskStation(style, i);
      desk.position.set(x, 0, zz);
      desk.rotation.y = rotY;
      parent.add(desk);
    });
  }
}

function floorClutter(parent: THREE.Object3D): void {
  // 入口右侧衣柜（照片3 右前景）
  const wardrobe = createWardrobe();
  wardrobe.position.set(1.17, 0, 3.62);
  parent.add(wardrobe);

  // 黑色踏步梯（照片5）
  const ladder = createStepLadder();
  ladder.position.set(0.18, 0, 2.25);
  ladder.rotation.y = Math.PI / 2;
  parent.add(ladder);

  // 行李箱（照片4 床架间）
  const suitcase = createSuitcase(0x23262b);
  suitcase.position.set(0.72, 0, -0.65);
  suitcase.rotation.y = -0.12;
  parent.add(suitcase);

  // 纸箱
  const box1 = createCardboardBox();
  box1.position.set(-0.25, 0, 0.9);
  box1.rotation.y = 0.3;
  parent.add(box1);
  const box2 = createCardboardBox();
  box2.scale.setScalar(0.75);
  box2.position.set(0.45, 0, -1.5);
  box2.rotation.y = -0.5;
  parent.add(box2);

  // 鞋 / 拖鞋
  const shoes = createShoes(0x1f2226, 9);
  shoes.position.set(0.95, 0, 1.25);
  shoes.rotation.y = -0.6;
  parent.add(shoes);
  const slippers = createSlippers(0xd6d8d4);
  slippers.position.set(0.9, 0, -0.2);
  slippers.rotation.y = 0.3;
  parent.add(slippers);
  const slippers2 = createSlippers(0xaeb8c4);
  slippers2.position.set(-0.8, 0, 1.5);
  slippers2.rotation.y = 1.8;
  parent.add(slippers2);

  // 帆布袋 + 塑料袋（照片4 红袋）
  const tote = createToteBag(0xb23a3a);
  tote.position.set(-0.05, 0, 2.4);
  tote.rotation.y = 0.25;
  parent.add(tote);
  const bag = createPlasticBag(0xf0f0ea);
  bag.position.set(-1.25, 0.75, 1.4);
  bag.rotation.y = 0.4;
  parent.add(bag);

  // 垃圾桶
  const bin = createTrashBin();
  bin.position.set(-0.5, 0, -2.5);
  parent.add(bin);

  // 尽端摞起的塑料凳（照片3 远处）
  const stools = createStools(3);
  stools.position.set(-1.05, 0, -3.3);
  stools.rotation.y = 0.4;
  parent.add(stools);

  // 落地扇
  const fan = createStandFan();
  fan.position.set(1.15, 0, -3.15);
  fan.rotation.y = -0.6;
  parent.add(fan);

  // 床架下沿的衣架（照片3 右床一排白衣架）
  const hangers = createHangers(4);
  hangers.position.set(BED_X - 0.04, 1.5, 2.9);
  hangers.rotation.y = Math.PI;
  parent.add(hangers);

  // 床侧搭着的深色外套
  const jacket = wavyPlane(0.4, 0.7, M.fabric('#2c2f36', 301), { amp: 0.025, freq: 8, sag: 0.05 });
  jacket.rotation.y = -Math.PI / 2;
  jacket.position.set(BED_X - 0.02, 1.0, 1.65);
  parent.add(jacket);
}

export function buildDorm(parent: THREE.Object3D): Record<string, THREE.Vector3> {
  const g = new THREE.Group();
  parent.add(g);
  stations(g);
  floorClutter(g);

  // 同学就座于右中工位（右侧整体偏移后 z≈0.15）
  const student = createSeatedStudent();
  student.position.set(0.82, 0, 0.4 + RIGHT_OFFSET);
  student.rotation.y = Math.PI;
  g.add(student);

  return {
    frontDesk: new THREE.Vector3(-1.0, 1.0, 2.6),
    student: new THREE.Vector3(0.95, 0.9, 0.15),
    wardrobe: new THREE.Vector3(1.2, 1.0, 3.55),
    beds: new THREE.Vector3(0, 1.9, -0.2),
  };
}
