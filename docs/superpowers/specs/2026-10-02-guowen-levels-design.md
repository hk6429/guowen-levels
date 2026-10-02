# guowen-levels 設計規格

日期：2026-10-02
狀態：待使用者審閱

## 1. 目的

課堂同步使用的國文分層教材站。老師講課時，學生用平板開同一課，自選三種版本之一閱讀：

| 按鈕名稱 | 內容 | 對應程度 |
|---|---|---|
| 挑戰版 | 課本 PDF | 最好 |
| 白話版 | 白話文（Markdown） | 中等 |
| 輕鬆版 | 漫畫圖 ＋ 語音朗讀 ＋ 解說文字 | 最弱 |

介面不出現「程度弱」等標籤。學生不登入、不收任何名單。

## 2. 範圍

### 第一期（本 spec）
- 靜態網站：課程列表、課程頁、三層切換。
- 老師以「新增資料夾 ＋ 檔案 ＋ git push」方式上架教材。
- 自動產生課程索引。
- 雙平台部署：Cloudflare Pages ＋ Netlify。**不推 Vercel。**

### 第二期（不在本 spec，僅記錄決定）
- 對話功能：只回答本課問題，LLM 用 Gemini 免費額度，透過 Pages Function 代理。
- 老師網頁上傳後台：單一密碼（環境變數）。

## 3. 技術選擇

- 純靜態：HTML ＋ CSS ＋ 原生 JS。無框架、無打包工具。
- Markdown 轉 HTML：`marked`（CDN，cdnjs）。
- 索引腳本：Node 18+，`scripts/build-index.mjs`，無第三方依賴。
- 程式碼本尊在 `~/projects/guowen-levels`（git）。iCloud 不放。
- 教材檔直接進 git。單檔上限受 Cloudflare Pages 限制（25 MB）。

## 4. 目錄結構

```
guowen-levels/
  index.html              # 課程列表
  lesson.html             # 課程頁（?id=L03-兒時記趣）
  assets/
    style.css
    app.js
  lessons/
    index.json            # 由腳本產生，不手改
    L03-兒時記趣/
      meta.json
      textbook.pdf        # 挑戰版（選用）
      plain.md            # 白話版（選用）
      comic/              # 輕鬆版圖片（選用）
        01.jpg
        02.jpg
      audio.mp3           # 輕鬆版朗讀（選用）
      audio.md            # 輕鬆版解說文字（選用）
  scripts/
    build-index.mjs
    build-index.test.mjs
  robots.txt
  netlify.toml
  package.json
  README.md
```

## 5. 資料格式

### meta.json（老師手寫）
```json
{ "title": "兒時記趣", "unit": "第三課", "order": 3 }
```
- `title` 必填。`unit`、`order` 選填；`order` 決定列表排序，缺則依資料夾名。

### lessons/index.json（腳本產生）
```json
[
  {
    "id": "L03-兒時記趣",
    "title": "兒時記趣",
    "unit": "第三課",
    "order": 3,
    "levels": {
      "pdf": "textbook.pdf",
      "plain": "plain.md",
      "comic": ["comic/01.jpg", "comic/02.jpg"],
      "audio": "audio.mp3",
      "audioText": "audio.md"
    }
  }
]
```
- 檔案不存在的欄位省略。`comic` 依檔名排序，只收 jpg/jpeg/png/webp。
- 資料夾名即 `id`，直接用於網址參數。

## 6. 索引腳本行為

`node scripts/build-index.mjs`
1. 掃 `lessons/*/`，跳過沒有 `meta.json` 的資料夾。
2. `meta.json` 解析失敗 → 印錯誤含資料夾名，exit 1。
3. 依上述規則偵測各層檔案。
4. 依 `order`（數字）再資料夾名排序。
5. 寫 `lessons/index.json`。

## 7. 學生端行為

### 課程列表 `index.html`
- fetch `lessons/index.json`，列出課程卡片（unit ＋ title），點入 `lesson.html?id=…`。
- 空列表顯示「尚未上架課程」。

### 課程頁 `lesson.html`
- 讀 `id`，從 index.json 找課；找不到顯示「找不到這一課」＋回首頁連結。
- 頂部：課名 ＋ 三個大按鈕。某層無任何檔案則該按鈕不渲染。
- 內容區依層級：
  - 挑戰版：`<iframe src="…/textbook.pdf">`。
  - 白話版：fetch plain.md → marked → 注入。
  - 輕鬆版：由上而下 ＝ 漫畫圖直式堆疊 → `<audio controls>` → audio.md 轉 HTML。有哪個放哪個。
- 選過的層級存 `localStorage['guowen-levels:level']`，下次進任何課沿用；若該課無此層，退回第一個可用層。
- 平板直式優先：按鈕一排三個、字級 ≥ 18px、內容區滿寬。

### 錯誤處理
- fetch 失敗：內容區顯示「載入失敗，請重新整理」。不丟 console 以外的例外。

## 8. 部署

- **Cloudflare Pages**：build command `node scripts/build-index.mjs`，output `/`。
- **Netlify**：`netlify.toml` 同樣 build command，publish `.`。
- 部署後驗證（鐵律）：`curl` 回讀線上 `lessons/index.json` 與本機比 md5。
- `robots.txt`：`Disallow: /`。另在兩頁加 `<meta name="robots" content="noindex">`。
- 連結只給課堂，不公開。接受「有連結即可下載 PDF」風險。

## 9. 老師操作流程（README 內容）

1. 在 `lessons/` 新增資料夾，命名 `L編號-課名`。
2. 放 `meta.json` 與任意層級檔案。
3. `git add -A && git commit -m "新增 L03" && git push`。
4. 等兩平台部署完，開網址確認。

## 10. 測試

- `scripts/build-index.test.mjs`（node:test）：
  - 完整課 → 五個 levels 欄位齊。
  - 只有 plain.md → 僅 `plain`。
  - 無 meta.json 資料夾被跳過。
  - 壞 meta.json → exit 1。
  - `order` 排序正確。
- UI：iPad Safari 手動過一輪（三層切換、記憶層級、缺層按鈕隱藏）。

## 11. 不做的事

- 登入、名單、進度追蹤。
- 任何 AI 生成內容。
- 老師網頁上傳。
- 多科目設定。

## 12. 開放問題

無。

## 13. 視覺風格（2026-10-02 追加）

- 國風潑墨：宣紙底色＋ SVG feTurbulence 紙紋，角落潑墨 SVG（`assets/splash.svg`），標題下墨筆底線，右上硃砂印「竹光」。
- 字體 Noto Serif TC。強調色：硃砂紅（挑戰版）、靛藍（白話版）、竹綠（輕鬆版）。
- Q 版角色四張（首頁書生、三個版本各一），頭身比 1:1，codex-image2 生成，去背後存 `assets/img/*.webp`（512px）。
