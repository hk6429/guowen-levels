# guowen-levels 國文分層教材站

課堂同步用的靜態網站。學生選一課，再選「挑戰版（課本 PDF）／白話版／輕鬆版（漫畫＋朗讀）」。不登入、不收名單。視覺採國風潑墨＋Q 版角色。

## 老師上架教材

1. 在 `lessons/` 新增資料夾，命名 `L編號-課名`，例如 `L03-兒時記趣`。
2. 放 `meta.json`：
   ```json
   { "title": "兒時記趣", "unit": "第三課", "order": 3 }
   ```
3. 放任意層級檔案（缺哪個，該按鈕就不出現）：

   | 檔名 | 版本 |
   |---|---|
   | `textbook.pdf` | 挑戰版 |
   | `plain.md` | 白話版（Markdown） |
   | `comic/01.jpg …` | 輕鬆版 漫畫（jpg/png/webp，依檔名排序） |
   | `audio.mp3` | 輕鬆版 朗讀 |
   | `audio.md` | 輕鬆版 解說文字 |

4. `git add -A && git commit -m "新增 L03" && git push`，兩平台自動部署。

單檔上限 25 MB（Cloudflare Pages 限制）。

## 本機

```bash
npm test      # 索引腳本測試
npm run dev   # 產索引並在 http://localhost:5173 預覽
```

## 部署

Cloudflare Pages 與 Netlify：build command `node scripts/build-index.mjs`，輸出目錄 `/`。不使用 Vercel。部署後以 `curl` 回讀 `lessons/index.json` 比對 md5。

網站 `robots.txt` 全站 noindex；連結只在課堂內提供。

## 第 1.5 期功能（2026-10-02）

- **閱讀設定**（右下角）：字級／行距／黑體／純白底／安靜模式／關動畫／朗讀速度；每段「🔊 朗讀」用瀏覽器 TTS。
- **版本疊加**：原文版／白話版／輕鬆版可同時開；白話版有 精簡／標準／滿版（注音＋詞語解釋）與「一次一段」。
- **老師鎖定網址**：`lesson.html?id=…&level=easy,plain&task=basic&mode=step&scaffold=full`。
- **每課可加的檔案**：`comic/NN.md`（逐格說明）、`glossary.json`、`tasks.json`（三層＋九宮格）、`quiz.json`（前測／出場券）、`extend/*.md`。格式見 `docs/superpowers/specs/` 與 `scripts/build-index.mjs`。
- **注音版**：build 時用 `uv run --with pypinyin` 產 `plain.ruby.html`；破音字在 `scripts/zhuyin.py` 的 `OVERRIDES` 加。
- **匿名統計**：`/api/event` 收 版本選擇／前測／出場券／回饋；老師看 `/teacher`（需 `TEACHER_KEY`，見 `docs/api.md`）。
- 家長說明：`/parents`。
