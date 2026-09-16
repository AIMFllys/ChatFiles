import * as THREE from 'three';
import { materials as M } from '../core/materials';
import { box } from '../util/primitives';
import { stainTex } from '../core/decals';

/**
 * 陶瓷蹲便器（照片1）：长条坑体 + 两侧防滑条纹踏台 + 椭圆下水孔。
 * 脏污用程序化半透明贴花叠加，表现陈年水渍而不破坏瓷面底色。
 */
export function createSquatToilet(): THREE.Group {
  const g = new THREE.Group();
  const ceramic = M.porcelain();

  // 主坑台（略微梯形：用底座 + 上缘两圈）
  const base = box(0.58, 0.1, 0.82, ceramic);
  base.position.y = 0.05;
  g.add(base);
  const rim = box(0.5, 0.06, 0.74, ceramic);
  rim.position.y = 0.11;
  g.add(rim);

  // 中间凹槽（深色椭圆 + 瓷白内沿）
  const bowlOuter = new THREE.Mesh(new THREE.CircleGeometry(0.16, 28), ceramic);
  bowlOuter.scale.set(1, 2.1, 1);
  bowlOuter.rotation.x = -Math.PI / 2;
  bowlOuter.position.set(0, 0.145, 0.02);
  g.add(bowlOuter);
  const bowlInner = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 28),
    new THREE.MeshStandardMaterial({ color: 0x6d6a5e, roughness: 0.4, metalness: 0.1 }),
  );
  bowlInner.scale.set(1, 2.0, 1);
  bowlInner.rotation.x = -Math.PI / 2;
  bowlInner.position.set(0, 0.147, 0.02);
  g.add(bowlInner);
  // 黑色下水孔（靠前端）
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24),
    new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.2 }));
  hole.scale.set(1, 1.3, 1);
  hole.rotation.x = -Math.PI / 2;
  hole.position.set(0, 0.149, 0.27);
  g.add(hole);
  // 后端挡水翘边
  const splash = box(0.3, 0.12, 0.08, ceramic);
  splash.position.set(0, 0.16, -0.36);
  g.add(splash);

  // 两侧踏台防滑凸纹
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xd8d6ce, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    const pad = box(0.13, 0.02, 0.56, ceramic);
    pad.position.set(sx * 0.2, 0.15, 0.04);
    g.add(pad);
    for (let i = 0; i < 8; i++) {
      const r = box(0.11, 0.008, 0.02, ridgeMat, { cast: false });
      r.position.set(sx * 0.2, 0.165, -0.2 + i * 0.07);
      g.add(r);
    }
  }

  // 瓷面黄渍（沿凹槽边缘）
  const stainMat = new THREE.MeshBasicMaterial({
    map: stainTex(33, '120,96,50'), transparent: true, opacity: 0.8, depthWrite: false,
  });
  const stain = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.66), stainMat);
  stain.rotation.x = -Math.PI / 2;
  stain.position.set(0, 0.151, 0.02);
  g.add(stain);

  return g;
}

/** 地面/墙角污渍贴花（透明） */
export function createStainDecal(w: number, d: number, seed: number, opacity = 0.85): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: stainTex(seed, '96,80,48'), transparent: true, opacity, depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.receiveShadow = false;
  return m;
}
