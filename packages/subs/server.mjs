#!/usr/bin/env node
// Node server for the self-host kit. Same routes as functions/subs on Cloudflare (/manifest.json is pt-BR; /<language>/... the others).
import { createServer } from 'node:http';
import { createHandler, httpJson, route } from './subs.mjs';

const handle = createHandler({ fetchJson: httpJson });
const port = Number(process.env.PORT ?? 18310);
const host = process.env.HOST ?? '127.0.0.1';
createServer(async (req, res) => {
  const [status, body] = await route(new URL(req.url, 'http://localhost').pathname, handle);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}).listen(port, host, () => console.log(`Dublix Subs on ${host}:${port}`));
