import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../config';

export interface CameraPreset {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * 渲染上下文：负责 WebGL 渲染器、场景、透视相机、OrbitControls、
 * 环境反射（PMREM RoomEnvironment）、窗口自适应与相机补间。
 */
export class RendererContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private raf = 0;
  private tween: {
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
    t: number; dur: number;
  } | null = null;
  private updaters = new Set<(dt: number, elapsed: number) => void>();
  private firstFrameCallbacks: Array<() => void> = [];
  private firstFrameFired = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = QUALITY.enableShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x0e1014);

    // 中性室内环境，为金属/瓷砖/屏幕提供真实反射
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.03, 80);
    this.camera.position.set(0.1, 1.65, 3.4);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.25, -1.2);
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();
    this.controls.addEventListener('start', () => { this.tween = null; });

    window.addEventListener('resize', this.onResize);
  }

  addUpdater(fn: (dt: number, elapsed: number) => void): void { this.updaters.add(fn); }

  onFirstFrame(fn: () => void): void {
    if (this.firstFrameFired) fn();
    else this.firstFrameCallbacks.push(fn);
  }

  /** 平滑飞行到预设视角 */
  flyTo(preset: CameraPreset, dur = 1.4): void {
    this.tween = {
      fromPos: this.camera.position.clone(), toPos: preset.pos.clone(),
      fromTgt: this.controls.target.clone(), toTgt: preset.target.clone(),
      t: 0, dur,
    };
  }

  /** 无动画跳转（深链接直达 / 低帧率环境） */
  jumpTo(preset: CameraPreset): void {
    this.tween = null;
    this.camera.position.copy(preset.pos);
    this.controls.target.copy(preset.target);
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.7;
  }

  private ease(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  start(): void {
    const clock = new THREE.Clock();
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;

      if (this.tween) {
        this.tween.t += dt;
        const k = this.ease(Math.min(this.tween.t / this.tween.dur, 1));
        this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, k);
        this.controls.target.lerpVectors(this.tween.fromTgt, this.tween.toTgt, k);
        if (this.tween.t >= this.tween.dur) this.tween = null;
      }

      this.updaters.forEach((fn) => fn(dt, elapsed));
      this.controls.update();
      this.renderer.render(this.scene, this.camera);

      if (!this.firstFrameFired) {
        this.firstFrameFired = true;
        this.firstFrameCallbacks.forEach((fn) => fn());
      }
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
