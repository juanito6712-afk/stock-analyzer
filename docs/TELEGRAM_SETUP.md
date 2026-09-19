# Telegram 出題機器人 — 設定指南

讓孩子在 Telegram 傳一句「國二數學 一元二次方程式 出 5 題」，
約一分鐘後收到題目，寫完再收到解答。全程在雲端跑，不用開電腦。

---

## 運作方式

```
孩子的 Telegram
      │  (webhook，毫秒級)
      ▼
Cloudflare Worker ──── 秒回「收到！正在出題中」
      │  (repository_dispatch)
      ▼
GitHub Actions ──── Claude Code CLI 出題
      │
      ▼
孩子的 Telegram ──── 題目，接著解答
```

**為什麼不是全部在 Worker 裡做完？**
Claude Pro/Max 訂閱產生的 OAuth token，官方只支援給 Claude Code CLI 使用。
把它當成一般 API key 塞進 Worker 是未公開的用法，隨時可能失效。
所以 Worker 只負責「把關 + 秒回」，出題交給 GitHub Actions 跑官方 CLI。

**為什麼不能直接用 Claude Code 雲端 session？**
雲端 session 是臨時容器，閒置就被回收，沒辦法 24 小時掛著等訊息。

---

## 你需要準備的東西

| 項目 | 哪裡拿 | 費用 |
|------|--------|------|
| Telegram bot token | Telegram 裡找 [@BotFather](https://t.me/BotFather) | 免費 |
| Claude OAuth token | 桌面版終端機跑 `claude setup-token` | 含在你的訂閱內 |
| GitHub PAT | GitHub 設定頁 | 免費 |
| Cloudflare 帳號 | [dash.cloudflare.com](https://dash.cloudflare.com) | 免費額度每天 10 萬次請求 |

---

## 步驟一：建立 Telegram bot

1. 在 Telegram 搜尋 `@BotFather`，傳 `/newbot`
2. 依指示取名字和帳號（帳號要以 `bot` 結尾，例如 `my_tutor_bot`）
3. 它會給你一串 token，長得像 `7123456789:AAE...`，**先存起來**

順便設定選單（可略過）：傳 `/setcommands` 給 BotFather，選你的 bot，然後貼上：

```
help - 使用說明
id - 查自己的 Telegram ID
```

---

## 步驟二：產生 Claude OAuth token

在你**桌面電腦**的終端機執行：

```bash
claude setup-token
```

跟著瀏覽器完成授權，會拿到一串 token，**先存起來**。

> 這串 token 會過期，失效時重跑一次這個指令、更新 GitHub secret 即可。

---

## 步驟三：設定 GitHub

到 `https://github.com/juanito6712-afk/stock-analyzer/settings`

**Secrets and variables → Actions → Secrets 分頁**，按 `New repository secret` 加兩個：

| 名稱 | 值 |
|------|-----|
| `TELEGRAM_BOT_TOKEN` | 步驟一拿到的 token |
| `CLAUDE_CODE_OAUTH_TOKEN` | 步驟二拿到的 token |

**Variables 分頁**，按 `New repository variable` 加一個：

| 名稱 | 值 |
|------|-----|
| `ALLOWED_CHAT_IDS` | 先填你自己的 Telegram ID，晚一點再加女兒的 |

> 還不知道自己的 ID？先隨便填 `0`，等步驟六部署完，對 bot 傳 `/id` 就會告訴你。

---

## 步驟四：建立 GitHub PAT（給 Worker 用）

Worker 需要權限去觸發 GitHub Actions。

1. 到 [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. **Repository access** → Only select repositories → 選 `stock-analyzer`
3. **Permissions** → Repository permissions → **Contents** 設為 **Read and write**
   （`repository_dispatch` 需要這個權限）
4. 產生後把 token 存起來

---

## 步驟五：部署 Cloudflare Worker

註冊 [Cloudflare](https://dash.cloudflare.com) 免費帳號後，在這個 repo 的資料夾裡：

```bash
cd worker
npm install
npx wrangler login          # 會開瀏覽器授權
```

**先編輯 `worker/wrangler.toml`**，把 `ALLOWED_CHAT_IDS` 填成你的 Telegram ID：

```toml
[vars]
ALLOWED_CHAT_IDS = "你的ID"
GITHUB_REPO = "juanito6712-afk/stock-analyzer"
```

接著設定三組機密（每個指令都會問你要貼什麼值）：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN        # 步驟一的 token
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # 自己想一組亂碼，等下還要用
npx wrangler secret put GITHUB_TOKEN              # 步驟四的 PAT
```

> `TELEGRAM_WEBHOOK_SECRET` 自己隨便想一組長一點的英數字即可，例如
> `openssl rand -hex 24` 產生的那種。只要步驟六填一樣就行。

部署：

```bash
npx wrangler deploy
```

成功後會印出網址，像 `https://telegram-tutor.你的帳號.workers.dev`，**存起來**。

---

## 步驟六：把 Telegram 接到 Worker

回到 repo 根目錄：

```bash
export TELEGRAM_BOT_TOKEN='步驟一的token'
export TELEGRAM_WEBHOOK_SECRET='步驟五自己想的那組亂碼'
./scripts/set_telegram_webhook.sh https://telegram-tutor.你的帳號.workers.dev
```

看到 `"ok":true` 就成功了。

---

## 步驟七：加入女兒的 ID

1. 請女兒在 Telegram 搜尋你的 bot，傳 `/id`
2. Bot 會回覆她的 ID（她還沒被授權，但 `/id` 一定回得了）
3. 把她的 ID 加到**兩個地方**（兩道關卡都要過）：

   **① `worker/wrangler.toml`：**
   ```toml
   ALLOWED_CHAT_IDS = "你的ID,女兒的ID"
   ```
   然後重新部署：`cd worker && npx wrangler deploy`

   **② GitHub repository variable `ALLOWED_CHAT_IDS`：**
   改成 `你的ID,女兒的ID`

> 為什麼要設兩次？Worker 那層擋掉大部分亂打的人；GitHub 那層是保險——
> 萬一 PAT 外流，別人也沒辦法叫這個 bot 傳訊息給任意帳號。

---

## 步驟八：測試

請女兒傳一句：

```
國二數學 一元二次方程式 出 5 題
```

預期流程：
1. 幾秒內收到「收到！正在出題中，大約 1 分鐘後給你 ✏️」
2. 約 40～90 秒後收到題目
3. 緊接著收到「📝 解答（寫完再看喔）」

---

## 疑難排解

**完全沒有反應**

```bash
./scripts/set_telegram_webhook.sh --info
```
看 `last_error_message`。同時開另一個視窗看 Worker 即時日誌：
```bash
cd worker && npx wrangler tail
```

**收到「收到！正在出題中」但題目一直沒來**

去 GitHub 的 Actions 分頁看 `Telegram Tutor Bot` 這個 workflow：
- 沒有任何執行紀錄 → PAT 權限不對（要 Contents: Read and write）
- 卡在 `Verify chat id is allowed` → GitHub variable `ALLOWED_CHAT_IDS` 沒加到那個 ID
- 卡在 `Generate questions` → `CLAUDE_CODE_OAUTH_TOKEN` 過期了，重跑 `claude setup-token`

**收到「這個機器人只開放給指定的人使用」**

`worker/wrangler.toml` 的 `ALLOWED_CHAT_IDS` 沒加到那個 ID，
或改完忘了重新 `npx wrangler deploy`。

**想手動測出題，不透過 Telegram**

GitHub Actions 分頁 → `Telegram Tutor Bot` → `Run workflow`，
填入 chat id 和題目需求即可。

---

## 安全性說明

- Worker 驗證 `X-Telegram-Bot-Api-Secret-Token`，擋掉冒充 Telegram 的請求
- 白名單有兩層（Worker + GitHub Actions），任一層沒過就不執行
- 使用者文字**只透過環境變數和 shell 變數傳遞**，不會被內插進指令，
  所以傳什麼奇怪的字元都不會被當成指令執行
- Claude 在空目錄執行，且停用了 Bash / Write / Edit / WebFetch 等工具，
  看不到也改不到這個 repo 的任何檔案
- 超過 5 分鐘的舊訊息會被忽略，避免 Telegram 重送造成重複出題
- 單則訊息上限 1000 字

## 費用

- Cloudflare Workers：免費額度每天 10 萬次請求，這個用量完全用不完
- GitHub Actions：這是 public repo，Actions 分鐘數免費且無上限
- Claude：走你的訂閱額度，不另外計費
