// Browser-level visual regression for the actual Oasis scene, not a shader mock.
// Run by .github/workflows/headlamp-visual.yml; artifacts include both PNGs.
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const URL_ROOT = 'http://127.0.0.1:4173/';
const baseQuery = '?start=oasis&view=wide&hour=0&windtime=20&skytime=30';
const folder = 'headlamp-visual';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
  ]
});

async function capture(switchState) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  const url = URL_ROOT + baseQuery + '&headlamp=' + switchState;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#explore')?.disabled === false, null, { timeout: 120000 });
    await page.locator('#explore').click();
    // Let texture loading and the GPU pipeline settle before taking the frame.
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#world');
      const info = canvas?.dataset.render;
      if (!info || !document.querySelector('#welcome')?.hidden) return false;
      try { return JSON.parse(info).calls > 5; } catch { return false; }
    }, null, { timeout: 120000 });
    await page.waitForTimeout(4500);
    const state = await page.evaluate(() => ({
      render: document.querySelector('#world')?.dataset.render,
      position: document.querySelector('#world')?.dataset.position,
      width: document.querySelector('#world')?.width,
      height: document.querySelector('#world')?.height,
      screenshotUrl: location.href
    }));
    const image = await page.locator('#world').screenshot({ animations: 'disabled' });
    await writeFile(`${folder}/${switchState}.png`, image);
    assert.ok(!failures.length, `JavaScript page errors (${switchState}): ${failures.join('; ')}`);
    assert.ok(state.width > 0 && state.height > 0);
    return { ...state, image };
  } finally {
    await context.close();
  }
}

try {
  const off = await capture('off');
  const on = await capture('on');
  const a = PNG.sync.read(off.image), b = PNG.sync.read(on.image);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let changed = 0, totalChange = 0, moreLight = 0;
  let offBrightness = 0, onBrightness = 0, sampleCount = 0;
  // Focus below the horizon, where the torch actually illuminates surfaces.
  for (let y = Math.floor(a.height * 0.32); y < a.height * 0.91; y += 2) {
    for (let x = Math.floor(a.width * 0.1); x < a.width * 0.9; x += 2) {
      const i = (y * a.width + x) * 4;
      const da = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
      const db = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3;
      if (Math.abs(db - da) > 8) changed++;
      if (db > da + 8) moreLight++;
      totalChange += Math.abs(db - da);
      offBrightness += da; onBrightness += db; sampleCount++;
    }
  }
  const report = {
    scene: baseQuery,
    comparedPixels: sampleCount,
    changedPixels: changed,
    brighterPixels: moreLight,
    meanChange: Number((totalChange / sampleCount).toFixed(3)),
    meanBrightnessOff: Number((offBrightness / sampleCount).toFixed(3)),
    meanBrightnessOn: Number((onBrightness / sampleCount).toFixed(3)),
    offRender: off.render,
    onRender: on.render,
  };
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.ok(changed > sampleCount * 0.005, 'Torch toggle had no meaningful visual effect on the rendered scene');
  assert.ok(moreLight > sampleCount * 0.003, 'Headlamp on did not brighten enough real-world pixels');
} finally {
  await browser.close();
}
