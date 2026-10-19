import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.POKER_BASE_URL ?? 'http://127.0.0.1:4173';
const viewports = [
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '844x390', width: 844, height: 390 },
];
const routes = ['/', '/ai', '/online', '/terms', '/hands'];
await mkdir('docs/design/before', { recursive: true });
const browser = await chromium.launch({ headless: true });
const findings = [];
for (const route of routes) {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      clipped: [...document.querySelectorAll('body *')].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (style.overflow === 'hidden' || style.overflowY === 'hidden')
          && (element.scrollHeight > element.clientHeight + 2 || rect.bottom > innerHeight + 2);
      }).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`),
      smallText: [...document.querySelectorAll('body *')].filter((element) => element.children.length === 0)
        .map((element) => ({ selector: `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`, size: parseFloat(getComputedStyle(element).fontSize) }))
        .filter(({ size }) => size > 0 && size < 12).slice(0, 30),
    }));
    if (metrics.scrollWidth > metrics.width || metrics.clipped.length || metrics.smallText.length) {
      findings.push({ route, viewport: viewport.name, ...metrics });
    }
    await page.screenshot({ path: `docs/design/before/${route === '/' ? 'home' : route.slice(1)}-${viewport.name}.png`, fullPage: true });
    console.log(`captured ${route} ${viewport.name}`);
    await page.close();
  }
}
await browser.close();
const summary = findings.map(({ route, viewport, width, scrollWidth, clipped, smallText }) =>
  `- ${route} @ ${viewport}: 横幅 ${scrollWidth}/${width}px、切れ候補 ${clipped.length}、12px未満の文字 ${smallText.length}`);
console.log(`Captured ${routes.length * viewports.length} screenshots; ${findings.length} route/viewport pairs have measurable issues.`);
console.log(summary.join('\n'));
