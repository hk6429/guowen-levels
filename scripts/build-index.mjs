import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const CJK = /\p{Script=Han}/u;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------- 注音（pypinyin via uv）----------

/** texts: string[] → (string|null)[][]（逐碼位注音，非漢字為 null）；工具不可用回傳 null。 */
export function zhuyinViaUv(texts) {
  const r = spawnSync("uv", ["run", "--with", "pypinyin", "python", join(SCRIPT_DIR, "zhuyin.py")], {
    input: texts.map((t) => JSON.stringify(t)).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    console.warn(`警告：注音工具不可用（${r.error?.message ?? (r.stderr || "").trim().split("\n").pop()}），略過注音版`);
    return null;
  }
  const lines = r.stdout.split("\n").filter(Boolean);
  if (lines.length !== texts.length) {
    console.warn("警告：注音輸出行數不符，略過注音版");
    return null;
  }
  return lines.map((l) => JSON.parse(l).map((z) => z || null));
}

/** 把 HTML 文字節點裡的漢字包成 <ruby>字<rt>注音</rt></ruby>；<code>/<pre> 內不處理。 */
export function annotateHtml(html, zhuyin) {
  const parts = html.split(/(<[^>]+>)/);
  const textIdx = [];
  let skip = 0;
  parts.forEach((p, i) => {
    if (p.startsWith("<")) {
      const m = /^<(\/?)(code|pre)\b/i.exec(p);
      if (m) skip = Math.max(0, skip + (m[1] ? -1 : 1));
      return;
    }
    if (!skip && CJK.test(p)) textIdx.push(i);
  });
  if (!textIdx.length) return html;
  const readings = zhuyin(textIdx.map((i) => parts[i]));
  if (!readings) return null;
  textIdx.forEach((i, k) => {
    const chars = Array.from(parts[i]);
    parts[i] = chars
      .map((ch, j) => (CJK.test(ch) && readings[k][j] ? `<ruby>${ch}<rt>${readings[k][j]}</rt></ruby>` : ch))
      .join("");
  });
  return parts.join("");
}

async function loadMarked() {
  try {
    return (await import("marked")).marked;
  } catch {
    console.warn("警告：找不到 marked 套件（請先 npm install），略過注音版");
    return null;
  }
}

/** 由 plain.md 產生 plain.ruby.html；成功回傳 true。 */
async function buildRuby(dir, zhuyin, marked) {
  if (!marked) return false;
  const md = readFileSync(join(dir, "plain.md"), "utf8");
  const html = annotateHtml(marked.parse(md), zhuyin);
  if (html == null) return false;
  writeFileSync(join(dir, "plain.ruby.html"), html);
  return true;
}

// ---------- 索引 ----------

export function scanLesson(dir) {
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const levels = {};
  if (existsSync(join(dir, "textbook.pdf"))) levels.pdf = "textbook.pdf";
  if (existsSync(join(dir, "plain.md"))) levels.plain = "plain.md";
  const comicDir = join(dir, "comic");
  if (existsSync(comicDir) && statSync(comicDir).isDirectory()) {
    const imgs = readdirSync(comicDir).filter((f) => IMG_EXT.test(f)).sort();
    if (imgs.length) {
      levels.comic = imgs.map((f) => `comic/${f}`);
      const captions = imgs.map((f) => {
        const md = join(comicDir, f.replace(IMG_EXT, ".md"));
        return existsSync(md) ? readFileSync(md, "utf8").trim() : "";
      });
      if (captions.some(Boolean)) levels.comicCaptions = captions;
    }
  }
  if (existsSync(join(dir, "audio.mp3"))) levels.audio = "audio.mp3";
  if (existsSync(join(dir, "audio.md"))) levels.audioText = "audio.md";
  const entry = { id: basename(dir), title: meta.title, levels };
  if (meta.unit) entry.unit = meta.unit;
  if (typeof meta.order === "number") entry.order = meta.order;
  for (const f of ["glossary", "tasks", "quiz"]) {
    if (existsSync(join(dir, `${f}.json`))) entry[f] = `${f}.json`;
  }
  const extDir = join(dir, "extend");
  if (existsSync(extDir) && statSync(extDir).isDirectory()) {
    const mds = readdirSync(extDir).filter((f) => f.endsWith(".md")).sort((a, b) => a.localeCompare(b, "zh-Hant"));
    if (mds.length) entry.extend = mds.map((f) => ({ title: f.slice(0, -3), file: `extend/${f}` }));
  }
  return entry;
}

/**
 * opts.zhuyin：(texts) => readings|null，預設走 uv＋pypinyin；傳 null 表示不產注音版。
 * opts.marked：marked 物件，預設動態載入。
 */
export async function buildIndex(lessonsDir, opts = {}) {
  const zhuyin = "zhuyin" in opts ? opts.zhuyin : zhuyinViaUv;
  const marked = "marked" in opts ? opts.marked : await loadMarked();
  const entries = [];
  for (const name of readdirSync(lessonsDir)) {
    const dir = join(lessonsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    let entry;
    try {
      entry = scanLesson(dir);
    } catch (e) {
      throw new Error(`${name}/meta.json 解析失敗：${e.message}`);
    }
    if (!entry) continue;
    if (entry.levels.plain && zhuyin && (await buildRuby(dir, zhuyin, marked))) {
      entry.levels.ruby = "plain.ruby.html";
    }
    entries.push(entry);
  }
  entries.sort((a, b) => {
    const ao = a.order ?? Infinity, bo = b.order ?? Infinity;
    return ao !== bo ? ao - bo : a.id.localeCompare(b.id, "zh-Hant");
  });
  return entries;
}

if (process.argv[1] && process.argv[1].endsWith("build-index.mjs")) {
  const lessonsDir = process.argv[2] ?? "lessons";
  try {
    const index = await buildIndex(lessonsDir);
    writeFileSync(join(lessonsDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
    console.log(`index.json：${index.length} 課`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
