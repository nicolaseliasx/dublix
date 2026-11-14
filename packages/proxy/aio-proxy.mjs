// Minimal CORS bridge for public AIOStreams instances, which send no CORS headers under /api/v1.
// It only creates a profile (POST /api/v1/user) or reads /api/v1/status on an allow-listed instance.
// Streams never pass through it. Nothing is logged or stored.
export const INSTANCES = [
  { host: 'aiostreamsfortheweebs.midnightignite.me', label: 'Midnight (For the Weebs)' },
  { host: 'aiostreams.fortheweak.cloud', label: 'For The Weak' },
  // aio.atbphosting.com runs 2.36 and has not been verified with the 2.37 base profile.
];
export const MAX_BODY = 512 * 1024;
const TIMEOUT = 20000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status, message) => json(status, { success: false, error: { code: 'DUBLIX_PROXY', message } });

export async function handleAio(request, { fetch = globalThis.fetch } = {}) {
  const params = new URL(request.url).searchParams;
  const instance = INSTANCES.find((i) => i.host === params.get('instance'));
  if (!instance) return fail(400, 'unknown instance');
  const op = params.get('op') ?? 'create';
  let init;
  if (request.method === 'GET' && op === 'status') {
    init = { method: 'GET' };
  } else if (request.method === 'POST' && op === 'create') {
    // JSON only: a cross-site form/text POST would skip the CORS preflight.
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return fail(415, 'body must be application/json');
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return fail(413, 'config too large');
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(413, 'config too large');
    let body;
    try { body = JSON.parse(text); } catch { return fail(400, 'body must be JSON'); }
    if (!body || typeof body.config !== 'object' || Array.isArray(body.config) || !body.config || typeof body.password !== 'string' || !body.password) {
      return fail(400, 'expected { config, password }');
    }
    init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: body.config, password: body.password }) };
  } else if (request.method === 'GET' || request.method === 'POST') {
    return fail(400, 'unknown operation');
  } else {
    return fail(405, 'method not allowed');
  }
  const path = op === 'status' ? '/api/v1/status' : '/api/v1/user';
  try {
    // Workers accept only 'follow' or 'manual'; a redirect is never followed to another host.
    const upstream = await fetch(`https://${instance.host}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    if (upstream.status >= 300 && upstream.status < 400) return fail(502, 'instance redirected');
    const text = await upstream.text();
    try { return json(upstream.status, JSON.parse(text)); } catch { return fail(502, 'instance returned a non-JSON reply'); }
  } catch {
    return fail(502, 'instance unreachable');
  }
}
