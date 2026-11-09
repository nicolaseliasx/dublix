// Local preview: serves dist/ and runs functions/ the way Cloudflare Pages does. Usage: node scripts/dev-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { onRequest as aio } from '../functions/api/aio.js';
import { onRequest as subs } from '../functions/subs/[[path]].js';
const dist = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const port = Number(process.argv[2] ?? 8788);
createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const fn = url.pathname === '/api/aio' ? aio : url.pathname.startsWith('/subs/') ? subs : null;
  if (fn) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => { let b = ''; req.on('data', (d) => { b += d; }).on('end', () => ok(b)); });
    const response = await fn({ request: new Request(url, { method: req.method, headers: req.headers, body }) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(Buffer.from(await response.arrayBuffer()));
  }
  const path = normalize(join(dist, url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname));
  if (!path.startsWith(dist)) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(path); res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Filmhub preview on http://127.0.0.1:${port}`));
