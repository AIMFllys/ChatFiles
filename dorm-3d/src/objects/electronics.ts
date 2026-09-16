import * as THREE from 'three';
import { materials as M } from '../core/materials';
import { box, cyl, sphere, tubeBetween } from '../util/primitives';
import { codeScreenTex, darkScreenTex } from '../core/decals';

/** 桌面电子设备：屏幕贴图自发光 + 台灯暖光，材质统一深色金属/塑料。 */

/** 打开的笔记本电脑（照片5 桌面亮屏写代码，屏幕自带冷色点光） */
export function createLaptop(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = M.plastic(0x2c2f34, 0.4);
  const base = box(0.34, 0.018, 0.23, bodyMat);
  base.position.y = 0.009;
  g.add(base);
  // 键盘区
  const kb = box(0.28, 0.002, 0.1, M.plastic(0x1c1e22, 0.6), { cast: false, receive: false });
  kb.position.set(0, 0.02, 0.03);
  g.add(kb);
  const track = box(0.07, 0.002, 0.04, M.plastic(0x3a3d42, 0.5), { cast: false, receive: false });
  track.position.set(0, 0.02, 0.09);
  g.add(track);
  // 屏幕（向后翻开约 105°）
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.018, -0.115);
  pivot.rotation.x = -0.28;
  const lid = box(0.33, 0.22, 0.012, bodyMat);
  lid.position.y = 0.11;
  pivot.add(lid);
  const screenMat = new THREE.MeshStandardMaterial({
    map: codeScreenTex(), emissive: 0xffffff, emissiveMap: codeScreenTex(),
    emissiveIntensity: 0.85, roughness: 0.3,
  });
  const scr = box(0.3, 0.19, 0.004, screenMat, { cast: false, receive: false });
  scr.position.set(0, 0.11, 0.008);
  pivot.add(scr);
  g.add(pivot);
  // 贴纸
  const sticker = box(0.04, 0.002, 0.03, new THREE.MeshStandardMaterial({ color: 0xd94f4f, roughness: 0.6 }), { cast: false });
  sticker.position.set(-0.1, 0.02, 0.09);
  g.add(sticker);
  // 屏幕冷光（作为笔记本的子节点，随组一起变换）
  const glowLight = new THREE.PointLight(0x9fc4ff, 0.55, 1.4, 2);
  glowLight.position.set(0, 0.2, 0.12);
  g.add(glowLight);
  return g;
}

/** 外接副屏（照片5 笔记本左侧黑色显示器） */
export function createMonitor(): THREE.Group {
  const g = new THREE.Group();
  const bezel = M.plastic(0x16181c, 0.35);
  const panel = box(0.5, 0.3, 0.03, bezel);
  panel.position.y = 0.32;
  g.add(panel);
  const screenMat = new THREE.MeshStandardMaterial({
    map: darkScreenTex(), emissive: 0x223044, emissiveMap: darkScreenTex(),
    emissiveIntensity: 0.5, roughness: 0.25,
  });
  const scr = box(0.46, 0.26, 0.004, screenMat, { cast: false, receive: false });
  scr.position.set(0, 0.32, 0.017);
  g.add(scr);
  const neck = cyl(0.018, 0.024, 0.16, M.metalDark(), 12);
  neck.position.y = 0.09;
  g.add(neck);
  const base = cyl(0.11, 0.11, 0.015, M.metalDark(), 24);
  base.scale.z = 0.7;
  base.position.y = 0.008;
  g.add(base);
  return g;
}

/** 可弯曲杆颈台灯（照片5 桌面亮着的白色灯条） */
export function createDeskLamp(): THREE.Group {
  const g = new THREE.Group();
  const white = M.plastic(0xf1f1ec, 0.4);
  const base = cyl(0.06, 0.07, 0.02, white, 20);
  base.position.y = 0.01;
  g.add(base);
  // 蛇形管两段
  const p0 = new THREE.Vector3(0, 0.02, 0);
  const p1 = new THREE.Vector3(0.02, 0.22, -0.02);
  const p2 = new THREE.Vector3(0.12, 0.36, -0.1);
  g.add(tubeBetween(p0, p1, 0.012, M.chrome(), 10));
  g.add(tubeBetween(p1, p2, 0.01, M.chrome(), 10));
  const joint = sphere(0.018, M.chrome(), 12);
  joint.position.copy(p1);
  g.add(joint);
  // 灯头（长条 LED）
  const head = box(0.2, 0.026, 0.04, white);
  head.position.copy(p2);
  head.rotation.z = -0.5;
  head.rotation.y = 0.3;
  g.add(head);
  const bulb = box(0.17, 0.005, 0.025, M.emissive(0xfff2cf, 3), { cast: false, receive: false });
  bulb.position.copy(p2);
  bulb.position.y -= 0.015;
  bulb.rotation.copy(head.rotation);
  g.add(bulb);
  return g;
}

/** 电热水壶 / 水杯等小电器（照片桌面常见） */
export function createKettle(): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.055, 0.065, 0.2, M.plastic(0xe8e8e2, 0.4), 20);
  body.position.y = 0.1;
  g.add(body);
  const lid = cyl(0.05, 0.05, 0.02, M.plastic(0xd8d8d2, 0.4), 20);
  lid.position.y = 0.21;
  g.add(lid);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16, Math.PI), M.plastic(0x2a2c30, 0.5));
  handle.position.set(0.055, 0.12, 0);
  handle.rotation.z = -Math.PI / 2;
  g.add(handle);
  return g;
}
