/**
 * 全局尺寸与风格配置（单位：米）
 *
 * 空间推导依据（5 张实拍照片）：
 * - 照片3/4：长条形寝室，两侧"上床下桌"各 3 个站位；木地板、白墙、双管日光灯。
 * - 照片1：尽端独立卫生间，约 1.4×2.4m，白色方格砖、明装镀锌水管、蹲便器、黑色防滑垫。
 * - 照片2：尽端阳台洗衣区约 1.6×2.4m，左侧整面铝窗，波轮洗衣机+壁挂水槽+脸盆。
 *
 * 坐标系：Y 向上；Z+ 为入户门端，Z- 为阳台/卫生间端；X- 为照片3左侧床铺，X+ 为右侧。
 */

export const ROOM = {
  /** 主寝室内宽（X） */
  width: 3.0,
  /** 主寝室内长（Z） */
  length: 8.0,
  /** 净高 */
  height: 2.8,
  /** 墙体厚度 */
  wall: 0.12,
  /** 地板厚度 */
  slab: 0.05,
  halfW: 1.5,
  zDoor: 4.0,
  zBalcony: -4.0,
} as const;

export const BALCONY = {
  /** 相对 ROOM.halfW 的边界：x -0.8 ~ 0.8 */
  halfW: 0.8,
  zNear: -4.0,
  zFar: -6.4,
  length: 2.4,
  /** 比寝室地面低 20mm 的门槛高差（照片2可见黑色门槛石） */
  stepDrop: 0.02,
} as const;

export const BATH = {
  xNear: 0.8,
  xFar: 2.2,
  width: 1.4,
  zNear: -4.0,
  zFar: -6.4,
  length: 2.4,
} as const;

/** 两侧"上床下桌"站位中心 Z（照片3/4可见每组间距约 2.2m） */
export const STATION_Z = [2.6, 0.4, -1.8] as const;

export const BED = {
  width: 0.92,
  length: 2.05,
  /** 床板（木条板）上表面高度 */
  deckY: 1.62,
  deckThick: 0.06,
  railY: 1.74,
  railTop: 2.42,
  postSize: 0.05,
} as const;

export const DESK = {
  depth: 0.72,
  length: 1.55,
  topY: 0.76,
  topThick: 0.04,
} as const;

/** 渲染质量开关（低端设备可降级） */
export const QUALITY = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  enableShadows: true,
  /** 单块画布纹理基准分辨率 */
  texSize: 512,
} as const;

/** 色温统一的调色板（贴近照片里的旧宿舍色调） */
export const PALETTE = {
  wall: '#e8e6df',
  wallShade: '#cfccc2',
  ceiling: '#f2f1ec',
  grout: '#c9c7bf',
  metalDark: '#262a2d',
  metalPipe: '#b9b9b2',
  pipeGrime: '#8d8d86',
  woodFrame: '#7a5d3c',
  beddingBlue: '#43566e',
  beddingGray: '#9aa3ac',
  netWhite: 0xf4f3ee,
  cabinetBeige: '#cfc6b2',
  doorBrown: '#4a3528',
  plasticWhite: '#efefea',
  black: '#1c1d1f',
  waterBlue: '#9fc6dd',
  towelBlue: '#5b7fa6',
} as const;

export type StationSide = 'left' | 'right';

/** 每个站位的"住户布置"种子，决定桌面物品与被褥配色，避免六张床千篇一律 */
export interface StationStyle {
  bedding: number;
  curtain: number;
  deskWood: number;
  hasMonitor: boolean;
  laptopOpen: boolean;
  poster: boolean;
  clutter: number;
  /** wood=木椅；none=留给独立的人体+电竞椅 */
  chair: 'wood' | 'none';
  /** 是否配绿色爬梯 */
  ladder?: boolean;
}

export const STATION_STYLES: Record<StationSide, StationStyle[]> = {
  // 照片5 = 左前站位（笔记本+副屏+海报+台灯）
  left: [
    { bedding: 0, curtain: 0, deskWood: 0, hasMonitor: true, laptopOpen: true, poster: true, clutter: 0.95, chair: 'wood' },
    { bedding: 1, curtain: 1, deskWood: 1, hasMonitor: false, laptopOpen: true, poster: false, clutter: 0.6, chair: 'wood', ladder: true },
    { bedding: 2, curtain: 0, deskWood: 0, hasMonitor: false, laptopOpen: false, poster: false, clutter: 0.4, chair: 'wood' },
  ],
  // 照片3 = 右前/右中站位（有人就坐、瓶瓶罐罐、台灯）
  right: [
    { bedding: 1, curtain: 1, deskWood: 1, hasMonitor: false, laptopOpen: false, poster: false, clutter: 0.7, chair: 'wood' },
    { bedding: 0, curtain: 0, deskWood: 0, hasMonitor: true, laptopOpen: false, poster: false, clutter: 0.85, chair: 'none' },
    { bedding: 2, curtain: 1, deskWood: 1, hasMonitor: false, laptopOpen: true, poster: false, clutter: 0.5, chair: 'wood', ladder: true },
  ],
};
