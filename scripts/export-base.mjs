// Usage: <owner config JSON on stdin> | node scripts/export-base.mjs > packages/policy/base-config.json
// Accepts either a bare AIOStreams config or a state object with a `config` field.
import { sanitizeBase } from '../packages/policy/config.mjs';
import { applyNextPolicy } from '../packages/policy/policy.mjs';
let raw = '';
process.stdin.on('data', (d) => { raw += d; }).on('end', () => {
  const input = JSON.parse(raw);
  const base = sanitizeBase(input.config ?? input);
  // Ship the base without the owner's list rules; the builder re-applies them with the viewer's options.
  JSON.parse(JSON.stringify(applyNextPolicy(base, { anime: false, excludeServices: [] })));
  process.stdout.write(`${JSON.stringify(base, null, 2)}\n`);
});
