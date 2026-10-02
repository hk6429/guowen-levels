import { json, randomId, taipeiDay } from './_util.js';

const TYPES = new Set(['level', 'feedback', 'exit', 'pre']);
const TTL = 90 * 24 * 3600;
const MAX_VALUE_BYTES = 2048;

function bad(msg) {
  return json({ error: msg }, 400);
}

function isTier(x) {
  return typeof x === 'string' && x.length > 0 && x.length <= 20;
}

export async function onRequestPost({ request, env }) {
  // sendBeacon 送 text/plain，所以一律用 text() 再自己 parse
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return bad('invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('body must be an object');

  const { lesson, type, level, value, seat } = body;
  if (typeof lesson !== 'string' || !lesson.trim() || lesson.length > 80) return bad('lesson required (<=80 chars)');
  if (!TYPES.has(type)) return bad('type must be level|feedback|exit|pre');

  const evt = { lesson, type };

  if (level !== undefined) {
    const ok = isTier(level) || (Array.isArray(level) && level.length <= 10 && level.every(isTier));
    if (!ok) return bad('level must be a string or string[]');
    evt.level = level;
  }
  if (value !== undefined) {
    let s;
    try { s = JSON.stringify(value); } catch { return bad('value not serialisable'); }
    if (s === undefined || new TextEncoder().encode(s).length > MAX_VALUE_BYTES) return bad('value too large (<=2KB)');
    evt.value = value;
  }
  if (seat !== undefined && seat !== null && seat !== '') {
    const s = typeof seat === 'number' ? String(seat) : seat;
    if (typeof s !== 'string' || !/^\d{1,4}$/.test(s)) return bad('seat must be 1-4 digits');
    evt.seat = s;
  }

  const now = new Date();
  const ts = now.toISOString();
  const day = taipeiDay(now);
  const key = `evt:${lesson}:${ts}:${randomId(6)}`;
  await env.DATA.put(key, JSON.stringify({ ...evt, ts, day }), {
    expirationTtl: TTL,
    metadata: { ts, day, type },
  });
  return new Response(null, { status: 204 });
}

// 其他方法一律 405（避免落到靜態站的 SPA fallback）
export function onRequest(ctx) {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
