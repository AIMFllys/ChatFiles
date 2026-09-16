// 快速视觉验证：关键视角用 #hash 深链接全新加载（软件渲染较慢，每个页面独立等待）。
import puppeteer from 'puppeteer-core';

const CHROME = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:4173/';
const OUT = '/workspace/dorm-3d/shots';

const views = [
  ['overview', '01_overview'],
  ['balcony', '05_balcony'],
  ['bathroom', '06_bathroom'],
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

async function shoot(hash, file, wait = 12000) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => allErrors.push(`${hash} PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) allErrors.push(`${hash}: ${m.text()}`);
  });
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  for (let i = 0; i < 50; i++) {
    const state = await page.evaluate(() => {
      const l = document.getElementById('loader');
      return { hidden: !l || l.style.display === 'none' || l.classList.contains('done'), error: l?.classList.contains('error') };
    });
    if (state.error) { allErrors.push(`${hash}: loader error`); break; }
    if (state.hidden) break;
    await sleep(500);
  }
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${file}.png` });
  console.log('shot', file);
  await page.close();
}

for (const [id, name] of views) await shoot(id, name);

console.log('--- ERRORS (' + allErrors.length + ') ---');
allErrors.forEach((e) => console.log(e));
await browser.close();
