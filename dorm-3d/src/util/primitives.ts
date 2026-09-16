import * as THREE from 'three';

/** 常用几何工厂：统一阴影开关与"父组 + 局部坐标"的搭建方式。 */

export interface MeshOpts {
  cast?: boolean;
  receive?: boolean;
  name?: string;
}

export function box(
  w: number, h: number, d: number,
  material: THREE.Material,
  opts: MeshOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  if (opts.name) m.name = opts.name;
  return m;
}

export function plane(
  w: number, h: number,
  material: THREE.Material,
  opts: MeshOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.castShadow = opts.cast ?? false;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

export function cyl(
  rTop: number, rBottom: number, h: number,
  material: THREE.Material,
  segments = 20,
  opts: MeshOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1), material);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

export function sphere(
  r: number,
  material: THREE.Material,
  segments = 20,
  opts: MeshOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, segments, Math.max(12, segments / 2)), material);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

/** 在两点之间生成圆管（明装水管、衣架杆、拖把杆等大量使用）。 */
export function tubeBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, segments), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 带 90° 弯头的管线（沿 X/Z 走向的明装管）。radiusJoint 为弯头球半径。 */
export function pipePath(
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  parent: THREE.Object3D,
  jointRadius = radius * 1.25,
): void {
  for (let i = 0; i < points.length - 1; i++) {
    parent.add(tubeBetween(points[i], points[i + 1], radius, material));
  }
  const jointGeo = new THREE.SphereGeometry(jointRadius, 12, 8);
  for (const p of points) {
    const j = new THREE.Mesh(jointGeo, material);
    j.position.copy(p);
    j.castShadow = true;
    parent.add(j);
  }
}

/** 多材质圆角感盒子：给边缘加 4 根细圆柱，模拟塑料/金属包边（低成本提升精致度）。 */
export function framedBox(
  w: number, h: number, d: number,
  bodyMat: THREE.Material,
  frameMat: THREE.Material,
  frameR = 0.012,
): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, d, bodyMat));
  const xs = [-w / 2, w / 2];
  const ys = [-h / 2, h / 2];
  for (const x of xs) {
    for (const y of ys) {
      g.add(tubeBetween(
        new THREE.Vector3(x, y, -d / 2),
        new THREE.Vector3(x, y, d / 2),
        frameR, frameMat, 8,
      ));
    }
  }
  return g;
}

/** 伪随机：基于种子的确定性 PRNG，保证每次构建布局一致。 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 让网格贴合地板（以包围盒底部对齐 y=0 后再抬高 yOffset）。 */
export function groundTo(obj: THREE.Object3D, yOffset = 0): void {
  obj.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(obj);
  obj.position.y += -box3.min.y + yOffset;
}

export function disableShadow(obj: THREE.Object3D): THREE.Object3D {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return obj;
}
