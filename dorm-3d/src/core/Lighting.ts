import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { materials } from './materials';
import { box } from '../util/primitives';

/**
 * 照片3/4：天花板有两组长条荧光灯管，光线冷白偏亮；
 * 尽端阳台门窗射入自然光。这里用 RectAreaLight 模拟灯盘面光、
 * 用带阴影的 DirectionalLight 模拟窗光，并保留微弱环境底光。
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  private nightLights: THREE.Light[] = [];
  private dayLights: THREE.Light[] = [];
  private tubeMeshes: THREE.MeshStandardMaterial[] = [];
  private isDay = true;

  constructor(private scene: THREE.Scene) {
    RectAreaLightUniformsLib.init();

    const hemi = new THREE.HemisphereLight(0xf4f6ff, 0x8c7a5e, 0.35);
    scene.add(hemi);
    this.dayLights.push(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(ambient);

    // 窗外阳光：从阳台方向（z-）斜射，主阴影来源
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.0);
    this.sun.position.set(-2.6, 5.2, -7.2);
    this.sun.target.position.set(0.2, 0.4, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 0.5; sc.far = 20;
    sc.left = -5; sc.right = 5; sc.top = 6; sc.bottom = -3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    scene.add(this.sun, this.sun.target);
    this.dayLights.push(this.sun);

    // 两组长条灯管（位置沿寝室纵深）
    for (const z of [1.6, -1.7]) this.buildTubeFixture(0, z);

    // 卫生间小白炽灯
    this.buildBulb(new THREE.Vector3(1.5, 2.45, -5.2), 0.9, 0.6);
  }

  private buildTubeFixture(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 2.76, z);
    // 金属灯盘
    const tray = box(0.22, 0.05, 1.5, materials.metalDark());
    tray.castShadow = false;
    g.add(tray);
    // 两根乳白灯管
    const tubeMat = materials.emissive(0xeef6ff, 2.2) as THREE.MeshStandardMaterial;
    this.tubeMeshes.push(tubeMat);
    for (const dx of [-0.05, 0.05]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.32, 12), tubeMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(dx, -0.04, 0);
      tube.castShadow = false;
      g.add(tube);
    }
    this.scene.add(g);

    const rect = new THREE.RectAreaLight(0xe8f1ff, 4.2, 0.3, 1.5);
    rect.position.set(x, 2.68, z);
    rect.lookAt(x, 0.6, z);
    this.scene.add(rect);
    this.nightLights.push(rect);

    // 一盏低强度点光补暗角（不投影，成本低）
    const fill = new THREE.PointLight(0xeef2ff, 0.35, 7, 2);
    fill.position.set(x, 2.45, z);
    this.scene.add(fill);
    this.nightLights.push(fill);
  }

  private buildBulb(pos: THREE.Vector3, intensity: number, reach: number): void {
    const m = materials.emissive(0xfff1d0, 1.6) as THREE.MeshStandardMaterial;
    this.tubeMeshes.push(m);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), m);
    bulb.position.copy(pos);
    bulb.castShadow = false;
    this.scene.add(bulb);
    const p = new THREE.PointLight(0xfff1d0, intensity, reach * 4, 2);
    p.position.copy(pos);
    this.scene.add(p);
    this.nightLights.push(p);
  }

  /** 屏幕冷光（桌面局部照明，不投影） */
  addScreenGlow(pos: THREE.Vector3, intensity = 0.5): void {
    const p = new THREE.PointLight(0x9fc4ff, intensity, 1.6, 2);
    p.position.copy(pos);
    this.scene.add(p);
  }

  /** 日光模式只切换窗外阳光；照片中日光灯昼夜常亮，故灯盘保持开启。 */
  setDayMode(day: boolean): void {
    this.isDay = day;
    this.sun.visible = day;
    this.sun.intensity = day ? 2.0 : 0.05;
  }

  get dayMode(): boolean { return this.isDay; }
}
