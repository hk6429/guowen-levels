import { json } from './_util.js';

export function onRequestGet() {
  return json({ ok: true });
}
