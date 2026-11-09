// Builds the static site for Cloudflare Pages into dist/ (functions/ is picked up by Pages from the repo root).
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const out = `${root}dist`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(`${root}site`, out, { recursive: true });
const lib = { policy: ['policy.mjs', 'config.mjs', 'languages.mjs', 'base-config.json'], stremio: ['collection.mjs'], proxy: ['aio-proxy.mjs'], subs: ['subs.mjs'] };
for (const [dir, files] of Object.entries(lib)) {
  mkdirSync(`${out}/lib/${dir}`, { recursive: true });
  for (const f of files) cpSync(`${root}packages/${dir}/${f}`, `${out}/lib/${dir}/${f}`);
}
writeFileSync(`${out}/_headers`, `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`);
console.log('built dist/');
