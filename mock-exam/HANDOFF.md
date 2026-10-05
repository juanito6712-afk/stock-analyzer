# 模擬試題系統 — 搬到 Cowork 的交接文件

> 目的：把「每日自動出模擬卷」搬到 Claude Cowork，不再用綁定長對話的雲端排程（那種排程每次觸發都會把整段超長對話重新讀一遍，是額外費用的主因）。

## 1. 系統全貌

```
聯絡簿 Google Doc ──► Claude（skill: mock-exam）──► 考卷 JSON 存進 Drive「模擬試題/考卷/<科目>/」
                                                     │
                       更新「考卷索引.json」◄─────────┘
                                                     ▼
孩子點連結 ──► Apps Script 網頁（Code.gs + index.html，部署在家長的 Google 帳號下）
               讀索引→顯示考卷→伺服器改分→成績寫進試算表「作答紀錄」
                                                     │
每日 16:00 排程 ──► 出題 ──► Gmail 寄連結給宇翔 ──► 回報家長（含臉書貼文用文字）
```

不需要搬的（已經在 Google 上跑，與 Claude 無關）：Apps Script 網頁、Drive 上的考卷與題庫、作答紀錄試算表。
需要搬的：**出題的 skill、工具腳本、每日排程的提示詞**。

## 2. 檔案清單（都在這個 repo 的 `claude/mock-exam-generator-4o9107` 分支）

| 路徑 | 用途 |
|---|---|
| `.claude/skills/mock-exam/SKILL.md` | **核心 skill**：出題流程、JSON 格式、課本版本、難度與圖表比例、題庫位置、驗證規則、每日聯絡簿流程 |
| `mock-exam/config.json` | 網頁網址、Drive 根資料夾 ID、預設難度（35/45/20）、時間、聯絡簿 ID |
| `mock-exam/tools/figures.py` | 圖表產生器（折線、直條、雨溫圖、圓餅、數線、紙帶、電路、受力圖） |
| `mock-exam/tools/render_check.js` | 把含圖的題目截圖檢查（需要 Playwright + Chromium） |
| `mock-exam/test/validate_exam.js` | 上傳前驗證（JSON 語法、答案索引、總分 100、難度比例） |
| `mock-exam/test/grade_test.js`、`ui_test.js` | 改分與網頁介面的自動測試 |
| `mock-exam/apps-script/Code.gs`、`index.html` | 作答網頁（已部署，改動才需要重貼＋重新部署） |
| `mock-exam/apps-script/Importer.gs` | 一次性：把米蘭老師九年級題庫複製進 Drive（已跑完，214 檔） |
| `mock-exam/SETUP.md` | 網頁最初的設定步驟、名單格式（`名單.json`） |

## 3. 在 Cowork 重建的步驟

1. **取得檔案**：下載這個 repo 的分支（或直接用附上的 zip），解壓後放進 Cowork 的專案資料夾；把 `.claude/skills/mock-exam/` 放進 Cowork 能讀的 skills 位置（資料夾名稱要是 `mock-exam`，裡面是 `SKILL.md`）。
2. **連接器**：Cowork 需要連上同一個 Google 帳號的 **Google Drive**（讀寫）與 **Gmail**（寄信）。沒有 GitHub 也行（檔案已在本機）。
3. **執行環境**：需要 Node.js（跑 `validate_exam.js`）；要畫圖的話還要 Python 3 與 Playwright/Chromium（`render_check.js`）；改編 PDF 題庫需要 `pip install pymupdf`；數學題用 `pip install sympy` 重算答案。
4. **建立每日排程**：在 Cowork 建一個「週一到週五 16:00（台灣時間）」的排程，**每次都開新對話**（不要綁在同一個長對話），提示詞用下一節整段貼上。
5. **先手動跑一次**確認：能讀到聯絡簿、能寫入 Drive、Gmail 寄得出去，再開啟排程。
6. 搬好、確認正常後，**回到舊的雲端排程把它停用**（見第 6 節）。

## 4. 每日排程提示詞（整段貼進 Cowork 的排程）

```
【每日排程：宇翔隔天考試模擬卷】現在是台灣時間下午 4 點，請執行出題流程（需要 Google Drive 連接器、Gmail 連接器、mock-exam skill 與 repo 檔案）：

1. 呼叫 skill「mock-exam」，依 SKILL.md 的「每日聯絡簿自動出題」流程做；設定在 mock-exam/config.json。
2. 讀宇翔聯絡簿 Google Doc（ID：1KxRVO2JdjhkdmRHtftTsrr6psH30KLWHHUU9-vYAgL0，用 Google Drive 的 read_file_content）。
3. 找出「今天日期」那一格右欄「考試」裡以「明」開頭的項目＝隔天要考的科目與範圍。若一項都沒有，就只回報「宇翔明天沒有考試」，不出題、不寄信、不產生貼文。若聯絡簿還沒更新今天，用最近一筆並說明。
4. 每科各出一份模擬卷。課本版本：數學南一、國文康軒、英文康軒、自然/理化南一、社會(史地公)翰林。難度中等35／中上45／素養20，每題標 level。盡量以雲端硬碟 模擬試題/_sources 內各校現有題目改編（先對照 _sources/課程進度.md 確認進度相符；九年級題庫見 _sources/九年級/_索引.json；八年級各校段考卷在 _sources/113學年度8年級段考試題、114學年度8年級段考試題；sources 欄寫明改編自哪份卷子；答案與解析要自己重驗），沒有對得上的才上網搜、再不行才自己依課綱出並在 note 說明。作答時間依範圍：小考小卷(≥12題)20分、大單元25-30分、段考40-45分，寫進 note。題數依範圍抓、最多50。含圖表題占 15–30%（依科目，用 mock-exam/tools/figures.py，上傳前用 render_check.js 看圖）。語文科若查不到康軒實際課文/單字，要在 note 標明是推估。英單(2000單)範圍以家長提供的字表為準（見 SKILL.md）。英聽無法出音檔，註明不出。
5. 上傳前一定跑 node mock-exam/test/validate_exam.js 檢查，題數與滿分以腳本輸出為準。存到 Drive 模擬試題(1N8WleB2LtThXUY4579YiNs9CWv0D5SyA)/考卷/<科目>/，更新 考卷索引.json（新增條目、create_file 寫新檔、trash_file 丟「舊檔」id，注意不要丟到剛建的新檔），assign 一律 ["宇翔"]。
6. 寄信給宇翔：用 Gmail 寄一封信到 jarek1020329@gmail.com（只寄給這個地址，不要 cc 其他人），主旨「【明天考試練習】<日期> 模擬卷」，內容：明天考哪幾科、每科一個作答連結（https://script.google.com/macros/s/AKfycbwq5OoCImMnWjjmLOzpp0M_sjvwxYxZVrNQrggjwHlmA0JGHePW-Pzn5OpNU49V3EWQ_Q/exec?id=<考卷ID>&k=yx-2026 ）、每份題數與建議時間，語氣簡短鼓勵。純文字信即可。信中只放宇翔自己的卷子連結，不放答案。若寄信失敗，在回報中說明，不要重試超過一次。
7. 回報（給家長），分兩段：
 (A) 出題結果：今天日期、明天考哪幾科、每科作答連結、每份題數、參考來源（含改編自哪份各校卷）、哪科只能推估、信件是否寄出。
 (B) 「臉書社團貼文用文字」：一則可直接複製貼上的繁體中文貼文，內容為：日期＋「明天考試練習」標題；每科一行（科目、範圍、題數、建議作答時間、難度分布、圖表題幾題）；一兩句鼓勵或學習小提醒（不要貼出答案）；結尾提醒「作答連結另行提供」。貼文文字不得包含任何作答連結中的登入代碼（k=...）、答案與解析。連結不放進貼文；如家長要分享，另附一行不含代碼的連結（…/exec?id=<考卷ID>），並提醒：任何拿到網址的人都能在登入頁點「宇翔」進入，分享前請考慮。
```

## 5. 重要 ID 與位置

| 項目 | 值 |
|---|---|
| 作答網頁網址 | `https://script.google.com/macros/s/AKfycbwq5OoCImMnWjjmLOzpp0M_sjvwxYxZVrNQrggjwHlmA0JGHePW-Pzn5OpNU49V3EWQ_Q/exec` |
| Apps Script 專案「模擬試題」 | `1ATpI_11jcai03tn3FjP8L1QjcPgEw8OFaJ0qZDN5ZRd2WOCXXLVgiwdH` |
| Drive 根資料夾「模擬試題」 | `1N8WleB2LtThXUY4579YiNs9CWv0D5SyA` |
| 考卷資料夾 `考卷/` | `17A4PM60zwyVz7EskreQezLqDV0Ad3R8K`（子資料夾：數學、地理、國文、英文、理化、社會） |
| 題庫與資料 `_sources/` | `1Nev7cB8saVBswwYZ_H37F4V1jAFPaOZi`（含 `課程進度.md`、九年級題庫 `九年級/_索引.json`） |
| 網頁備份 `_app/` | `1xxEaI_dYYIi2-yfkABU9IiWMWHKp_3ap`（`最新版-Code.gs.txt`、`最新版-index.html.txt`、`Importer-v3.gs.txt`） |
| 名單 `名單.json` | `1d87X1kupc144XV5_6LBR86FJ9FK0WTYl` |
| 作答紀錄試算表 | `13ddUyp0QLeb6GA1AnYtUw8s3elrIqdWXUT7Qmq-gNIc` |
| 聯絡簿 Google Doc | `1KxRVO2JdjhkdmRHtftTsrr6psH30KLWHHUU9-vYAgL0` |
| 與你共用的題庫 | `九上社會`、`校用大卷`（擁有者 liaok5802@gmail.com，用 `sharedWithMe = true` 搜尋） |

## 6. 目前雲端排程（要停用的那個）

- 名稱：宇翔隔天考試模擬卷（週一至五 16:00，跑本對話）
- trigger id：`trig_015uzJh4W6dT8U4fvnaiaVcj`，綁定對話 `session_01V3wS5JMwwu4b2rYuaB8izY`
- 在 claude.ai 的排程（Routines）頁面可以暫停或刪除；或請 Claude 用 `update_trigger(enabled=false)` 停用。
- **為什麼會一直產生額外費用**：它是「綁定同一個對話」的排程，這個對話已經累積非常長（含大量 PDF 與程式碼），每次觸發都要重新處理整段上下文。在 Cowork 改成「每次新對話、只載入 skill」，每次的用量會小很多。

## 7. 已知限制

- 英聽、需要音檔的題型無法出。
- 課本實際內文取不到時（國文／英文），題目依教學目標推估，`note` 會標明。
- 作答網頁的「點名字登入」沒有密碼：任何拿到網址的人都能點「宇翔／宇安」。要公開分享連結前請先決定是否關閉點選登入（`名單.json` 設 `"pick": false`）。
- 臉書沒有連接器，只產生貼文文字，不會自動發文。
- Cowork 若沒有 Node／Python 環境，圖表檢查與驗證腳本要改在其他地方跑，或請它手動檢查 JSON。
