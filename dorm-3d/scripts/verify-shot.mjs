// SwiftShader 软件渲染下的自动视觉验证：
// 每个视角用 #hash 深链接全新加载，相机首帧即就位，规避低帧率导致的补间滞后。
import puppeteer from 'puppeteer-core';

const CHROME = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:4173/';
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
const allErrors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage', '--no-proxy-server',
    '--window-size=1440,900',
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

async function shoot(hash, file, { wait = 9000 } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => allErrors.push(`${hash} PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) allErrors.push(`${hash}: ${m.text()}`);
  });
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'load', timeout: 30000 });
  // 等待 loader 淡出
  for (let i = 0; i < 40; i++) {
    const state = await page.evaluate(() => {
      const l = document.getElementById('loader');
      return { hidden: !l || l.style.display === 'none' || l.classList.contains('done'), error: l?.classList.contains('error') };
    });
    if (state.error) { allErrors.push(`${hash}: loader error` ); break; }
    if (state.hidden) break;
    await sleep(500);
  }
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${file}.png` });
  console.log('shot', file);
  await page.close();
}

for (const [id, name] of views) await shoot(id, name);

// 夜间模式：深链接 + 点击开关
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => allErrors.push(`night PAGEERROR: ${e.message}`));
  await page.goto(`${BASE}#overview`, { waitUntil: 'load' });
  await sleep(9000);
  const toggles = await page.$$('.chip.toggle');
  await toggles[1].click();
  await sleep(4000);
  await page.screenshot({ path: `${OUT}/08_night.png` });
  console.log('shot 08_night');
  const count = await page.evaluate(() => document.querySelectorAll('.hotspot').length);
  console.log('hotspots:', count);
  await page.close();
}

console.log('--- ERRORS (' + allErrors.length + ') ---');
allErrors.forEach((e) => console.log(e));
await browser.close();
