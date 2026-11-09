// Cloudflare Pages Function: /subs/* — the Filmhub Subs addon (stateless; the cache lives per isolate).
import { createHandler, httpJson, route } from '../../packages/subs/subs.mjs';

const handle = createHandler({ fetchJson: httpJson });

export async function onRequest({ request }) {
  const path = new URL(request.url).pathname.replace(/^\/subs/, '') || '/';
  const [status, body] = await route(path, handle);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': status === 200 ? 'public, max-age=3600' : 'no-store' },
  });
}
