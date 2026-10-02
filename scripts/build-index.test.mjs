import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIndex } from "./build-index.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "gl-")); }
function lesson(root, id, meta, files = []) {
  const d = join(root, id);
  mkdirSync(d, { recursive: true });
  if (meta !== undefined) writeFileSync(join(d, "meta.json"), typeof meta === "string" ? meta : JSON.stringify(meta));
  for (const f of files) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), "x");
  }
}

test("完整課 → 五個 levels 欄位齊", () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["textbook.pdf", "plain.md", "comic/02.jpg", "comic/01.png", "audio.mp3", "audio.md"]);
  const [e] = buildIndex(r);
  assert.deepEqual(e.levels, {
    pdf: "textbook.pdf", plain: "plain.md",
    comic: ["comic/01.png", "comic/02.jpg"], audio: "audio.mp3", audioText: "audio.md",
  });
});

test("只有 plain.md → 僅 plain", () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["plain.md"]);
  assert.deepEqual(buildIndex(r)[0].levels, { plain: "plain.md" });
});

test("無 meta.json 資料夾被跳過", () => {
  const r = tmp();
  lesson(r, "junk", undefined, ["plain.md"]);
  lesson(r, "L01-甲", { title: "甲" });
  assert.equal(buildIndex(r).length, 1);
});

test("壞 meta.json → 丟錯含資料夾名", () => {
  const r = tmp();
  lesson(r, "L09-壞", "{not json");
  assert.throws(() => buildIndex(r), /L09-壞/);
});

test("order 排序，缺 order 排後面", () => {
  const r = tmp();
  lesson(r, "L02-乙", { title: "乙", order: 2 });
  lesson(r, "L01-甲", { title: "甲", order: 5 });
  lesson(r, "L00-無", { title: "無" });
  assert.deepEqual(buildIndex(r).map((e) => e.id), ["L02-乙", "L01-甲", "L00-無"]);
});
