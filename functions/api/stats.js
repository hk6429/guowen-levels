import { json, listAll, safeEqual, taipeiDay } from './_util.js';

const KEY_RE = /^evt:(.+):(\d{4}-\d{2}-\d{2}T[\d:.]+Z):[a-z0-9]{6}$/;

function parseKey(name) {
  const m = KEY_RE.exec(name);
  return m ? { lesson: m[1], ts: m[2] } : null;
}

function tiers(level) {
  const arr = Array.isArray(level) ? level : [level];
  return new Set(arr.filter((x) => typeof x === 'string'));
}

// 出場券 value：{ correct: boolean[3], score? } 或直接 boolean[]
function exitAnswers(value) {
  const arr = Array.isArray(value) ? value : value && Array.isArray(value.correct) ? value.correct : null;
  if (!arr) return null;
  const correct = [0, 1, 2].map((i) => arr[i] === true || arr[i] === 1);
  const score = value && typeof value.score === 'number' ? value.score : correct.filter(Boolean).length;
  return { correct, score };
}

function aggregate(events) {
  const counts = {
    level: { pdf: 0, plain: 0, easy: 0 },
    feedback: { done: 0, question: 0 },
    pre: { score0: 0, score1: 0, score2: 0, score3: 0 },
    exit: { submissions: 0, perItem: [0, 0, 0], avgScore: null },
  };
  const questions = [];
  let scoreSum = 0;

  for (const e of events) {
    switch (e.type) {
      case 'level':
        for (const t of tiers(e.level)) {
          if (t in counts.level) counts.level[t] += 1; else counts.level[t] = 1;
        }
        break;
      case 'feedback': {
        const kind = e.value && e.value.kind;
        if (kind === 'done') counts.feedback.done += 1;
        else if (kind === 'question') {
          counts.feedback.question += 1;
          questions.push({ ts: e.ts, seat: e.seat ?? null, text: String(e.value.text ?? '').slice(0, 500) });
        }
        break;
      }
      case 'pre': {
        const s = typeof e.value === 'number' ? e.value : e.value && e.value.score;
        if (Number.isInteger(s) && s >= 0 && s <= 3) counts.pre[`score${s}`] += 1;
        break;
      }
      case 'exit': {
        const a = exitAnswers(e.value);
        if (!a) break;
        counts.exit.submissions += 1;
        a.correct.forEach((ok, i) => { if (ok) counts.exit.perItem[i] += 1; });
        scoreSum += a.score;
        break;
      }
    }
  }
  if (counts.exit.submissions) counts.exit.avgScore = Math.round((scoreSum / counts.exit.submissions) * 100) / 100;
  return { counts, questions };
}

export async function onRequestGet({ request, env }) {
  if (!env.TEACHER_KEY) return json({ error: 'TEACHER_KEY not set' }, 503);
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!safeEqual(key, env.TEACHER_KEY)) return json({ error: 'unauthorized' }, 401);

  const lesson = url.searchParams.get('lesson');

  // 無 lesson：掃 evt: 列出課程摘要（只看 key／metadata，不讀 value）
  if (!lesson) {
    const map = new Map();
    for (const k of await listAll(env.DATA, 'evt:')) {
      const p = parseKey(k.name);
      if (!p) continue;
      const ts = (k.metadata && k.metadata.ts) || p.ts;
      const cur = map.get(p.lesson) || { lesson: p.lesson, events: 0, lastTs: '' };
      cur.events += 1;
      if (ts > cur.lastTs) cur.lastTs = ts;
      map.set(p.lesson, cur);
    }
    const lessons = [...map.values()].sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1));
    return json({ lessons });
  }

  const day = url.searchParams.get('day') || taipeiDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'bad day' }, 400);

  const keys = (await listAll(env.DATA, `evt:${lesson}:`)).filter((k) => {
    const d = (k.metadata && k.metadata.day) || (parseKey(k.name) && taipeiDay(new Date(parseKey(k.name).ts)));
    return d === day;
  });

  const events = [];
  for (let i = 0; i < keys.length; i += 50) {
    const batch = await Promise.all(keys.slice(i, i + 50).map((k) => env.DATA.get(k.name, 'json')));
    for (const e of batch) if (e && e.day === day) events.push(e);
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const { counts, questions } = aggregate(events);
  return json({ lesson, day, counts, questions, recent: events.slice(-50).reverse() });
}
