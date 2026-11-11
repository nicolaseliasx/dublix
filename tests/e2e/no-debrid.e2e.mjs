// Browser regression: Stremio and profile creation are mocked; no real account is changed.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const SITE = process.env.E2E_SITE ?? 'http://127.0.0.1:8788';
// Optional real AIOStreams; Stremio itself is always mocked.
const AIO = process.env.E2E_AIO;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  if (process.env.E2E_STALE_CSS) {
    const { readFileSync } = await import('node:fs');
    await page.route('**/styles.css', (route) => route.fulfill({ contentType: 'text/css', body: readFileSync(process.env.E2E_STALE_CSS) }));
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let collection = [];
  let createdConfig;
  await page.route('https://api.strem.io/api/**', (route) => {
    const body = route.request().postDataJSON();
    if (body.type === 'AddonCollectionSet') collection = body.addons;
    return route.fulfill({ json: { result: body.type === 'AddonCollectionGet' ? { addons: collection } : { success: true } } });
  });
  await page.route(`${SITE}/api/aio*`, async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { success: true, data: { version: 'test' } } });
    createdConfig = route.request().postDataJSON().config;
    if (AIO) {
      const res = await fetch(`${AIO}/api/v1/user`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: route.request().postData(), signal: AbortSignal.timeout(60000) });
      return route.fulfill({ status: res.status, json: await res.json() });
    }
    return route.fulfill({ json: { success: true, data: { uuid: 'test-profile', encryptedPassword: 'test-password' } } });
  });
  await page.route('https://*/stremio/test-profile/test-password/manifest.json', (route) => route.fulfill({
    json: { id: 'dublix.test', name: 'Dublix', version: '1.0.0', resources: ['stream'], types: ['movie', 'series'] },
  }));
  if (AIO) await page.route('https://*/stremio/**/manifest.json', async (route) => {
    const res = await fetch(route.request().url().replace(/^https:\/\/[^/]+/, AIO));
    return route.fulfill({ status: res.status, json: await res.json() });
  });
  await page.goto(SITE);
  assert.equal(await page.locator('.service-row select').inputValue(), 'torbox', 'TorBox stays selected by default');
  assert.equal(await page.locator('#s2 .optional').textContent(), 'optional');
  assert.equal(await page.locator('section[aria-labelledby="s2"] svg').count(), 0, 'the debrid section has no decorative icon');
  assert.equal(await page.locator('#debrid-recommendation.hint').count(), 1, 'recommendation uses the standard hint style');
  assert.match(await page.textContent('#debrid-advice-title'), /every play is a gamble/i);
  assert.equal(await page.isVisible('#debrid-recommendation'), true, 'recommendation is visible before removing the service');
  assert.ok((await page.locator('section[aria-labelledby="s2"]').boundingBox()).height < 500, 'desktop section stays compact');
  if (process.env.E2E_OUT) await page.locator('section[aria-labelledby="s2"]').screenshot({ path: `${process.env.E2E_OUT}debrid-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal overflow on mobile');
  assert.ok((await page.locator('section[aria-labelledby="s2"]').boundingBox()).height < 650, 'mobile section stays compact');
  if (process.env.E2E_OUT) await page.locator('section[aria-labelledby="s2"]').screenshot({ path: `${process.env.E2E_OUT}debrid-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.fill('#authkey', 'TEST');
  await page.fill('[data-cred="apiKey"]', 'test-key');
  await page.check('input[name="subs"][value="keep"]');
  await page.click('#review-btn');
  await page.locator('#review:not([hidden])').waitFor();
  assert.equal(await page.isDisabled('#install-btn'), false);

  let warnings = 0;
  page.once('dialog', async (d) => { warnings++; assert.match(d.message(), /P2P/); await d.dismiss(); });
  await page.click('.service-row .remove');
  assert.equal(await page.locator('.service-row').count(), 1, 'Cancel keeps the service');
  assert.equal(await page.isDisabled('#install-btn'), false, 'Cancel preserves the review');
  page.once('dialog', async (d) => { warnings++; assert.match(d.message(), /slow|buffer/i); assert.match(d.message(), /seed/i); await d.accept(); });
  await page.click('.service-row .remove');
  assert.equal(await page.locator('.service-row').count(), 0, 'last service can be removed');
  assert.equal(warnings, 2, 'removing the last service warns each time');
  assert.equal(await page.isDisabled('#install-btn'), true, 'removal invalidates the review');
  assert.equal(await page.isVisible('#no-debrid-warn'), true);
  assert.equal(await page.isDisabled('#cached-only'), true);
  assert.equal(await page.isChecked('#cached-only'), false);

  await page.click('#review-btn');
  await page.locator('#review:not([hidden])').waitFor();
  await page.click('#install-btn');
  await page.locator('#done:not([hidden])').waitFor({ timeout: 60000 });
  assert.deepEqual(createdConfig.services, []);
  assert.equal(createdConfig.excludedStreamTypes.includes('p2p'), false);
  assert.equal(createdConfig.serviceWrap.enabled, false);
  assert.ok(collection.some((a) => a.manifest.name === 'Dublix'), 'P2P install reaches the addon collection');

  await page.click('#add-service');
  assert.equal(await page.isDisabled('#install-btn'), true, 'adding a service invalidates the review');
  assert.equal(await page.isHidden('#no-debrid-warn'), true);
  assert.equal(await page.isDisabled('#cached-only'), false);
  assert.equal(await page.isChecked('#cached-only'), true, 'previous cache preference restored');
  await page.click('#add-service');
  await page.locator('.service-row .remove').last().click();
  assert.equal(warnings, 2, 'removing an extra service needs no warning');
  assert.equal(await page.locator('.service-row').count(), 1);
  assert.deepEqual(errors, []);
  console.log('ok: warning accept/cancel, P2P install, review invalidation, re-add and cache preference');
} finally {
  await browser.close();
}
