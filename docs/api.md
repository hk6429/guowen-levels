# 匿名課堂數據 API（Cloudflare Pages Functions ＋ KV）

給差異化教學用的匿名統計後端。學生端只送事件（不登入、不記名，座號選填），老師端用金鑰看統計。
程式在 `functions/api/`，儀表板在 `teacher.html`（線上網址 `/teacher`，Pages 會把 `.html` 轉成 clean URL）。

## 端點

### `POST /api/event`
學生端送事件。接受 `application/json` 與 `text/plain`（`navigator.sendBeacon` 送的是 text/plain）。**不加 CORS header**，只給同源頁面用。

```json
{ "lesson": "L03-兒時記趣", "type": "level", "level": "pdf", "value": { "...": "..." }, "seat": "12" }
```

| 欄位 | 必填 | 規則 |
|---|---|---|
| `lesson` | 是 | 字串 ≤ 80 字 |
| `type` | 是 | `level` / `feedback` / `exit` / `pre` |
| `level` | 否 | 字串（`pdf`/`plain`/`easy`）或字串陣列（≤10 個，每個 ≤20 字）；陣列＝同一事件勾多個版本，每個版本各計一次 |
| `value` | 否 | 任意 JSON，序列化後 ≤ 2 KB |
| `seat` | 否 | 1–4 位數字字串（數字也收，會轉字串）；空字串視為沒填 |

各 `type` 的 `value` 約定（stats 依此統計）：

| type | value | 統計 |
|---|---|---|
| `level` | （用 `level` 欄位） | `counts.level.{pdf,plain,easy}` |
| `pre` | `{ "score": 0..3 }` 或直接數字 `0..3` | `counts.pre.score0..score3` |
| `exit` | `{ "correct": [bool, bool, bool], "score"?: number }` 或直接 `[bool,bool,bool]` | `submissions`、`perItem[i]`＝第 i 題答對人數、`avgScore`（沒給 score 就用答對題數） |
| `feedback` | `{ "kind": "done" }` 或 `{ "kind": "question", "text": "..." }` | `counts.feedback.{done,question}`；question 另列入 `questions[]`（text 截 500 字） |

回應：`204` 成功；`400` ＋ `{"error": "..."}` 代表輸入有問題（含壞 JSON，不會 500）；非 POST 回 `405`。

儲存：KV binding `DATA`，key `evt:<lesson>:<ISO ts>:<6 隨機字>`，value `{...欄位, ts, day}`（`day` 為台北日期 `YYYY-MM-DD`），metadata `{ts, day, type}`，TTL 90 天。

### `GET /api/stats`
老師端。`key` 必填，與 `TEACHER_KEY` 定時比較；`TEACHER_KEY` 沒設 → `503 {"error":"TEACHER_KEY not set"}`；錯／缺 → `401`。

- `?key=…`（無 lesson）→ 掃 `evt:` 前綴，只讀 key＋metadata：
  `{ "lessons": [ { "lesson", "events", "lastTs" } ] }`（依 lastTs 新到舊）
- `?key=…&lesson=<id>&day=<YYYY-MM-DD>`（day 預設台北今天）→
  ```json
  {
    "lesson": "L03-兒時記趣", "day": "2026-10-02",
    "counts": {
      "level": { "pdf": 1, "plain": 1, "easy": 2 },
      "feedback": { "done": 1, "question": 1 },
      "pre": { "score0": 1, "score1": 0, "score2": 1, "score3": 0 },
      "exit": { "submissions": 2, "perItem": [2, 1, 2], "avgScore": 2.5 }
    },
    "questions": [ { "ts": "…Z", "seat": "23", "text": "…" } ],
    "recent": [ "…最新 50 筆事件，新到舊" ]
  }
  ```
  `day` 格式錯 → `400`。KV `list` 最終一致，剛送的事件最多可能延遲約 60 秒才出現在統計。

### `GET /api/health`
`{ "ok": true }`。

## curl 範例（`TEACHER_KEY` 請換成你的金鑰；本機用 `http://127.0.0.1:8788`）

```bash
B=https://guowen-levels.pages.dev
# 選版本（字串／陣列）、前測、出場券、回饋
curl -X POST $B/api/event -H 'content-type: application/json' \
  -d '{"lesson":"L03-兒時記趣","type":"level","level":"pdf","seat":"12"}'
curl -X POST $B/api/event -H 'content-type: text/plain' \
  -d '{"lesson":"L03-兒時記趣","type":"level","level":["plain","easy"]}'
curl -X POST $B/api/event -d '{"lesson":"L03-兒時記趣","type":"pre","value":{"score":2}}'
curl -X POST $B/api/event -d '{"lesson":"L03-兒時記趣","type":"exit","value":{"correct":[true,false,true]},"seat":"5"}'
curl -X POST $B/api/event -d '{"lesson":"L03-兒時記趣","type":"feedback","value":{"kind":"question","text":"稚 怎麼念？"},"seat":"23"}'

curl $B/api/health
curl "$B/api/stats?key=TEACHER_KEY"                                   # 課程清單
curl "$B/api/stats?key=TEACHER_KEY&lesson=L03-兒時記趣"               # 今天
curl "$B/api/stats?key=TEACHER_KEY&lesson=L03-兒時記趣&day=2026-10-02"
```

## 本機開發

```bash
# 不要用 .dev.vars；金鑰直接用 --binding 給一個拋棄值。--persist-to 指到 repo 外，避免 KV 測試資料落在專案裡。
npx -y wrangler@3 pages dev . --kv DATA --binding TEACHER_KEY=devkey123 --port 8788 --persist-to /tmp/guowen-wr-state
```
`wrangler.toml` 有 `pages_build_output_dir`，`pages dev` 會讀到 KV binding；`--kv DATA` 保險再綁一次無妨。compatibility_date 比本機 runtime 新時會印警告並回退，不影響。

## 部署（只走 Cloudflare Pages，不用 Vercel）

```bash
npx -y wrangler@3 pages deploy . --project-name guowen-levels --branch main
```

- **只能用 wrangler 3**：wrangler 4 的 `pages project create` 會生成 Worker 專案而把事情搞壞。
- Functions 由 `functions/` 自動編譯成 `_worker.bundle` 一併上傳（`functions/api/_util.js` 底線開頭不成為路由）。
- **binding 如何生效**（已查 wrangler 3.114 原始碼確認）：`pages deploy` 讀到含 `pages_build_output_dir` 的 `wrangler.toml` 時，會把 `[[kv_namespaces]]` 等 binding 塞進上傳的 worker metadata，並附上 `wrangler_config_hash`；Pages 用這份 binding 設定該次部署的環境（`--branch` 等於專案的 production branch → production，否則 → preview，preview 用 `preview_id`）。**不需要在 dashboard 手點 binding**；之後 dashboard 的 Bindings 區會顯示「由 wrangler.toml 管理」而唯讀。
- 專案若還不存在，`pages deploy` 會互動詢問要不要建立並問 production branch（預設＝目前 git branch，請填 `main`）；非互動環境請先 `npx -y wrangler@3 pages project create guowen-levels --production-branch main`。
- 上傳會排除 `node_modules/`、`.git/`、`functions/`，但 **不會** 排除 `.wrangler/`、`docs/`，所以本機 dev 請用 `--persist-to` 指到 repo 外。
- 部署後鐵律：`curl` 回讀線上檔案比 md5，另 `curl $B/api/health` 應回 `{"ok":true}`，`curl "$B/api/stats?key=x"` 應回 401（若回 503 代表下一步還沒做）。

### 人工唯一一步：設定 `TEACHER_KEY`
secret 不進 toml、不進 git：
```bash
npx -y wrangler@3 pages secret put TEACHER_KEY --project-name guowen-levels
```
貼上自訂金鑰；設完 **再部署一次** 才會被新的部署吃到（Pages secret 綁在部署當下）。`teacher.html` 頁尾也有這段說明。

## KV namespace
| 用途 | title | id |
|---|---|---|
| production | `guowen-levels-DATA` | `43ffcebb050e4f789c18246ab2c47f03` |
| preview | `guowen-levels-DATA_preview` | `2b886f38a57e4ba58a917f6f43d66e97` |
