// SwiftShader 软件渲染下的自动视觉验证：截图各预设视角 + 收集控制台错误。
import puppeteer from 'puppeteer-core';

const CHROME = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const URL = 'http://localhost:4173/';
const OUT = '/workspace/dorm-3d/shots';

const views = [
  ['overview', '01_overview'],
  ['desk', '02_desk'],
  ['beds', '03_beds'],
  ['student', '04_student'],
  ['balcony', '05_balcony'],
  ['bathroom', '06_bathroom'],
  ['door', '07_door'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  dumpio: false,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    '--window-size=1440,900',
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
const warns = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') warns.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });

// WebGL 信息
const glInfo = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
    renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
  };
});
console.log('GL:', JSON.stringify(glInfo));

// 等待 loader 消失
let ok = false;
for (let i = 0; i < 60; i++) {
  const hidden = await page.evaluate(() => {
    const l = document.getElementById('loader');
    return !l || l.style.display === 'none' || l.classList.contains('done');
  });
  if (hidden) { ok = true; break; }
  await sleep(500);
}
console.log('loader hidden:', ok);

const failed = await page.evaluate(() => document.getElementById('loader')?.classList.contains('error'));
console.log('loader error state:', failed);
await sleep(1200);

await page.screenshot({ path: `${OUT}/00_loaded.png` });

for (const [id, name] of views) {
  await page.click(`.chip[data-id="${id}"]`);
  await sleep(2600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

// 夜间模式
const toggles = await page.$$('.chip.toggle');
await toggles[1].click();
await sleep(800);
await page.screenshot({ path: `${OUT}/08_night.png` });
await toggles[1].click();
await sleep(400);

// 热点数量
const hotspotCount = await page.evaluate(() => document.querySelectorAll('.hotspot').length);
console.log('hotspots:', hotspotCount);

console.log('--- ERRORS (' + errors.length + ') ---');
errors.forEach((e) => console.log(e));
console.log('--- WARNINGS (' + warns.length + ') ---');
warns.slice(0, 10).forEach((w) => console.log(w));

await browser.close();
