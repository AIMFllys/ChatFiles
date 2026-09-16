import * as THREE from 'three';
import './styles.css';
import { RendererContext, type CameraPreset } from './core/RendererContext';
import { Lighting } from './core/Lighting';
import { buildRoom } from './build/room';
import { buildDorm } from './build/dorm';
import { buildBalcony } from './build/balcony';
import { buildBathroom } from './build/bathroom';
import { Overlay } from './ui/overlay';
import { LabelManager, type Hotspot } from './ui/labels';

/**
 * 启动链路（DOMContentLoaded → 分步构建 → 首帧渲染成功 → 关闭 loading）：
 * 任一步骤异常都会把错误落到页面，杜绝"无限转圈无反馈"。
 */
function main(): void {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('找不到 #stage 画布容器');
  const overlay = new Overlay();

  try {
    overlay.setMessage('初始化 WebGL 渲染器…');
    const ctx = new RendererContext(canvas);
    const lighting = new Lighting(ctx.scene);

    overlay.setMessage('搭建宿舍建筑壳体（墙体/门窗/空调）…');
    const roomAnchors = buildRoom(ctx.scene);

    overlay.setMessage('摆放六组上床下桌与生活用品…');
    const dormAnchors = buildDorm(ctx.scene);

    overlay.setMessage('构建阳台洗衣区…');
    const balconyAnchors = buildBalcony(ctx.scene);

    overlay.setMessage('重建卫生间与明装管线…');
    const bathAnchors = buildBathroom(ctx.scene);

    // 相机预设
    const presets: Record<string, CameraPreset> = {
      overview: { pos: new THREE.Vector3(0.12, 1.62, 3.45), target: new THREE.Vector3(0, 1.25, -1.4) },
      desk: { pos: new THREE.Vector3(-0.15, 1.32, 3.05), target: new THREE.Vector3(-1.02, 0.95, 2.45) },
      beds: { pos: new THREE.Vector3(0.25, 1.55, 1.4), target: new THREE.Vector3(-0.1, 1.75, -1.6) },
      student: { pos: new THREE.Vector3(1.18, 1.3, 0.75), target: new THREE.Vector3(0.92, 0.85, 0.1) },
      balcony: { pos: new THREE.Vector3(0.66, 1.62, -4.05), target: new THREE.Vector3(-0.18, 1.05, -6.0) },
      bathroom: { pos: new THREE.Vector3(1.22, 1.72, -4.18), target: new THREE.Vector3(1.52, 0.5, -5.3) },
      door: { pos: new THREE.Vector3(-0.85, 1.5, 3.15), target: new THREE.Vector3(0.05, 1.25, 3.95) },
    };
    const applyView = (id: string, instant: boolean): void => {
      const p = presets[id];
      if (!p) return;
      if (instant) ctx.jumpTo(p);
      else ctx.flyTo(p);
      document.querySelectorAll('.chip[data-id]').forEach((c) => {
        c.classList.toggle('active', (c as HTMLElement).dataset.id === id);
      });
    };
    overlay.onView = (id) => {
      history.replaceState(null, '', `#${id}`);
      applyView(id, false);
    };
    // 深链接直达：index.html#bathroom
    const initialView = location.hash.replace('#', '');
    if (initialView in presets) applyView(initialView, true);
    window.addEventListener('hashchange', () => {
      const id = location.hash.replace('#', '');
      if (id in presets) applyView(id, true);
    });

    overlay.onToggle = (id, on) => {
      if (id === 'rotate') ctx.setAutoRotate(on);
      if (id === 'night') {
        lighting.setDayMode(!on);
        ctx.scene.background = new THREE.Color(on ? 0x080a0f : 0x0e1014);
      }
      if (id === 'labels') labels.setVisible(on);
    };

    // 热点标注（编号与照片区域对应）
    const hotspots: Hotspot[] = [
      { position: dormAnchors.frontDesk, text: '上床下桌·学习工位（照片5）' },
      { position: dormAnchors.student, text: '正在自习的同学' },
      { position: dormAnchors.wardrobe, text: '铁皮衣柜' },
      { position: roomAnchors.ac, text: '壁挂空调' },
      { position: roomAnchors.entry, text: '入户门 + 门顶吊柜' },
      { position: dormAnchors.beds, text: '六组高架床与蚊帐' },
      { position: balconyAnchors.washer, text: '波轮洗衣机（照片2）' },
      { position: balconyAnchors.sink, text: '壁挂水槽' },
      { position: balconyAnchors.basins, text: '脸盆与水桶' },
      { position: balconyAnchors.laundry, text: '顶杆晾晒衣物' },
      { position: bathAnchors.toilet, text: '陶瓷蹲便器（照片1）' },
      { position: bathAnchors.shower, text: '明装热水管与花洒' },
      { position: bathAnchors.rack, text: '铝线置物架与毛巾' },
      { position: bathAnchors.mat, text: '黑色防滑垫与陈年污渍' },
    ];
    const labels = new LabelManager(document.getElementById('labels') as HTMLDivElement);
    labels.setHotspots(hotspots);
    ctx.addUpdater((_dt, _elapsed) => labels.update(ctx.camera));

    overlay.setMessage('首帧渲染中…');
    ctx.onFirstFrame(() => {
      overlay.setMessage('完成');
      overlay.hideLoader();
    });
    ctx.start();
  } catch (err) {
    const reason = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(err);
    overlay.failLoader(reason);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// 兜底：运行期未捕获错误也显示到加载页
window.addEventListener('error', (e) => {
  const loader = document.getElementById('loader');
  if (loader && loader.style.display !== 'none' && !loader.classList.contains('done')) {
    const msg = document.getElementById('loaderMsg');
    if (msg) msg.textContent = `运行错误：${e.message}`;
    loader.classList.add('error');
  }
});
