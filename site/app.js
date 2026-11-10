// Dublix setup page. Everything runs in the browser; only /api/aio (profile creation on a public
// instance, which sends no CORS headers) goes through this site's Worker.
import { buildFilmhubConfig } from './lib/policy/config.mjs';
import { SERVICE_IDS } from './lib/policy/policy.mjs';
import { DEFAULT_LANGUAGE, getLanguage, languageList } from './lib/policy/languages.mjs';
import { manifestFor } from './lib/subs/subs.mjs';
import { mergeCollection } from './lib/stremio/collection.mjs';
import { INSTANCES } from './lib/proxy/aio-proxy.mjs';

const STREMIO_API = 'https://api.strem.io/api';
const SERVICE_LABELS = {
  torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize',
  debridlink: 'Debrid-Link', offcloud: 'Offcloud', easynews: 'Easynews',
};
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const state = { authKey: null, collection: null, profile: null };
let basePromise;

// ---------- small helpers ----------
const log = (text, kind = 'run') => {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = text;
  $('#log').append(li);
  return (t = text, k = 'ok') => { li.textContent = t; li.className = k; };
};
const download = (name, data) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const randomPassword = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 28);
};
async function stremio(method, body) {
  const res = await fetch(`${STREMIO_API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (data.error || !data.result) throw new Error(data.error?.message || `Stremio refused ${method} (${res.status})`);
  return data.result;
}

// ---------- step 1: Stremio AuthKey (the page never asks for the Stremio password) ----------
$('#copy-cmd').addEventListener('click', async () => {
  const button = $('#copy-cmd');
  try {
    await navigator.clipboard.writeText($('#authkey-cmd').textContent);
    button.textContent = 'Copied';
  } catch {
    getSelection().selectAllChildren($('#authkey-cmd'));
    button.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => { button.textContent = 'Copy'; }, 2000);
});
async function authenticate() {
  const key = $('#authkey').value.trim().replace(/^"|"$/g, '');
  if (!key) throw new Error('Paste your Stremio AuthKey.');
  return key;
}
async function getCollection(authKey) {
  try {
    return (await stremio('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true })).addons ?? [];
  } catch (e) {
    throw new Error(`Stremio did not accept this AuthKey (${e.message}). Copy it again from web.stremio.com.`);
  }
}
const setCollection = (authKey, addons) => stremio('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons });

// ---------- step 2: debrid services ----------
let cachedPreference = $('#cached-only').checked;
function updateServiceMode() {
  const noDebrid = $$('.service-row').length === 0;
  const cached = $('#cached-only');
  if (noDebrid && !cached.disabled) cachedPreference = cached.checked;
  cached.checked = noDebrid ? false : cachedPreference;
  cached.disabled = noDebrid;
  $('#no-debrid-warn').hidden = !noDebrid;
  $('#add-service').textContent = noDebrid ? '+ Add a service' : '+ Add another service';
}
$('#cached-only').addEventListener('change', () => { cachedPreference = $('#cached-only').checked; });
function serviceRow(id = 'torbox') {
  const row = document.createElement('div');
  row.className = 'service-row';
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', 'Debrid service');
  for (const s of SERVICE_IDS) select.append(new Option(SERVICE_LABELS[s], s, false, s === id));
  const creds = document.createElement('div');
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'remove', textContent: '×', title: 'Remove' });
  const renderCreds = () => {
    const easynews = select.value === 'easynews';
    creds.className = easynews ? 'creds two' : 'creds';
    creds.innerHTML = easynews
      ? '<input class="field" data-cred="username" placeholder="Easynews username"><input class="field" type="password" data-cred="password" placeholder="Easynews password">'
      : `<input class="field mono" type="password" data-cred="apiKey" placeholder="${SERVICE_LABELS[select.value]} API key">`;
  };
  select.addEventListener('change', () => { renderCreds(); resetReview(); });
  remove.addEventListener('click', () => {
    if ($$('.service-row').length === 1 && !confirm('Continue without a debrid service? Dublix will use P2P torrents, which depend on available seeds and may be slow, buffer or fail to play. You need a Stremio player with P2P support; your IP is visible to peers.')) return;
    row.remove();
    updateServiceMode();
    resetReview();
  });
  renderCreds();
  row.append(select, creds, remove);
  $('#services').append(row);
  updateServiceMode();
}
const readServices = () => $$('.service-row').map((row) => ({
  id: row.querySelector('select').value,
  credentials: Object.fromEntries([...row.querySelectorAll('[data-cred]')].map((i) => [i.dataset.cred, i.value])),
}));
$('#add-service').addEventListener('click', () => {
  const used = new Set(readServices().map((s) => s.id));
  serviceRow(SERVICE_IDS.find((s) => !used.has(s)) ?? 'torbox');
  resetReview();
});

// ---------- step 3: TMDB ----------
const tmdbWarn = () => { $('#tmdb-warn').hidden = Boolean($('#tmdb').value.trim()); };
$('#tmdb').addEventListener('input', tmdbWarn);

// ---------- step 4: instance ----------
const hostMode = () => document.querySelector('input[name="host"]:checked').value;
$$('input[name="host"]').forEach((r) => r.addEventListener('change', () => {
  $$('[data-host-panel]').forEach((p) => { p.hidden = p.dataset.hostPanel !== hostMode(); });
  resetReview();
}));
async function checkInstances() {
  const select = $('#instance');
  for (const i of INSTANCES) select.append(new Option(i.label, i.host));
  const results = await Promise.all(INSTANCES.map(async (i) => {
    try {
      const res = await fetch(`/api/aio?instance=${encodeURIComponent(i.host)}&op=status`, { signal: AbortSignal.timeout(12000) });
      const data = await res.json();
      return data.success ? `${i.label}: online (v${data.data.version})` : `${i.label}: unavailable`;
    } catch { return `${i.label}: unavailable`; }
  }));
  $('#instance-status').textContent = results.join(' · ');
}
function instanceBase() {
  if (hostMode() === 'public') return { base: `https://${$('#instance').value}`, viaProxy: true };
  const raw = $('#own-url').value.trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Enter the address of your Dublix server.'); }
  // Browsers block plain-HTTP calls from this HTTPS page except to this computer, so only exact loopback hosts may use HTTP.
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Your server must use HTTPS (plain HTTP only works for a server on this computer).');
  return { base: url.origin + url.pathname.replace(/\/+$/, ''), viaProxy: false };
}

// ---------- step 5: language and options ----------
// Language names, labels and notes come from the bundled language profiles (never from outside), and are written as text.
const language = () => getLanguage($('#language').value || DEFAULT_LANGUAGE);
function renderLanguages() {
  const select = $('#language');
  const group = (label, items, suffix = '') => {
    const optgroup = Object.assign(document.createElement('optgroup'), { label });
    for (const l of items) optgroup.append(new Option(`${l.name}${suffix}`, l.id, false, l.id === DEFAULT_LANGUAGE));
    return optgroup;
  };
  const list = languageList();
  select.replaceChildren(group('Curated', list.filter((l) => l.quality === 'curated')), group('Basic (language detection only)', list.filter((l) => l.quality === 'basic'), ' (basic)'));
  select.value = DEFAULT_LANGUAGE;
}
function applyLanguage() {
  const l = language();
  const words = { name: l.name, dubbed: l.labels.dubbed, dual: l.labels.dual, original: l.labels.original };
  for (const el of $$('[data-lang]')) el.textContent = words[el.dataset.lang];
  $('#subs-title').textContent = `Smart ${l.subs.name} subtitles`;
  $('#subs-desc').textContent = l.subs.dub
    ? `None on files with ${l.subs.name} audio; ${l.subs.name} subtitles on any other audio. Replaces OpenSubtitles v3.`
    : `${l.subs.name} subtitles on every file (file names do not reveal ${l.name} audio). Replaces OpenSubtitles v3.`;
  $('#language-note').textContent = l.id === DEFAULT_LANGUAGE
    ? 'Measured on real titles.'
    : l.quality === 'curated' ? 'Curated keywords and sources, but not yet measured on real titles.' : '';
  // The title's original language comes from TMDB metadata; without it nothing can be called "original" for English.
  if (l.originalFromQuery) $('#language-note').textContent += ' Original-audio options for titles that are not in English need a TMDB key (step 3); without one you get English options only.';
  const basic = $('#language-basic');
  basic.hidden = l.quality !== 'basic';
  basic.textContent = `Basic support: only AIOStreams' own language detection is used for ${l.name}, with no keyword list and no extra sources. Labels and ordering are less reliable.`;
}
$('#language').addEventListener('change', applyLanguage);
$('#language-only').addEventListener('change', () => { $('#orig-slots').disabled = $('#language-only').checked; });
function readOptions() {
  const tiers = $$('#tiers input:checked').map((i) => i.value);
  if (!tiers.length) throw new Error('Pick at least one quality.');
  const ptSlots = Number($('#pt-slots').value);
  const languageOnly = $('#language-only').checked;
  const originalSlots = languageOnly ? 0 : Number($('#orig-slots').value);
  if (ptSlots + originalSlots === 0) throw new Error(languageOnly ? `Show at least one ${language().name} option per quality.` : `Show at least one ${language().name} or original option per quality.`);
  return { tiers, ptSlots, originalSlots, cachedOnly: $('#cached-only').checked, language: language().id, languageOnly };
}
const smartSubs = () => document.querySelector('input[name="subs"]:checked').value === 'smart';

// ---------- build, create, install ----------
async function buildConfig() {
  basePromise ??= fetch('lib/policy/base-config.json').then((r) => { if (!r.ok) throw new Error('Could not load the Dublix base configuration.'); return r.json(); });
  return buildFilmhubConfig(await basePromise, { services: readServices(), tmdbApiKey: $('#tmdb').value, ...readOptions() });
}
async function createProfile(config, { base, viaProxy }, onRetry) {
  const password = randomPassword();
  const target = viaProxy ? `/api/aio?instance=${encodeURIComponent(new URL(base).host)}` : `${base}/api/v1/user`;
  let res;
  let data;
  // The instance validates every source manifest on creation; a slow source (e.g. Torrentio) makes it refuse. Retry twice.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) { onRetry?.(attempt); await new Promise((ok) => setTimeout(ok, 4000)); }
    res = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config, password }) });
    data = await res.json().catch(() => ({}));
    if (data.success || !/timed out|timeout/i.test(data.error?.message ?? '')) break;
  }
  if (!data.success) throw new Error(data.error?.message ? `The instance refused the profile: ${data.error.message}` : `The instance refused the profile (${res.status}).`);
  const manifestUrl = `${base}/stremio/${data.data.uuid}/${data.data.encryptedPassword}/manifest.json`;
  return { instance: base, uuid: data.data.uuid, password, manifestUrl, configureUrl: `${base}/stremio/configure` };
}
async function descriptor(transportUrl) {
  const res = await fetch(transportUrl);
  if (!res.ok) throw new Error(`Addon manifest unavailable (${res.status}).`);
  return { transportUrl, manifest: await res.json(), flags: {} };
}
// Brazilian Portuguese keeps the original /subs/manifest.json (already installed in accounts); every other language has /subs/<id>/.
const subsPath = () => (language().id === DEFAULT_LANGUAGE ? '/subs/manifest.json' : `/subs/${language().id}/manifest.json`);
const subsUrl = () => (hostMode() === 'own' ? `${instanceBase().base}${subsPath()}` : new URL(subsPath(), location.href).href);

function resetReview() {
  $('#review').hidden = true;
  $('#install-btn').disabled = true;
  state.collection = null;
}
// Addon names come from the user's Stremio account (any addon can name itself anything): text only, never HTML.
function listItem(tag, text) {
  const li = document.createElement('li');
  const badge = Object.assign(document.createElement('span'), { className: `tag ${tag}`, textContent: tag });
  li.append(badge, Object.assign(document.createElement('span'), { textContent: text }));
  return li;
}
function renderReview(changes, current) {
  const touched = new Set(changes.flatMap((c) => [c.name, c.with]));
  const kept = current.map((a) => a.manifest?.name).filter((n) => n && !touched.has(n) && !['Dublix', 'Filmhub'].includes(n) && !n.startsWith('Dublix Subs') && !n.startsWith('Filmhub Subs'));
  const ul = document.createElement('ul');
  for (const c of changes) ul.append(listItem(c.action, c.with ? `${c.name} → ${c.with}` : c.name));
  for (const n of kept) ul.append(listItem('keep', n));
  $('#review').replaceChildren(ul);
  $('#review').hidden = false;
}

$('#review-btn').addEventListener('click', async () => {
  $('#log').replaceChildren();
  $('#done').hidden = true;
  try {
    await buildConfig();
    instanceBase();
    const step = log('Connecting to Stremio…');
    state.authKey = await authenticate();
    state.collection = await getCollection(state.authKey);
    step(`Connected. Your account has ${state.collection.length} addons.`);
    const placeholder = (name, id) => ({ transportUrl: `https://placeholder/${id}/x/manifest.json`, manifest: { id, name }, flags: {} });
    const { changes } = mergeCollection(state.collection, {
      streams: placeholder('Dublix', 'filmhub.preview'), subs: smartSubs() ? placeholder(manifestFor(language().id).name, manifestFor(language().id).id) : null,
    });
    renderReview(changes, state.collection);
    $('#install-btn').disabled = false;
  } catch (e) { log(e.message, 'err'); }
});

$('#setup').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.authKey || !state.collection) return;
  $('#install-btn').disabled = true;
  $('#log').replaceChildren();
  try {
    download(`stremio-addons-backup-${stamp()}.json`, { savedAt: new Date().toISOString(), addons: state.collection });
    log('Backup of your current addons downloaded.', 'ok');
    const config = await buildConfig();
    let step = log('Creating your Dublix profile…');
    state.profile = await createProfile(config, instanceBase(), (n) => step(`A source was slow to answer; trying again (${n}/2)…`, 'run'));
    step('Dublix profile created.');
    step = log('Checking the addons…');
    const streams = await descriptor(state.profile.manifestUrl);
    const subs = smartSubs() ? await descriptor(subsUrl()) : null;
    step('Addons respond.');
    step = log('Updating your Stremio account…');
    const fresh = await getCollection(state.authKey);
    if (JSON.stringify(fresh) !== JSON.stringify(state.collection)) throw new Error('Your addon list changed since the review. Review again before installing.');
    const { addons } = mergeCollection(fresh, { streams, subs, replaceOpenSubtitles: true });
    await setCollection(state.authKey, addons);
    const after = await getCollection(state.authKey);
    if (!after.some((a) => a.transportUrl === streams.transportUrl)) throw new Error('Stremio did not keep the new addon list. Your backup file can restore it.');
    step('Stremio account updated.');
    state.collection = after;
    $('#done').hidden = false;
  } catch (e) {
    log(e.message, 'err');
    $('#install-btn').disabled = false;
  }
});

$('#profile-btn').addEventListener('click', () => state.profile && download(`dublix-profile-${stamp()}.json`, state.profile));

let restoreAddons = null;
$('#restore-file').addEventListener('change', async () => {
  restoreAddons = null;
  $('#restore-btn').disabled = true;
  $('#restore-preview').replaceChildren();
  const file = $('#restore-file').files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!Array.isArray(backup.addons) || !backup.addons.length || !backup.addons.every((a) => a?.transportUrl && a?.manifest?.id)) {
      throw new Error('This is not a Dublix backup file.');
    }
    restoreAddons = backup.addons;
    // Show exactly what will be installed: a file from someone else could add any addon.
    const ul = document.createElement('ul');
    for (const a of restoreAddons) ul.append(listItem('keep', `${a.manifest.name ?? a.manifest.id} (${new URL(a.transportUrl).host})`));
    $('#restore-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: `Your account will have exactly these ${restoreAddons.length} addons:` }), ul);
    $('#restore-btn').disabled = false;
  } catch (e) {
    $('#restore-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'warn', textContent: e.message }));
  }
});
$('#restore-btn').addEventListener('click', async () => {
  if (!restoreAddons) return;
  $('#log').replaceChildren();
  try {
    const step = log('Restoring your addons…');
    // Always log in again: the form may now hold a different account than the last review.
    state.authKey = await authenticate();
    download(`stremio-addons-before-restore-${stamp()}.json`, { savedAt: new Date().toISOString(), addons: await getCollection(state.authKey) });
    await setCollection(state.authKey, restoreAddons);
    step(`Restored ${restoreAddons.length} addons. A copy of the list you had before was downloaded.`);
    resetReview();
  } catch (e) { log(e.message, 'err'); }
});

// Any edit after a review invalidates it.
$('#setup').addEventListener('input', (e) => { if (e.target.id !== 'restore-file') resetReview(); });

renderLanguages();
applyLanguage();
serviceRow('torbox');
tmdbWarn();
checkInstances();
