# HazelQuiz（溫書關卡）

獨立於 Open Readle 的護理 Life Sciences 溫書網。

## 流程
1. **讀全文** — Lecture 1 / 2 / 3（跟 PDF 分頁），點英文睇解釋／發音／存生字
2. **溫重點** — 21 關雙語筆記卡（全部開放，唔使測驗解鎖）
3. **生字／複習** — 閃卡 SRS（新增／再複習 1分／困難 10分／還可以 2天／簡單 4天）；答案含中文翻譯＋概念解釋；**共用雲端庫**（Will 的 Drive）

## 雲端同步（共用庫）
- 本機：`localStorage`（`hazelquiz-v1`）永遠保留作快取／離線
- 線上：Apps Script → Drive 檔 `hazelquiz-shared-bank.json`
- 朋友**唔使登 Google**；Will 部署一次後把 `/exec` 寫入 `config.js`
- 設定頁：`#/sync`（通常只須 Will 貼一次網址）
- 另備 JSON 匯出／匯入

見 `sync/DEPLOY.md`。

## 上架
GitHub Pages：`gh-pages/` → https://will16667.github.io/hazelquiz/
