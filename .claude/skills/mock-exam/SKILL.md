---
name: mock-exam
description: 產生國中（8–9 年級）各科模擬試題，存進 Google Drive，並給出可以直接作答的網頁連結；也用來讀作答紀錄做錯題分析、出補強卷。使用者輸入像「八上數學 2-1 乘法公式」「九上理化 電流的磁效應 25題 難一點」「宇翔最近數學錯什麼」「幫宇翔出錯題重練卷」時使用。
---

# 國中模擬試題產生器（雲端版）

## 這套東西怎麼跑

```
使用者在 Claude Code（雲端 session）輸入章節
        ↓
Claude 搜資料 → 出新題 → 寫成考卷 JSON
        ↓
上傳到 Google Drive：模擬試題/考卷/<科目>/
        ↓
更新 模擬試題/考卷索引.json
        ↓
回一個連結：<webAppUrl>?id=<考卷ID>&k=<代碼>
        ↓
孩子/學生用任何瀏覽器作答 → Apps Script 改分 → 成績寫進 模擬試題/作答紀錄
```

**不需要使用者的電腦**。全部靠 Google Drive 連接器 + 一支部署在使用者 Google 帳號下的 Apps Script（原始碼在 `mock-exam/apps-script/`，安裝方式見 `mock-exam/SETUP.md`）。

## 開工前先讀

1. `mock-exam/config.json` — 拿 `webAppUrl`（沒填代表還沒部署，見下面「尚未部署時」）、Drive 根資料夾 ID、預設值。
2. 需要的話用 `mcp__Google_Drive__search_files` 查 Drive。根資料夾 `模擬試題` 底下：
   - `_sources/<科目>/` — 之前搜集的 PDF、整理好的章節重點（PDF 就直接放在科目資料夾裡，
     不必再往下分層；各科底下那個空的 `raw/` 是舊結構，沒在用）
   - `考卷/<科目>/` — 考卷 JSON
   - `考卷索引.json` — 所有考卷的清單
   - `名單.json` — 誰能作答（代碼、姓名、分組）
   - `作答紀錄` — 成績試算表

## 出題流程

### 1. 解析需求

從使用者的一句話抓出：年級學期、科目、章節、題數、難度、指定給誰。沒說的用預設：

| 項目 | 預設 |
|---|---|
| 滿分 | 100 分 |
| 難度 | 段考中等 |
| 給誰 | 八年級 → 宇翔；九年級 → 宇安（`config.json` 的 `gradeOwner`） |
| 題型配比 | 選擇 60%、填充 20%、非選 20%（數理科）；語文科選擇多一點 |

### 2. 找素材

先看 `_sources/<科目>/` 有沒有這個章節的舊資料——**有就直接用，不要重搜**。

科目資料夾的對應要注意合科卷：

| 使用者說的科目 | 除了同名資料夾，還要看 |
|---|---|
| 歷史 / 地理 / 公民 | `_sources/社會/`（三科合印的段考卷，檔名多半寫「社會」） |
| 理化 | `_sources/理化/` 裡檔名寫「自然」的（八年級自然科就是理化） |
| 生物 / 地科 | 目前是空的（孩子在八年級，自然只考理化），要先上網搜 |

檔名裡的 `114-1-2` 是「學年度-學期-第幾次段考」，`8` 或「二年級」是八年級。
挑素材時優先用同一學期、同一次段考的卷子，範圍才會對得上。

沒有的話上網搜（WebSearch / WebFetch）：

- 各校段考卷 PDF：搜「<章節> 段考 試題 filetype:pdf」「<年級><科目> 第一次段考 <章節>」
- 教育部 / 教育雲 / 學習吧 的教材與練習題
- 會考歷屆試題（相關考點）
- 米蘭老師題庫 <https://melances.com/test-bank/>（自然科）
- 中小學題庫網 <https://www.tcool.cc/>

**已知限制：tcool.cc 的考卷抓不下來**（動態載入），只能當搜尋範圍之一。

搜到有用的東西就整理成一份 `<章節>-重點.md` 存進 `_sources/<科目>/`，下次直接用。

### 3. 出題

- **不照抄**。參考題型、難度、常見陷阱，重新出題。
- **每題的答案自己算過一遍**，特別是計算題。填充題的 `answer` 要把等價寫法都列進去（`6x` 和 `+6x`）。
- 錯誤選項要是「真的會錯的地方」（忘記乘 2、漏掉負號、平方差與完全平方混用）。
- `explain` 寫解題關鍵，不是只寫答案，並點出這題常見的錯法。
- 數學式用 `\\(` `\\)` 包起來（MathJax），換行用 `<br>`。
- 如果這個學生在同章節錯過題（見「錯題分析」），在錯過的觀念上多出 1–2 題。

### 4. 寫成考卷 JSON

檔名 `<YYYYMMDD>-<章節>.json`，格式：

```json
{
  "id": "20260919-math8a-multiplication-formulas",
  "title": "乘法公式練習卷",
  "grade": "八年級上學期",
  "subject": "數學",
  "chapter": "乘法公式",
  "note": "給宇翔｜建議作答 40 分鐘",
  "assign": ["宇翔"],
  "sources": [{ "name": "…", "url": "…" }],
  "sections": [
    {
      "type": "mc", "name": "選擇題", "points": 5,
      "questions": [
        { "q": "\\((x+3)^2\\) 展開後等於？", "options": ["…","…","…","…"], "answer": 2, "explain": "…" }
      ]
    },
    {
      "type": "fill", "name": "填充題", "points": 4,
      "questions": [{ "q": "…＿＿＿＿", "answer": ["6x", "+6x"], "explain": "…" }]
    },
    {
      "type": "open", "name": "非選擇題", "points": 10,
      "questions": [{ "q": "…", "answer": "參考答案（可用 <br>）", "explain": "配分說明" }]
    }
  ]
}
```

- `type` 只有 `mc`（選擇，`answer` 是選項索引 0–3）、`fill`（填充，`answer` 是可接受答案陣列）、`open`（非選，交卷後孩子自評）。
- `points` 是**每題**分數，滿分 = Σ(points × 題數)，湊到 100。
- `assign`：可填姓名或 `名單.json` 的 `group`。不寫 = 所有人都看得到，家教學生也會看到——**給孩子的卷子記得寫**。

### 5. 上傳 Drive

用 `mcp__Google_Drive__create_file`（`parentId` = `考卷/<科目>/` 資料夾 ID，`contentMimeType: "application/json"`，`disableConversionToGoogleType: true`）。科目資料夾不存在就先建一個（`mimeType: application/vnd.google-apps.folder`）。

**記下回傳的 file id**，下一步要用。

### 6. 更新考卷索引

讀 `考卷索引.json`，把新的一筆加進陣列：

```json
{
  "id": "20260919-math8a-multiplication-formulas",
  "date": "2026-09-19",
  "subject": "數學",
  "grade": "八上",
  "chapter": "乘法公式",
  "title": "乘法公式練習卷",
  "file": "考卷/數學/20260919-乘法公式.json",
  "fileId": "<create_file 回傳的 id>",
  "assign": ["宇翔"]
}
```

⚠️ **Drive 連接器不能覆寫既有檔案內容**（`update_file` 只改標題和位置）。更新索引的做法是：`create_file` 寫一份新的 `考卷索引.json` 到同一個資料夾 → `trash_file` 把舊的丟進垃圾桶。順序不要反，中間壞掉的話至少舊的還在。

索引壞掉也不會全毀：Apps Script 讀不到索引時會自己掃 `考卷/*/*.json`，只是就沒有 `assign` 和標題了。

### 7. 回覆使用者

給出：

- 作答連結 `<webAppUrl>?id=<考卷ID>&k=<代碼>`（代碼去 `名單.json` 對 `assign` 的人拿；要給多個人就一人一條）
- 題數配比與滿分
- 參考來源；**如果某個來源連結失效或抓不到，要講出來**，不要假裝有參考
- 哪幾題是針對他之前錯的觀念加強的

### 尚未部署時

`config.json` 的 `webAppUrl` 還是空的 → 照樣把考卷 JSON 出好、傳上 Drive、更新索引，然後告訴使用者：考卷已經在 Drive，但還沒辦法產生作答連結，要先照 `mock-exam/SETUP.md` 裝一次 Apps Script（約 10 分鐘），裝好把網址填進 `config.json`。**不要**因為還沒部署就不出題。

## 錯題分析 / 補強卷

使用者問「宇翔最近數學錯什麼」「幫宇翔出錯題重練卷」時：

1. `search_files` 找 `模擬試題/作答紀錄`，用 `read_file_content` 讀（是 Google 試算表，讀得到）。
2. 挑出該學生的列，看 `錯題` 和 `明細JSON`。
3. 給出：各卷分數與日期、重做前後的變化、弱點排行（哪個觀念錯最多次）。
4. 要出補強卷的話 → **針對錯過的觀念出新題，不是把原題再考一次**，然後照上面的流程走一遍，`note` 註明是補強卷。

## 不要做的事

- 不要把題目寫進網頁原始碼再給連結——答案會外流。考卷一律走 Drive JSON，讓 Apps Script 在伺服器端改分。
- 不要直接改 `mock-exam/apps-script/` 的程式而不提醒使用者：改完要去 Apps Script 編輯器重貼 + 重新部署（`SETUP.md` 第 6 節）才會生效。
- 改完 `Code.gs` 一定要跑 `node mock-exam/test/grade_test.js`。
