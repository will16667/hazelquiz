# HazelQuiz 雲端同步 — 部署（約 3 分鐘）

用管住 Drive 資料夾「HazelQuiz」嗰個 Google 帳戶：

1. 開 https://script.new ，專案改名 **HazelQuiz Sync**
2. 刪晒預設 `Code.gs` 內容，貼上本資料夾 `Code.gs` 全文，儲存（Ctrl/Cmd+S）
3. **Deploy → New deployment**
   - Type: **Web app**
   - Description: `hazelquiz-sync-v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy → 授權（第一次要允許 Drive）
4. 複製 **Web app URL**（以 `/exec` 結尾）
5. 手機開 https://will16667.github.io/hazelquiz/#/sync
   - 同步代號：例如 `hazel`（兩部機相同）
   - PIN：至少 4 位（兩部機相同）
   - 貼上 `/exec` 網址 → **儲存並同步**

成功後右上角會顯示「已同步」。生字／關卡進度／SRS 會寫入 Drive 資料夾入面嘅 `hazelquiz-sync-….json`。

唔好改 Open Readle 嘅 Apps Script。
