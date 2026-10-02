// 共用小工具（底線開頭的檔案不會變成路由）
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000; // 台灣無日光節約

export function taipeiDay(date = new Date()) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function randomId(len = 6) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// 定時比較：長度不同也走完整圈，避免 timing leak
export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// 列出所有符合 prefix 的 key（處理 cursor 分頁）
export async function listAll(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}
