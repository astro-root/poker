import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.POKER_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDir = process.env.POKER_SCREENSHOT_DIR ?? 'docs/design/before';
const allViewports = [
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '844x390', width: 844, height: 390 },
];
const viewports = (process.env.POKER_VIEWPORTS ?? allViewports.map(({ name }) => name).join(',')).split(',').flatMap((name) => allViewports.filter((viewport) => viewport.name === name));
const allRoutes = ['/', '/ai', '/online', '/terms', '/hands'];
const routes = (process.env.POKER_ROUTES ?? allRoutes.join(',')).split(',').filter((route) => allRoutes.includes(route));
await mkdir(outputDir, { recursive: true });
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
      layout: ['.game-panel', '.felt', '.action-panel'].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return `${selector}:missing`;
        const rect = element.getBoundingClientRect();
        return `${selector}:${getComputedStyle(element).position}@${Math.round(rect.top)}-${Math.round(rect.bottom)}`;
      }),
      sizing: ['.page-shell', '.landing-path-grid', '.landing-path-grid .path-card'].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return `${selector}:missing`;
        const rect = element.getBoundingClientRect();
        return `${selector}:${Math.round(rect.left)}-${Math.round(rect.right)} (${Math.round(rect.width)}px)`;
      }),
      horizontalOverflow: [...document.querySelectorAll('body *')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { selector: `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`, left: Math.round(rect.left), right: Math.round(rect.right) };
      }).filter(({ left, right }) => left < -1 || right > innerWidth + 1).slice(0, 8),
      clipped: [...document.querySelectorAll('body *')].filter((element) => {
        const style = getComputedStyle(element);
        return (style.overflow === 'hidden' || style.overflowY === 'hidden')
          && element.scrollHeight > element.clientHeight + 2;
      }).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`),
      smallText: [...document.querySelectorAll('body *')].filter((element) => element.children.length === 0)
        .map((element) => ({ selector: `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`, size: parseFloat(getComputedStyle(element).fontSize) }))
        .filter(({ size }) => size > 0 && size < 12).slice(0, 30),
    }));
    if (metrics.scrollWidth > metrics.width || metrics.clipped.length || metrics.smallText.length) {
      findings.push({ route, viewport: viewport.name, ...metrics });
    }
    await page.screenshot({ path: `${outputDir}/${route === '/' ? 'home' : route.slice(1)}-${viewport.name}.png`, fullPage: true });
    console.log(`captured ${route} ${viewport.name}`);
    await page.close();
  }
}
await browser.close();
const summary = findings.map(({ route, viewport, width, scrollWidth, clipped, smallText, horizontalOverflow, layout, sizing }) =>
  `- ${route} @ ${viewport}: 横幅 ${scrollWidth}/${width}px、切れ候補 ${clipped.length}${clipped.length ? ` (${clipped.join(', ')})` : ''}、横はみ出し要素 ${horizontalOverflow.length}${horizontalOverflow.length ? ` (${horizontalOverflow.map(({ selector, left, right }) => `${selector}[${left},${right}]`).join(', ')})` : ''}、12px未満の文字 ${smallText.length}${smallText.length ? ` (${smallText.slice(0, 8).map(({ selector, size }) => `${selector}:${size}px`).join(', ')})` : ''}${viewport === '360x640' ? `、位置 ${layout.join(' / ')}、幅 ${sizing.join(' / ')}` : ''}`);
console.log(`Captured ${routes.length * viewports.length} screenshots; ${findings.length} route/viewport pairs have measurable issues.`);
console.log(summary.join('\n'));
