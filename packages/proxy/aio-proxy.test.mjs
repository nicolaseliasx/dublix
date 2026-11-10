import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAio, INSTANCES, MAX_BODY } from './aio-proxy.mjs';

const host = INSTANCES[0].host;
const url = (q) => `https://dublix.example/api/aio?${new URLSearchParams(q)}`;
const recorder = (status = 201, body = { success: true, data: { uuid: 'u', encryptedPassword: 'p' } }) => {
  const calls = [];
  const fetch = async (target, init = {}) => { calls.push({ target: String(target), init }); return new Response(JSON.stringify(body), { status }); };
  return { calls, fetch };
};
const post = (q, body, headers = {}) => new Request(url(q), { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

test('creates a profile only on an allowed instance, forwarding config and password as-is', async () => {
  const r = recorder();
  const res = await handleAio(post({ instance: host }, JSON.stringify({ config: { a: 1 }, password: 'pw' })), { fetch: r.fetch });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { success: true, data: { uuid: 'u', encryptedPassword: 'p' } });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].target, `https://${host}/api/v1/user`);
  assert.equal(r.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(r.calls[0].init.body), { config: { a: 1 }, password: 'pw' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('relays upstream errors (e.g. invalid config) with their status', async () => {
  const r = recorder(400, { success: false, error: { code: 'USER_INVALID_CONFIG', message: 'bad' } });
  const res = await handleAio(post({ instance: host }, JSON.stringify({ config: {}, password: 'pw' })), { fetch: r.fetch });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'USER_INVALID_CONFIG');
});

test('reads instance status with GET', async () => {
  const r = recorder(200, { success: true, data: { version: '2.37.0' } });
  const res = await handleAio(new Request(url({ instance: host, op: 'status' })), { fetch: r.fetch });
  assert.equal(res.status, 200);
  assert.equal(r.calls[0].target, `https://${host}/api/v1/status`);
});

test('refuses unknown instances, other methods, bad bodies and oversized bodies without calling upstream', async () => {
  const r = recorder();
  const cases = [
    [post({ instance: 'evil.example' }, '{"config":{},"password":"x"}'), 400],
    [post({ instance: `${host}.evil.example` }, '{"config":{},"password":"x"}'), 400],
    [post({}, '{"config":{},"password":"x"}'), 400],
    [new Request(url({ instance: host }), { method: 'PUT', body: '{}' }), 405],
    [new Request(url({ instance: host, op: 'other' })), 400],
    [post({ instance: host }, 'not json'), 400],
    [post({ instance: host }, JSON.stringify({ config: {} })), 400],
    [post({ instance: host }, JSON.stringify({ config: [], password: 'x' })), 400],
    [post({ instance: host }, JSON.stringify({ config: {}, password: 'x', pad: 'x'.repeat(MAX_BODY) })), 413],
  ];
  for (const [req, status] of cases) assert.equal((await handleAio(req, { fetch: r.fetch })).status, status, `${req.method} ${req.url}`);
  assert.equal(r.calls.length, 0);
});

test('never follows redirects (Workers only accept follow/manual) and refuses a 3xx reply', async () => {
  const calls = [];
  const fetch = async (target, init) => { calls.push(init); return new Response('', { status: 302, headers: { location: 'http://10.0.0.1/' } }); };
  const res = await handleAio(post({ instance: host }, JSON.stringify({ config: {}, password: 'x' })), { fetch });
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(res.status, 502);
});

test('only instances verified with the current base profile are offered', () => {
  assert.deepEqual(INSTANCES.map((i) => i.host), ['aiostreamsfortheweebs.midnightignite.me', 'aiostreams.fortheweak.cloud']);
});

test('POST must be JSON (forces a CORS preflight from other sites) and a declared oversized body is refused unread', async () => {
  const r = recorder();
  const plain = new Request(url({ instance: host }), { method: 'POST', body: JSON.stringify({ config: {}, password: 'x' }), headers: { 'content-type': 'text/plain' } });
  assert.equal((await handleAio(plain, { fetch: r.fetch })).status, 415);
  let read = false;
  const huge = { method: 'POST', url: url({ instance: host }), headers: new Headers({ 'content-type': 'application/json', 'content-length': String(MAX_BODY + 1) }), text: async () => { read = true; return '{}'; } };
  assert.equal((await handleAio(huge, { fetch: r.fetch })).status, 413);
  assert.equal(read, false);
  assert.equal(r.calls.length, 0);
});

test('upstream failure becomes a 502 without leaking details', async () => {
  const fetch = async () => { throw new Error('connect ECONNREFUSED 10.0.0.1'); };
  const res = await handleAio(post({ instance: host }, JSON.stringify({ config: {}, password: 'x' })), { fetch });
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /ECONNREFUSED|10\.0\.0\.1/);
});
