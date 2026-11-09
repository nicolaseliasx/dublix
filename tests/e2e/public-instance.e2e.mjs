// End-to-end check of the setup page with a mocked Stremio API and a real local AIOStreams instance.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const SITE = process.env.E2E_SITE ?? 'http://127.0.0.1:8788';
const LOCAL_AIO = 'http://127.0.0.1:18391';
const OUT = process.env.E2E_OUT ?? new URL('.', import.meta.url).pathname;
const d = (id, name, transportUrl) => ({ transportUrl, manifest: { id, name, version: '1.0.0', resources: ['stream'], types: ['movie'] }, flags: {} });
const initial = [
  d('com.linvo.cinemeta', 'Cinemeta', 'https://v3-cinemeta.strem.io/manifest.json'),
  d('com.stremio.torrentio.addon', 'Torrentio', 'https://torrentio.strem.fun/manifest.json'),
  d('org.stremio.opensubtitlesv3', 'OpenSubtitles v3<img src=x id=pwned>', 'https://opensubtitles-v3.strem.io/manifest.json'),
  d('org.stremio.local', 'Local Files', 'http://127.0.0.1:11470/local-addon/manifest.json'),
];
let collection = structuredClone(initial);
const calls = [];
const errors = [];
const assert = (ok, msg) => { if (!ok) throw new Error(`FAIL: ${msg}`); console.log(`ok   ${msg}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.route('https://api.strem.io/api/**', async (route) => {
  const method = new URL(route.request().url()).pathname.split('/').pop();
  const body = route.request().postDataJSON();
  calls.push({ method, body });
  const reply = (result) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ result }) });
  if (method === 'login') return route.abort();
  if (body.authKey !== 'AUTH') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'Session does not exist' } }) });
  if (method === 'addonCollectionGet') return reply({ addons: collection });
  if (method === 'addonCollectionSet') { collection = body.addons; return reply({ success: true }); }
  return route.abort();
});
// Profile creation through the site's proxy goes to a real local AIOStreams v2.37.0 instead of a public instance.
let createdConfig;
await page.route(`${SITE}/api/aio?instance=*`, async (route) => {
  if (route.request().method() !== 'POST') return route.continue();
  const body = route.request().postDataJSON();
  createdConfig = body.config;
  const res = await fetch(`${LOCAL_AIO}/api/v1/user`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});
await page.route('https://aiostreamsfortheweebs.midnightignite.me/stremio/**', async (route) => {
  const res = await fetch(route.request().url().replace('https://aiostreamsfortheweebs.midnightignite.me', LOCAL_AIO));
  return route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
});

await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)));
await page.goto(SITE);
// A locator wait, not waitForFunction: the site's CSP forbids eval, which waitForFunction needs.
await page.locator('#instance-status').filter({ hasNotText: 'Checking' }).waitFor({ timeout: 30000 });
console.log('     instance status:', await page.textContent('#instance-status'));
await page.screenshot({ path: `${OUT}desktop-top.png` });

// Portuguese (Brazil) stays the default language, and the page words follow it.
assert(await page.inputValue('#language') === 'pt-BR', 'pt-BR is the default language');
assert((await page.textContent('section[aria-labelledby="s5"]')).includes('Portuguese (Brazil) per quality') && (await page.textContent('#subs-title')).includes('Brazilian Portuguese'), 'default texts are pt-BR');
assert(await page.isHidden('#language-basic'), 'no "basic" warning for pt-BR');
assert(await page.locator('#language optgroup').count() === 2 && await page.locator('#language option').count() >= 40, 'language selector offers curated and basic languages');
// Only an AuthKey is asked for: no Stremio email or password field exists.
assert(await page.locator('#email, #password, input[type="email"]').count() === 0, 'no Stremio email/password fields');
// A wrong AuthKey is reported, nothing is written.
await page.fill('#authkey', 'WRONG');
await page.fill('[data-cred="apiKey"]', 'fake-torbox-key');
await page.click('#review-btn');
await page.waitForSelector('#log li.err');
assert((await page.textContent('#log')).includes('AuthKey'), 'a rejected AuthKey is explained');
assert(!calls.some((c) => c.method === 'addonCollectionSet'), 'nothing written with a rejected AuthKey');

// Two services, no TMDB, 1080p+720p, 2 PT + 1 original, smart subs.
await page.fill('#authkey', 'AUTH');
await page.click('#add-service');
const second = page.locator('.service-row').nth(1);
await second.locator('select').selectOption('easynews');
await second.locator('[data-cred="username"]').fill('user');
await second.locator('[data-cred="password"]').fill('pass');
await page.locator('#tiers input[value="2160p"]').uncheck({ force: true });
assert(await page.isVisible('#tmdb-warn'), 'TMDB warning is visible without a key');
await page.click('#review-btn');
await page.waitForSelector('#review:not([hidden])');
const review = await page.textContent('#review');
console.log('     review:', review.replace(/\s+/g, ' '));
assert(/add\s*Filmhub/.test(review) && /OpenSubtitles v3<img src=x id=pwned> → Filmhub Subs/.test(review) && /keep\s*Torrentio/.test(review), 'review lists add / replace / keep');
assert(await page.locator('#review img, #pwned').count() === 0, 'addon names are shown as text, never as HTML');
assert(!(await page.isDisabled('#install-btn')), 'install enabled after review');
await page.screenshot({ path: `${OUT}desktop-review.png`, fullPage: true });

const downloadPromise = page.waitForEvent('download');
await page.click('#install-btn');
const backup = await downloadPromise;
const backupPath = `${OUT}backup.json`;
await backup.saveAs(backupPath);
await page.waitForSelector('#done:not([hidden]), #log li.err', { timeout: 60000 });
console.log('     log:', (await page.textContent('#log')).replace(/\s+/g, ' '));
assert(await page.isVisible('#done'), 'install finished');
assert(createdConfig.services.map((s) => s.id).join() === 'torbox,easynews', 'profile created with both services');
assert(createdConfig.titleMatching.enabled === false && createdConfig.tmdbApiKey === '', 'no TMDB: title matching off');
assert(createdConfig.resultLimits.global === 6, 'list size follows 2 tiers x 3');
assert(createdConfig.formatter.definitions.custom.description.startsWith('{stream.rseMatched::~Filmhub Next T4: áudio Dual["Dual áudio\n"||""]}'), 'default install uses the pt-BR labels');
assert(createdConfig.presets.some((p) => p.instanceId === 'filmhub-ptbr') && createdConfig.preferredLanguages[0] === 'Portuguese (Brazil)', 'default install uses the pt-BR sources and language order');
const names = collection.map((a) => a.manifest.name);
console.log('     collection:', names.join(' | '));
assert(names.join() === 'Cinemeta,Filmhub,Torrentio,Filmhub Subs,Local Files', 'Stremio collection merged in place (subs take OpenSubtitles slot)');
assert(collection[1].transportUrl.startsWith('https://aiostreamsfortheweebs.midnightignite.me/stremio/'), 'Filmhub points at the chosen instance');
assert(collection[3].transportUrl === `${SITE}/subs/manifest.json`, 'subs point at this site');
assert(JSON.stringify(collection[2]) === JSON.stringify(initial[1]), 'Torrentio descriptor untouched');
const saved = JSON.parse((await import('node:fs')).readFileSync(backupPath, 'utf8'));
assert(JSON.stringify(saved.addons) === JSON.stringify(initial), 'backup holds the pre-install collection');

const profilePromise = page.waitForEvent('download');
await page.click('#profile-btn');
const profile = JSON.parse(await (await profilePromise).createReadStream().then((s) => new Promise((ok) => { let b = ''; s.on('data', (c) => { b += c; }).on('end', () => ok(b)); })));
assert(profile.uuid && profile.password && profile.manifestUrl, 'profile details downloadable');
await page.screenshot({ path: `${OUT}desktop-done.png`, fullPage: true });

// Restore puts the backup back.
await page.click('.restore summary');
await page.setInputFiles('#restore-file', backupPath);
const readsBefore = calls.filter((c) => c.method === 'addonCollectionGet' && c.body.authKey === 'AUTH').length;
assert((await page.textContent('#restore-preview')).includes('Torrentio'), 'restore lists the addons it will put back');
const preRestore = page.waitForEvent('download');
await page.click('#restore-btn');
const preRestoreFile = await preRestore;
await page.waitForSelector('#log li.ok, #log li.err');
assert(calls.filter((c) => c.method === 'addonCollectionGet' && c.body.authKey === 'AUTH').length > readsBefore, 'restore uses the AuthKey in the form');
assert(!calls.some((c) => c.method === 'login'), 'the Stremio password login is never used');
assert(/stremio-addons-before-restore/.test(preRestoreFile.suggestedFilename()), 'restore saves the current addons first');
assert(JSON.stringify(collection) === JSON.stringify(initial), 'restore brings back the original collection');

// Another language: Spanish (Latin America), only that language. The profile, the labels and the subtitles addon follow the choice.
await page.selectOption('#language', 'es-419');
assert((await page.textContent('section[aria-labelledby="s5"]')).includes('Spanish (Latin America) per quality') && (await page.textContent('#subs-title')).includes('Smart Spanish subtitles'), 'texts follow the chosen language');
assert(await page.isHidden('#language-basic') && (await page.textContent('#language-note')).includes('not yet measured'), 'curated, unmeasured language is described as such');
await page.check('#language-only');
assert(await page.isDisabled('#orig-slots'), 'only-my-language disables the original-audio count');
await page.click('#review-btn');
await page.waitForSelector('#review:not([hidden]), #log li.err');
const reviewEs = await page.textContent('#review');
assert(/OpenSubtitles v3<img src=x id=pwned> → Filmhub Subs Spanish \(Latin America\)/.test(reviewEs), 'review shows the Spanish subtitles addon replacing OpenSubtitles');
await page.click('#install-btn');
await page.waitForSelector('#done:not([hidden]), #log li.err', { timeout: 60000 });
assert(await page.isVisible('#done'), 'Spanish install finished');
const description = createdConfig.formatter.definitions.custom.description;
assert(description.startsWith('{stream.rseMatched::~Filmhub Next T4: áudio Dual["Doble audio\n"||""]}') && description.includes('["Latino\n"||""]'), 'created profile uses the Latino labels');
assert(createdConfig.preferredLanguages[0] === 'Latino' && createdConfig.presets.some((p) => p.instanceId === 'filmhub-es419') && !createdConfig.presets.some((p) => p.instanceId === 'filmhub-ptbr'), 'created profile uses the Spanish sources');
assert(!JSON.stringify(createdConfig).match(/Portuguese|PT-BR|dublado/i), 'created Spanish profile carries nothing Portuguese');
assert(createdConfig.resultLimits.global === 4 && createdConfig.excludedStreamExpressions.some((e) => e.expression.includes('só o idioma')), 'only-my-language: 2 tiers x 2, no original audio');
const esNames = collection.map((a) => a.manifest.name);
console.log('     collection:', esNames.join(' | '));
assert(esNames.join() === 'Cinemeta,Filmhub,Torrentio,Filmhub Subs Spanish (Latin America),Local Files', 'Spanish subtitles addon took the OpenSubtitles slot');
assert(collection[3].transportUrl === `${SITE}/subs/es-419/manifest.json` && collection[3].manifest.id === 'filmhub.subs.es-419', 'subs come from this site\'s per-language route');
const manifestPt = await (await fetch(`${SITE}/subs/manifest.json`)).json();
assert(manifestPt.id === 'filmhub.subs' && manifestPt.name === 'Filmhub Subs', 'the original /subs/manifest.json is still pt-BR');
const esSubs = await (await fetch(`${SITE}/subs/es-419/subtitles/movie/tt0133093/${encodeURIComponent('filename=Matrix.1999.Latino.1080p.mkv')}.json`)).json();
assert(Array.isArray(esSubs.subtitles) && esSubs.subtitles.length === 0, 'a Latino-dubbed file gets no subtitles from the Spanish addon');
// Back to pt-BR: the Spanish subtitles addon is replaced in place by the original Filmhub Subs.
await page.selectOption('#language', 'pt-BR');
await page.uncheck('#language-only');
assert(!(await page.isDisabled('#orig-slots')), 'original-audio count is enabled again');
await page.click('#review-btn');
await page.waitForSelector('#review:not([hidden]), #log li.err');
assert(/Filmhub Subs Spanish \(Latin America\) → Filmhub Subs/.test(await page.textContent('#review')), 'review shows the Spanish addon replaced by pt-BR');
await page.click('#install-btn');
await page.waitForSelector('#done:not([hidden]), #log li.err', { timeout: 60000 });
assert(createdConfig.preferredLanguages[0] === 'Portuguese (Brazil)', 'pt-BR again');
assert(collection.map((a) => a.manifest.name).join() === 'Cinemeta,Filmhub,Torrentio,Filmhub Subs,Local Files' && collection[3].transportUrl === `${SITE}/subs/manifest.json`, 'pt-BR subtitles are back at /subs/manifest.json');
// A basic language is clearly marked.
await page.selectOption('#language', 'ja');
assert(await page.isVisible('#language-basic') && (await page.textContent('#language-basic')).includes('Basic support'), 'basic languages carry a warning');
assert((await page.locator('#language option:checked').textContent()).includes('(basic)'), 'basic languages are marked in the selector');

// Look-alike "home network" hosts are refused for plain HTTP.
await page.check('input[name="host"][value="own"]');
for (const bad of ['http://10.evil.com', 'http://localhost.evil.com', 'http://192.168.1.10']) {
  await page.fill('#own-url', bad);
  await page.click('#review-btn');
  await page.waitForSelector('#log li.err');
  assert((await page.textContent('#log')).includes('HTTPS'), `plain HTTP refused for ${bad}`);
}

// Mobile layout: no horizontal scroll.
const mobile = await browser.newPage({ viewport: { width: 375, height: 800 } });
await mobile.goto(SITE);
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert(overflow <= 0, `no horizontal scroll on phones (${overflow}px)`);
await mobile.selectOption('#language', 'fr');
const overflowFr = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert(overflowFr <= 0, `no horizontal scroll on phones with a language chosen (${overflowFr}px)`);
await mobile.screenshot({ path: `${OUT}mobile.png`, fullPage: true });

assert(errors.length === 0, `no console errors ${errors.join(' / ')}`);
await browser.close();
console.log('all passed');
