// 复核调整后的阳台/卫生间相机预设
import puppeteer from 'puppeteer-core';
const CHROME = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://localhost:4173/';
const OUT = '/workspace/dorm-3d/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-proxy-server', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});
for (const [hash, file] of [['balcony', 'v2_05_balcony'], ['bathroom', 'v2_06_bathroom']]) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  for (let i = 0; i < 50; i++) {
    const s = await page.evaluate(() => { const l = document.getElementById('loader'); return !l || l.style.display === 'none' || l.classList.contains('done'); });
    if (s) break;
    await sleep(500);
  }
  await sleep(10000);
  await page.screenshot({ path: `${OUT}/${file}.png` });
  console.log('shot', file);
  await page.close();
}
console.log('errors:', errors.length, errors.join(' | '));
await browser.close();
