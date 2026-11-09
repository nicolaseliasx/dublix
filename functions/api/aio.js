// Cloudflare Pages Function: /api/aio — see packages/proxy/aio-proxy.mjs.
import { handleAio } from '../../packages/proxy/aio-proxy.mjs';

export const onRequest = ({ request }) => handleAio(request);
