# Taiwan Stock Smart Pool Analyzer

台股智能選股池產生器 - 使用 GitHub Actions 實現自動化每日執行

## 功能

- ✅ 每個台股營業日早上 9:00 自動執行
- - ✅ 抓取台股最新行情、籌碼、技術指標等數據
  - - ✅ 自動生成 CSV 報告並上傳到 Google Drive
    - - ✅ 完全免費，無需保持電腦常開
      - - ✅ 基於 GitHub Actions 和 Google Cloud 整合
       
        - ## 自動化流程
       
        - 1. GitHub Actions 按照 cron 排程觸發
          2. 2. Python 腳本執行股票分析
             3. 3. 生成 CSV 報告
                4. 4. 自動上傳結果到 Google Drive 指定資料夾
