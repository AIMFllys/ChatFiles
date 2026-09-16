import * as THREE from 'three';
import { PALETTE } from '../config';
import {
  deskWoodTex, fabricTex, floorWoodTex, galvanizedTex, plankWoodTex,
  wallPaintTex, whiteTileTex,
} from './textures';
import { floorMatTex, towelTex } from './decals';

/**
 * 材质注册表：纹理只生成一次并按需复用，控制显存与绘制批次。
 * 使用 MeshStandardMaterial(PBR) 以获得真实的光照/阴影/环境反射。
 */
class MaterialLib {
  private cache = new Map<string, THREE.Material>();
  private texCache = new Map<string, THREE.Texture>();

  private tex(key: string, factory: () => THREE.Texture): THREE.Texture {
    let t = this.texCache.get(key);
    if (!t) { t = factory(); this.texCache.set(key, t); }
    return t;
  }

  private mat(key: string, factory: () => THREE.Material): THREE.Material {
    let m = this.cache.get(key);
    if (!m) { m = factory(); this.cache.set(key, m); }
    return m;
  }

  /** 按 repeat 克隆墙面/瓷砖类材质（克隆共享纹理，开销低） */
  private repeated(key: string, base: THREE.Texture, rx: number, ry: number, factory: (t: THREE.Texture) => THREE.Material): THREE.Material {
    const k = `${key}@${rx}x${ry}`;
    let m = this.cache.get(k);
    if (!m) {
      const t = base.clone();
      t.needsUpdate = true;
      t.repeat.set(rx, ry);
      m = factory(t);
      this.cache.set(k, m);
    }
    return m;
  }

  wall(): THREE.Material {
    return this.mat('wall', () => new THREE.MeshStandardMaterial({
      map: this.tex('wall', wallPaintTex), roughness: 0.95, metalness: 0,
    }));
  }

  wallRepeated(rx: number, ry: number): THREE.Material {
    return this.repeated('wallR', this.tex('wall', wallPaintTex), rx, ry,
      (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  }

  ceiling(): THREE.Material {
    return this.mat('ceiling', () => new THREE.MeshStandardMaterial({ color: PALETTE.ceiling, roughness: 1 }));
  }

  floorWood(rx = 2, ry = 6): THREE.Material {
    return this.repeated('floorWood', this.tex('floorWood', floorWoodTex), rx, ry,
      (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.62, metalness: 0.02 }));
  }

  deskWood(): THREE.Material {
    return this.mat('deskWood', () => new THREE.MeshStandardMaterial({
      map: this.tex('deskWood', deskWoodTex), roughness: 0.55,
    }));
  }

  plankWood(): THREE.Material {
    return this.mat('plank', () => new THREE.MeshStandardMaterial({
      map: this.tex('plank', plankWoodTex), roughness: 0.7,
    }));
  }

  tile(dirt = 0, rx = 4, ry = 4): THREE.Material {
    const k = `tile${dirt}`;
    const base = this.tex(k, () => whiteTileTex(512, 4, dirt));
    return this.repeated(k, base, rx, ry,
      (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.02 }));
  }

  tilePlain(): THREE.Material {
    return this.mat('tilePlain', () => new THREE.MeshStandardMaterial({ color: 0xe9e8e2, roughness: 0.4 }));
  }

  metalDark(): THREE.Material {
    return this.mat('metalDark', () => new THREE.MeshStandardMaterial({ color: PALETTE.metalDark, roughness: 0.45, metalness: 0.7 }));
  }

  metalGreen(): THREE.Material {
    return this.mat('metalGreen', () => new THREE.MeshStandardMaterial({ color: 0x33453c, roughness: 0.5, metalness: 0.6 }));
  }

  pipe(): THREE.Material {
    return this.mat('pipe', () => new THREE.MeshStandardMaterial({
      map: this.tex('pipe', galvanizedTex), color: 0xd2d2ca, roughness: 0.32, metalness: 0.85,
    }));
  }

  chrome(): THREE.Material {
    return this.mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.12, metalness: 1 }));
  }

  plastic(color: number | string = PALETTE.plasticWhite, rough = 0.55): THREE.Material {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });
  }

  fabric(color: string, seed = 1, rough = 0.9): THREE.Material {
    const k = `fab${color}${seed}`;
    return this.mat(k, () => new THREE.MeshStandardMaterial({
      map: this.tex(k, () => fabricTex(color, seed)), roughness: rough, metalness: 0,
    }));
  }

  /** 蚊帐纱：半透明双面，带轻微透射感 */
  mosquitoNet(): THREE.Material {
    return this.mat('net', () => new THREE.MeshStandardMaterial({
      color: PALETTE.netWhite, transparent: true, opacity: 0.2, roughness: 1,
      side: THREE.DoubleSide, depthWrite: false,
    }));
  }

  glass(): THREE.Material {
    return this.mat('glass', () => new THREE.MeshPhysicalMaterial({
      color: 0xdfeef5, transparent: true, opacity: 0.22, roughness: 0.05,
      metalness: 0, transmission: 0.3, side: THREE.DoubleSide, depthWrite: false,
    }));
  }

  porcelain(): THREE.Material {
    return this.mat('porcelain', () => new THREE.MeshStandardMaterial({ color: 0xf3f2ec, roughness: 0.25, metalness: 0.02 }));
  }

  darkAppliance(): THREE.Material {
    return this.mat('darkAppliance', () => new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.35, metalness: 0.45 }));
  }

  floorMat(): THREE.Material {
    return this.mat('floorMat', () => new THREE.MeshStandardMaterial({
      map: this.tex('floorMat', floorMatTex), roughness: 0.8,
    }));
  }

  towel(kind: 'stripe' | 'leaf'): THREE.Material {
    return this.mat(`towel${kind}`, () => new THREE.MeshStandardMaterial({
      map: this.tex(`towel${kind}`, () => towelTex(kind)), roughness: 0.95, side: THREE.DoubleSide,
    }));
  }

  emissive(color: number, intensity = 1.4): THREE.Material {
    return new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  }
}

export const materials = new MaterialLib();
