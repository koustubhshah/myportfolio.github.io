import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 4173;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      try {
        const data = readFileSync(path);
        const ext = extname(path);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end('Not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch();
  const results = [];

  try {
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

      const checks = await page.evaluate((viewportWidth) => {
        const hero = document.querySelector('#hero h1');
        const heroStyle = hero ? getComputedStyle(hero) : null;

        const rgb = heroStyle ? heroStyle.color.match(/\d+/g).map(Number) : [0, 0, 0];
        const heroContrast = rgb[0] + rgb[1] + rgb[2];

        const contactItems = [...document.querySelectorAll('.contact-item')];
        const contactBadPadding = contactItems.some((item) => {
          const h4 = item.querySelector('h4');
          const p = item.querySelector('p');
          if (!h4 || !p) return true;
          const h4Pad = parseInt(getComputedStyle(h4).paddingLeft, 10) || 0;
          const pPad = parseInt(getComputedStyle(p).paddingLeft, 10) || 0;
          return h4Pad > 20 || pPad > 20;
        });

        const contactFloat = contactItems.some((item) => {
          const icon = item.querySelector('i');
          return icon && getComputedStyle(icon).float === 'left';
        });

        const sections = [...document.querySelectorAll('main section')];
        const sectionPaddingOk = sections.every((s) => {
          const py = parseInt(getComputedStyle(s).paddingTop, 10);
          return py >= 48 && py <= 96;
        });

        const mainBox = document.querySelector('#main')?.getBoundingClientRect();
        const layoutOk = viewportWidth >= 1200
          ? mainBox && mainBox.left >= 280
          : mainBox && mainBox.left < 20;

        return {
          heroText: hero?.textContent?.trim(),
          heroContrast,
          contactBadPadding,
          contactFloat,
          sectionPaddingOk,
          layoutOk,
          sectionCount: sections.length,
          hasMetricsStrip: !!document.querySelector('.metrics-strip'),
        };
      }, viewport.width);

      assert(checks.heroText === 'Koustubh Shah', `${viewport.name}: hero name missing`);
      assert(checks.heroContrast > 200, `${viewport.name}: hero text too dark/invisible`);
      assert(!checks.contactBadPadding, `${viewport.name}: contact has excessive left padding`);
      assert(!checks.contactFloat, `${viewport.name}: contact icons still floated`);
      assert(checks.sectionPaddingOk, `${viewport.name}: section padding out of range`);
      assert(checks.layoutOk, `${viewport.name}: main content layout offset wrong`);
      assert(checks.sectionCount >= 6, `${viewport.name}: expected main sections`);
      assert(!checks.hasMetricsStrip, `${viewport.name}: duplicate metrics strip should be removed`);

      results.push(`${viewport.name}: passed`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('Layout tests passed:');
  results.forEach((r) => console.log('  ✓', r));
}

run().catch((err) => {
  console.error('Layout tests failed:', err.message);
  process.exit(1);
});
