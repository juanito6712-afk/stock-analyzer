# Taiwan Stock Smart Pool Analyzer

台股智能選股池產生器 + Telegram 家教出題機器人，兩個都跑在雲端，不用保持電腦開機。

## 一、台股選股池分析

- ✅ 每個台股營業日早上自動執行
- ✅ 抓取台股最新行情、籌碼、技術指標等數據
- ✅ 自動生成 CSV 報告並上傳到 Google Drive
- ✅ 完全免費，無需保持電腦常開
- ✅ 基於 GitHub Actions 和 Google Cloud 整合

流程：

1. GitHub Actions 按照 cron 排程觸發
2. Python 腳本執行股票分析
3. 生成 CSV 報告
4. 自動上傳結果到 Google Drive 指定資料夾

相關檔案：`smart_pool_analyzer.py`、`.github/workflows/stock-analyzer.yml`

## 二、Telegram 家教出題機器人

孩子在 Telegram 傳一句「國二數學 一元二次方程式 出 5 題」，
約一分鐘後收到題目，寫完再收到解答。

```
孩子的 Telegram → Cloudflare Worker（秒回＋白名單把關）
                      ↓
                 GitHub Actions → Claude Code CLI 出題
                      ↓
                 孩子的 Telegram（題目 → 解答）
```

**設定方式請看 [`docs/TELEGRAM_SETUP.md`](docs/TELEGRAM_SETUP.md)。**

相關檔案：

| 檔案 | 用途 |
|------|------|
| `worker/src/index.js` | Cloudflare Worker，Telegram webhook 入口 |
| `.github/workflows/telegram-tutor.yml` | 跑 Claude Code CLI 出題 |
| `scripts/send_telegram.py` | 把題目和解答分兩則傳回 Telegram |
| `scripts/set_telegram_webhook.sh` | 設定 / 查詢 / 取消 Telegram webhook |
