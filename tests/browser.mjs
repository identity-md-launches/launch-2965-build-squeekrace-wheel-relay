// Browser walk of the production export, using a scripted stand-in for the API so every state
// can be reached on demand. It tests the page, not the live wheel.
//
//   npm run build
//   node tests/browser.mjs            (needs `playwright`, or IMD_PLAYWRIGHT=/path/to/index.mjs)
//   node tests/browser.mjs --out dir  (also writes results.json and screenshots to dir)
//
// A full practice run lasts about 65 seconds, so the walk takes around two minutes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startPreview } from '../scripts/preview.mjs';

const outIndex = process.argv.indexOf('--out');
const out = outIndex > 0 ? process.argv[outIndex + 1] : null;
const module = process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : 'playwright';
const { chromium, webkit } = await import(module);

const PORT = 4179;
const URL_BASE = `http://127.0.0.1:${PORT}/preview/`;
const results = [];

/** What the stand-in API currently answers. */
const api = { mode: 'ok', count: 92730, rpmMilli: 0, beat: 0 };

function statusBody() {
  const now = new Date();
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    measurement: {
      freshness: api.mode === 'api-stale' ? 'stale' : 'online',
      observedAt: new Date(now.getTime() - 1000 - (api.beat % 5)).toISOString(),
      receivedAt: new Date(now.getTime() - 500).toISOString(),
      staleAfterSeconds: 120,
      counterEpoch: 'test-epoch',
      cumulativeWorkUnits: String(api.count),
      provenance: 'hardware',
      coreStatus: 'IDLE',
      rpmMilli: api.rpmMilli,
    },
  };
}

async function routeApi(page) {
  await page.route('https://api.squeekchain.com/**', async (route) => {
    const headers = { 'access-control-allow-origin': '*' };
    if (route.request().url().includes('/stats')) {
      await route.fulfill({ status: 503, headers, body: '{"error":"database_busy"}' });
      return;
    }
    if (api.mode === 'down') {
      await route.abort();
      return;
    }
    api.beat += 1;
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(statusBody()) });
  });
}

async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error) });
    console.log(`FAIL ${name}\n     ${error}`);
  }
}

async function open(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(URL_BASE)) problems.push(`failed ${request.url()}`);
  });
  await routeApi(page);
  await page.goto(URL_BASE);
  await page.waitForSelector('#feed[data-state="resting"], #feed[data-state="running"]');
  return { page, problems, context };
}

const shot = async (page, name) => {
  if (out) await page.screenshot({ path: join(out, `${name}.png`) });
};

async function walk(browserType, label) {
  const browser = await browserType.launch();

  for (const [width, height] of [[320, 640], [390, 844], [1440, 900]]) {
    await check(`${label} ${width}: main action on the first screen, no sideways scroll`, async () => {
      api.mode = 'ok';
      const { page, problems, context } = await open(browser, width, height);
      const box = await page.locator('#start-live').boundingBox();
      if (width >= 390) assert.ok(box.y + box.height <= height, `Start ends at ${box.y + box.height}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0);
      assert.deepEqual(problems, []);
      await shot(page, `${label}-${width}-setup`);
      await context.close();
    });
  }

  await check(`${label}: passages from a reading move the racer and nothing else does`, async () => {
    api.mode = 'ok';
    api.rpmMilli = 0;
    const { page, context } = await open(browser, 390, 844);
    await page.getByRole('radio', { name: 'Bramble' }).check({ force: true });
    await page.getByRole('button', { name: 'Start live run' }).click();
    await page.waitForFunction(() => document.body.dataset.phase === 'racing', null, { timeout: 6000 });
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('#hud-passages').textContent(), '0');
    assert.equal(await page.locator('#feed').getAttribute('data-state'), 'resting');
    api.count += 15;
    api.rpmMilli = 77000;
    await page.waitForFunction(() => document.getElementById('hud-passages')?.textContent === '15', null, { timeout: 6000 });
    await page.waitForTimeout(1500);
    const moved = await page.locator('#racer-on-rim').getAttribute('transform');
    assert.notEqual(moved, 'rotate(0.00 200 200)');
    assert.equal(await page.locator('#feed').getAttribute('data-state'), 'running');
    await shot(page, `${label}-390-live`);

    await page.getByRole('button', { name: 'Stop run' }).click();
    assert.equal(await page.locator('#result-title').textContent(), 'Run stopped');
    assert.equal(await page.locator('#history-empty').isVisible(), true);
    await context.close();
  });

  await check(`${label}: a lost feed shows stale, blocks live runs and leaves practice open`, async () => {
    api.mode = 'ok';
    const { page, context } = await open(browser, 390, 844);
    api.mode = 'api-stale';
    await page.waitForSelector('#feed[data-state="stale"]', { timeout: 8000 });
    assert.equal(await page.locator('#start-live').isDisabled(), true);
    assert.equal(await page.locator('#start-practice').isDisabled(), false);
    await shot(page, `${label}-390-stale`);
    api.mode = 'ok';
    await page.waitForSelector('#feed[data-state="resting"], #feed[data-state="running"]', { timeout: 8000 });
    assert.equal(await page.locator('#start-live').isDisabled(), false);
    await context.close();
  });

  await check(`${label}: practice is labeled throughout, plays to a result and stays out of live results`, async () => {
    api.mode = 'ok';
    const { page, problems, context } = await open(browser, 390, 844);
    await page.getByRole('radio', { name: '1 min' }).check({ force: true });
    await page.getByRole('button', { name: 'Start practice run' }).click();
    assert.equal(await page.locator('#practice-banner').isVisible(), true);
    await page.waitForFunction(() => document.body.dataset.phase === 'racing', null, { timeout: 6000 });

    // Press the baton whenever the zone opens, the way a player would.
    const deadline = Date.now() + 80000;
    while (Date.now() < deadline) {
      if ((await page.evaluate(() => document.body.dataset.phase)) === 'result') break;
      const ready = await page.locator('#pass').getAttribute('data-ready');
      if (ready === 'zone' || ready === 'line') await page.locator('#pass').click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    assert.equal(await page.evaluate(() => document.body.dataset.phase), 'result');
    assert.match(await page.locator('#result-title').textContent(), /^Practice finished/);
    assert.equal(await page.locator('#practice-banner').isVisible(), true);
    assert.equal(await page.locator('#history-empty').isVisible(), true);
    assert.deepEqual(problems, []);
    await shot(page, `${label}-390-practice-result`);

    await page.getByRole('button', { name: /^Replay with/ }).click();
    assert.equal(await page.evaluate(() => document.body.dataset.phase), 'countdown');
    await context.close();
  });

  await check(`${label}: help opens, closes with Escape and returns focus`, async () => {
    api.mode = 'ok';
    const { page, context } = await open(browser, 1440, 900);
    await page.getByRole('button', { name: 'Help' }).click();
    assert.equal(await page.locator('#help').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#help').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'help-open');
    await context.close();
  });

  await browser.close();
}

const server = await startPreview(PORT);
if (out) await mkdir(out, { recursive: true });
await walk(chromium, 'chromium');
await walk(webkit, 'webkit').catch((error) => {
  results.push({ name: 'webkit walk', ok: false, error: String(error) });
  console.log(`FAIL webkit could not run: ${error}`);
});
server.close();

if (out) await writeFile(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((result) => !result.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
