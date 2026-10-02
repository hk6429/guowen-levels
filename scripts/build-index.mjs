import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const IMG_EXT = /\.(jpe?g|png|webp)$/i;

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
    if (imgs.length) levels.comic = imgs.map((f) => `comic/${f}`);
  }
  if (existsSync(join(dir, "audio.mp3"))) levels.audio = "audio.mp3";
  if (existsSync(join(dir, "audio.md"))) levels.audioText = "audio.md";
  const entry = { id: basename(dir), title: meta.title, levels };
  if (meta.unit) entry.unit = meta.unit;
  if (typeof meta.order === "number") entry.order = meta.order;
  return entry;
}

export function buildIndex(lessonsDir) {
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
    if (entry) entries.push(entry);
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
    const index = buildIndex(lessonsDir);
    writeFileSync(join(lessonsDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
    console.log(`index.json：${index.length} 課`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
