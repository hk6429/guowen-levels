import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { marked } from "marked";
import { buildIndex, annotateHtml, zhuyinViaUv } from "./build-index.mjs";
import { spawnSync } from "node:child_process";

const hasUv = spawnSync("uv", ["--version"]).status === 0;

function tmp() { return mkdtempSync(join(tmpdir(), "gl-")); }
function lesson(root, id, meta, files = []) {
  const d = join(root, id);
  mkdirSync(d, { recursive: true });
  if (meta !== undefined) writeFileSync(join(d, "meta.json"), typeof meta === "string" ? meta : JSON.stringify(meta));
  for (const f of files) {
    const [name, content] = Array.isArray(f) ? f : [f, "x"];
    mkdirSync(join(d, name, ".."), { recursive: true });
    writeFileSync(join(d, name), content);
  }
}
// 測試預設不產注音版（zhuyin: null），避免依賴 uv
const build = (r, opts = {}) => buildIndex(r, { zhuyin: null, ...opts });
// 假注音工具：每個字都回「ㄓ」
const fakeZhuyin = (texts) => texts.map((t) => Array.from(t).map((ch) => (/\p{Script=Han}/u.test(ch) ? "ㄓ" : null)));

test("完整課 → 五個 levels 欄位齊", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["textbook.pdf", "plain.md", "comic/02.jpg", "comic/01.png", "audio.mp3", "audio.md"]);
  const [e] = await build(r);
  assert.deepEqual(e.levels, {
    pdf: "textbook.pdf", plain: "plain.md",
    comic: ["comic/01.png", "comic/02.jpg"], audio: "audio.mp3", audioText: "audio.md",
  });
});

test("只有 plain.md → 僅 plain", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["plain.md"]);
  assert.deepEqual((await build(r))[0].levels, { plain: "plain.md" });
});

test("無 meta.json 資料夾被跳過", async () => {
  const r = tmp();
  lesson(r, "junk", undefined, ["plain.md"]);
  lesson(r, "L01-甲", { title: "甲" });
  assert.equal((await build(r)).length, 1);
});

test("壞 meta.json → 丟錯含資料夾名", async () => {
  const r = tmp();
  lesson(r, "L09-壞", "{not json");
  await assert.rejects(() => build(r), /L09-壞/);
});

test("order 排序，缺 order 排後面", async () => {
  const r = tmp();
  lesson(r, "L02-乙", { title: "乙", order: 2 });
  lesson(r, "L01-甲", { title: "甲", order: 5 });
  lesson(r, "L00-無", { title: "無" });
  assert.deepEqual((await build(r)).map((e) => e.id), ["L02-乙", "L01-甲", "L00-無"]);
});

test("comicCaptions 與 comic 等長，缺的補空字串", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["comic/01.webp", "comic/02.webp", "comic/03.webp", ["comic/02.md", "  蚊子變白鶴。\n"]]);
  const [e] = await build(r);
  assert.deepEqual(e.levels.comicCaptions, ["", "蚊子變白鶴。", ""]);
});

test("沒有任何 caption → 不出現 comicCaptions", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["comic/01.webp"]);
  assert.equal("comicCaptions" in (await build(r))[0].levels, false);
});

test("glossary / tasks / quiz / extend 偵測", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["glossary.json", "tasks.json", "quiz.json", "extend/寫作技巧.md", "extend/生物觀察.md", "extend/note.txt"]);
  const [e] = await build(r);
  assert.equal(e.glossary, "glossary.json");
  assert.equal(e.tasks, "tasks.json");
  assert.equal(e.quiz, "quiz.json");
  // 依檔名 localeCompare('zh-Hant') 排序
  const expected = ["寫作技巧", "生物觀察"].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  assert.deepEqual(e.extend, expected.map((t) => ({ title: t, file: `extend/${t}.md` })));
});

test("缺檔 → glossary / tasks / quiz / extend 全部省略", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, ["plain.md"]);
  const [e] = await build(r);
  for (const k of ["glossary", "tasks", "quiz", "extend"]) assert.equal(k in e, false);
});

test("注音工具不可用 → 警告、略過 ruby、不寫檔、build 不失敗", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, [["plain.md", "# 甲\n\n你好"]]);
  const [e] = await buildIndex(r, { zhuyin: () => null, marked });
  assert.equal("ruby" in e.levels, false);
  assert.equal(existsSync(join(r, "L01-甲", "plain.ruby.html")), false);
});

test("marked 缺席 → 略過 ruby", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, [["plain.md", "你好"]]);
  const [e] = await buildIndex(r, { zhuyin: fakeZhuyin, marked: null });
  assert.equal("ruby" in e.levels, false);
});

test("注音可用 → 產 plain.ruby.html 並標 levels.ruby", async () => {
  const r = tmp();
  lesson(r, "L01-甲", { title: "甲" }, [["plain.md", "## 第一段\n\n**原文**\n余憶，abc `代碼` 好。"]]);
  const [e] = await buildIndex(r, { zhuyin: fakeZhuyin, marked });
  assert.equal(e.levels.ruby, "plain.ruby.html");
  const html = readFileSync(join(r, "L01-甲", "plain.ruby.html"), "utf8");
  assert.match(html, /<h2>第?<ruby>第<rt>ㄓ<\/rt><\/ruby>/);
  assert.match(html, /<strong><ruby>原<rt>ㄓ<\/rt><\/ruby><ruby>文<rt>ㄓ<\/rt><\/ruby><\/strong>/);
  assert.match(html, /<code>代碼<\/code>/); // code 內不注音
  assert.match(html, /<\/ruby>，abc /); // 標點與英文原樣
});

test("annotateHtml：無漢字時原樣回傳、不呼叫注音工具", () => {
  let called = 0;
  const out = annotateHtml("<p>hello</p>", () => { called++; return null; });
  assert.equal(out, "<p>hello</p>");
  assert.equal(called, 0);
});

test("zhuyin.py 詞級覆寫：強／蝦／倒／稱／帳／數 依課本讀音", { skip: !hasUv && "需要 uv" }, () => {
  const [a, b, c] = zhuyinViaUv(["項為之強，癩蝦蟆", "拔山倒樹，怡然稱快，素帳，鞭數十", "的蚊鶴 ab強"]);
  assert.deepEqual(a, ["ㄒㄧㄤˋ", "ㄨㄟˋ", "ㄓ", "ㄐㄧㄤˋ", null, "ㄌㄞˋ", "ㄏㄚˊ", "ㄇㄚˊ"]);
  assert.equal(b[2], "ㄉㄠˇ"); assert.equal(b[7], "ㄔㄥ"); assert.equal(b[11], "ㄓㄤˋ"); assert.equal(b[14], "ㄕㄨˋ");
  assert.deepEqual(c, ["˙ㄉㄜ", "ㄨㄣˊ", "ㄏㄜˋ", null, null, null, "ㄑㄧㄤˊ"]); // 非覆寫詞的「強」維持逐字讀音
});
