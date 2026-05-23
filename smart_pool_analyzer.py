# -*- coding: utf-8 -*-
"""
smart_pool_v3.0_ultimate_fixed.py
==================
台股智能選股池產生器 v3.0（對接規格書 v3.6fix）
修復與升級：
  1. 新增「跌停標記」欄位。
  2. 外資持股表 (MI_QFIIS) 導入隨機 User-Agent 輪替，強化反爬蟲抵抗力。
  3. 建立「市值(億)」雙重備援機制，當 TWSE 阻擋導致無法取得發行股數時，自動啟用 yfinance 補足市值數據。
"""

import os
import time
import requests
import warnings
import random
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")

FINMIND_TOKEN = os.environ.get(
    "FINMIND_TOKEN",
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoianVhbml0bzY3MTIiLCJlbWFpbCI6Imp1YW5pdG82NzEyQGdtYWlsLmNvbSJ9.N50WZ2liOR3xRDHE3UK08eLqvMtohAvYGdE2i-KrK5k"
)

STATUS = {
    "宏觀指標":    "❓",
    "大盤狀態":    "❓",
    "行情":       "❓",
    "PE_PB_殖利率": "❓",
    "池子容量":    "❓",
    "法人來源":    "❓",
    "RVOL來源":   "❓",
    "技術指標":    "❓",
    "注意處置股":   "❓",
    "外資5日累計":  "❓",
    "投信5日累計":  "❓",
    "外資持股&市值": "❓",
    "財務快照":    "❓"
}

# ═══════════════════════════════════════════════
#  Phase 0: 宏觀環境與大盤狀態
# ═══════════════════════════════════════════════
def get_macro() -> dict:
    print("[0.1/8] 抓取宏觀環境指標 (S&P500/Nasdaq/VIX/WTI/匯率)...")
    macro = {}
    tickers = {"^GSPC": "S&P500", "^NDX": "Nasdaq", "^VIX": "VIX", "CL=F": "WTI原油", "TWD=X": "USD_TWD"}
    try:
        import yfinance as yf
        yf_data = yf.download(list(tickers.keys()), period="5d", progress=False)["Close"]
        for tk, name in tickers.items():
            if tk in yf_data.columns:
                s = yf_data[tk].dropna()
                if len(s) >= 2:
                    if tk in ["^VIX", "TWD=X", "CL=F"]:
                        macro[f"宏觀_{name}_最新"] = round(float(s.iloc[-1]), 2)
                    else:
                        macro[f"宏觀_{name}_漲跌幅%"] = round((float(s.iloc[-1]) / float(s.iloc[-2]) - 1) * 100, 2)
        STATUS["宏觀指標"] = "✅ yfinance"
    except Exception:
        STATUS["宏觀指標"] = "⚠️ 失敗"
    return macro

def get_twii_status() -> dict:
    print("[0.2/8] 抓取加權指數 (TWII) 狀態...")
    status = {"大盤_MA20斜率": "平", "大盤_破年線": False, "大盤_創新高": False}
    try:
        import yfinance as yf
        twii = yf.download("^TWII", period="1y", progress=False)["Close"].dropna()
        if len(twii) > 240:
            last_close = float(twii.iloc[-1])
            ma20_now = float(twii.tail(20).mean())
            ma20_prev = float(twii.iloc[-21:-1].mean())
            ma240 = float(twii.tail(240).mean())
            high_240 = float(twii.tail(240).max())

            status["大盤_MA20斜率"] = "上" if ma20_now > ma20_prev else "下"
            status["大盤_破年線"] = last_close < ma240
            status["大盤_創新高"] = last_close >= (high_240 * 0.99)
        STATUS["大盤狀態"] = "✅ yfinance"
    except Exception:
        STATUS["大盤狀態"] = "⚠️ 失敗"
    return status

# ═══════════════════════════════════════════════
#  Phase 1: 基礎報價與估值
# ═══════════════════════════════════════════════
def get_twse_quote() -> pd.DataFrame:
    print("[1/8] 抓取 TWSE 當日行情...")
    r = requests.get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    df = pd.DataFrame(r.json())
    for c in ["TradeVolume", "TradeValue", "OpeningPrice", "HighestPrice", "LowestPrice", "ClosingPrice", "Change"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["成交量_張"]   = df["TradeVolume"] / 1000
    df["成交金額_億"] = df["TradeValue"] / 1e8
    df["前收盤"]      = df["ClosingPrice"] - df["Change"]
    df["漲跌幅%"]     = np.where(df["前收盤"] != 0, df["Change"] / df["前收盤"] * 100, 0)
    df["漲停標記"]    = df["漲跌幅%"] >= 9.5
    df["跌停標記"]    = df["漲跌幅%"] <= -9.5  # ★ 新增跌停標記
    STATUS["行情"] = "✅ TWSE"
    return df

def get_pe_pb_div() -> pd.DataFrame:
    print("[1.5/8] 抓取本益比/淨值比/殖利率...")
    try:
        r = requests.get("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", timeout=20)
        df = pd.DataFrame(r.json())
        df["本益比"] = pd.to_numeric(df.get("PEratio", np.nan), errors="coerce")
        df["股價淨值比"] = pd.to_numeric(df.get("PBratio", np.nan), errors="coerce")
        df["殖利率%"] = pd.to_numeric(df.get("DividendYield", np.nan), errors="coerce")
        STATUS["PE_PB_殖利率"] = "✅ TWSE BWIBBU_ALL"
        return df[["Code", "本益比", "股價淨值比", "殖利率%"]]
    except:
        STATUS["PE_PB_殖利率"] = "⚠️ 失敗"
        return pd.DataFrame(columns=["Code", "本益比", "股價淨值比", "殖利率%"])

# ═══════════════════════════════════════════════
#  Phase 2: 法人籌碼與 RVOL 初篩
# ═══════════════════════════════════════════════
def get_institution() -> pd.DataFrame:
    print("[2/8] 抓取三大法人買賣超 (當日)...")
    try:
        r = requests.get("https://www.twse.com.tw/rwd/zh/fund/T86", params={"response": "json", "selectType": "ALL"}, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        payload = r.json()
        fields = payload["fields"]
        raw = pd.DataFrame(payload["data"], columns=fields).rename(columns={"證券代號": "Code"})
        def clean_num(s): return pd.to_numeric(str(s).replace(",", "").strip(), errors="coerce")
        raw["外資買賣超"]   = raw[fields[4]].apply(clean_num)
        raw["投信買賣超"]   = raw[fields[10]].apply(clean_num)
        raw["自營商買賣超"] = raw[fields[11]].apply(clean_num)
        raw["三大法人合計"] = raw[fields[18]].apply(clean_num)
        for col in ["外資買賣超", "投信買賣超", "自營商買賣超", "三大法人合計"]:
            raw[col] = (raw[col] / 1000).round(0).fillna(0).astype(int)
        STATUS["法人來源"] = "✅ TWSE T86"
        return raw[["Code", "外資買賣超", "投信買賣超", "自營商買賣超", "三大法人合計"]]
    except:
        STATUS["法人來源"] = "⚠️ 失敗"
        return pd.DataFrame(columns=["Code", "外資買賣超", "投信買賣超", "自營商買賣超", "三大法人合計"])

def get_rvol(codes: list, df_quote: pd.DataFrame) -> dict:
    try:
        import yfinance as yf
        tickers = [f"{c}.TW" for c in codes]
        yf_data = yf.download(tickers, period="2mo", threads=True, progress=False)
        ma20_dict = {}
        if isinstance(yf_data.columns, pd.MultiIndex) and "Volume" in yf_data.columns.get_level_values(0):
            ma20_dict = (yf_data["Volume"].tail(20).mean() / 1000).to_dict()
        elif "Volume" in yf_data.columns:
            ma20_dict = {tickers[0]: yf_data["Volume"].tail(20).mean().item() / 1000}

        result = {}
        for code in codes:
            ma20 = ma20_dict.get(f"{code}.TW", np.nan)
            if pd.isna(ma20) or ma20 <= 0:
                result[code] = 0.0
            else:
                vol = df_quote.loc[df_quote["Code"] == code, "成交量_張"]
                result[code] = round(float(vol.iloc[0]) / ma20, 2) if not vol.empty else 0.0
        STATUS["RVOL來源"] = "✅ yfinance"
        return result
    except:
        STATUS["RVOL來源"] = "⚠️ 備援模擬"
        vol_s = df_quote.set_index("Code")["成交量_張"]
        max_v = vol_s.loc[vol_s.index.intersection(codes)].max()
        return {code: round(1.0 + (vol_s.get(code, 0)/max_v)*2.0, 2) if max_v > 0 else 1.2 for code in codes}

# ═══════════════════════════════════════════════
#  Phase 3: 聚合 45 檔深度資料
# ═══════════════════════════════════════════════
def get_technicals(codes: list) -> pd.DataFrame:
    print(f"[3/8] 抓取進階技術指標 ({len(codes)} 檔)…")
    cols = ["MA5", "MA10", "MA20", "MA60", "MA240", "乖離MA20%", "60日漲幅%", "RSI14", "MACD柱", "KD_K", "KD_D"]
    try:
        import yfinance as yf
        tickers = [f"{c}.TW" for c in codes]
        yf_data = yf.download(tickers, period="1y", threads=True, progress=False)

        close_df = yf_data["Close"] if isinstance(yf_data.columns, pd.MultiIndex) else yf_data[["Close"]].rename(columns={"Close": tickers[0]})
        high_df = yf_data["High"] if isinstance(yf_data.columns, pd.MultiIndex) else yf_data[["High"]].rename(columns={"High": tickers[0]})
        low_df = yf_data["Low"] if isinstance(yf_data.columns, pd.MultiIndex) else yf_data[["Low"]].rename(columns={"Low": tickers[0]})

        rows = []
        for code in codes:
            tk = f"{code}.TW"
            if tk not in close_df.columns:
                rows.append({"Code": code, **{c: np.nan for c in cols}})
                continue

            s_c = close_df[tk].dropna()
            s_h = high_df[tk].dropna()
            s_l = low_df[tk].dropna()
            if len(s_c) < 60:
                rows.append({"Code": code, **{c: np.nan for c in cols}})
                continue

            last = float(s_c.iloc[-1])
            ma5, ma10, ma20, ma60 = [float(s_c.tail(n).mean()) for n in [5, 10, 20, 60]]
            ma240 = float(s_c.tail(240).mean()) if len(s_c) >= 240 else np.nan
            bias = round((last - ma20) / ma20 * 100, 1) if ma20 else np.nan
            d60  = round((last / s_c.iloc[-61] - 1) * 100, 1) if len(s_c) >= 61 else np.nan

            delta = s_c.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, np.nan)
            rsi = float(100 - (100 / (1 + rs)).iloc[-1])

            ema12 = s_c.ewm(span=12, adjust=False).mean()
            ema26 = s_c.ewm(span=26, adjust=False).mean()
            macd = ema12 - ema26
            signal = macd.ewm(span=9, adjust=False).mean()
            macd_hist = float((macd - signal).iloc[-1])

            rsv9 = (s_c - s_l.rolling(9).min()) / (s_h.rolling(9).max() - s_l.rolling(9).min()) * 100
            k_val = rsv9.ewm(com=2, adjust=False).mean()
            d_val = k_val.ewm(com=2, adjust=False).mean()

            rows.append({
                "Code": code, "MA5": round(ma5,2), "MA10": round(ma10,2), "MA20": round(ma20,2),
                "MA60": round(ma60,2), "MA240": round(ma240,2) if pd.notna(ma240) else np.nan,
                "乖離MA20%": bias, "60日漲幅%": d60, "RSI14": round(rsi, 1),
                "MACD柱": round(macd_hist, 2), "KD_K": round(float(k_val.iloc[-1]), 1), "KD_D": round(float(d_val.iloc[-1]), 1)
            })
        STATUS["技術指標"] = "✅ yfinance (含 MACD/KD/年線)"
        return pd.DataFrame(rows)
    except:
        STATUS["技術指標"] = "⚠️ 失敗"
        return pd.DataFrame([{"Code": c, **{col: np.nan for col in cols}} for c in codes])


def get_attention_disposition() -> tuple:
    print("[4/8] 抓取注意股 / 處置股狀態…")
    attention_codes, disposition = set(), {}
    try:
        r = requests.get("https://openapi.twse.com.tw/v1/announcement/notice", timeout=10)
        if r.ok:
            df_att = pd.DataFrame(r.json())
            if "Code" in df_att.columns: attention_codes = set(df_att["Code"].astype(str).tolist())
        r2 = requests.get("https://www.twse.com.tw/rwd/zh/announcement/punish?response=json", timeout=10)
        if r2.ok:
            df_disp = pd.DataFrame(r2.json().get("data", []), columns=r2.json().get("fields", []))
            code_col = next((c for c in df_disp.columns if "代號" in c or "Code" in c), None)
            date_col = next((c for c in df_disp.columns if "迄" in c), None)
            if code_col:
                for _, row in df_disp.iterrows(): disposition[str(row[code_col]).strip()] = str(row[date_col]).strip() if date_col else "未知"
    except: pass
    STATUS["注意處置股"] = "✅ TWSE" if attention_codes or disposition else "⚠️ 不可用"
    return attention_codes, disposition

def get_institution_5d(codes: list) -> pd.DataFrame:
    print("[5/8] 透過 TWSE 抓取外資/投信近 5 日累計...")
    result_dict = {code: {"外資5日": 0.0, "投信5日": 0.0} for code in codes}
    valid_days = 0
    current_date = datetime.now()
    if current_date.hour < 15: current_date -= timedelta(days=1)

    for _ in range(15):
        if valid_days >= 5: break
        date_str = current_date.strftime("%Y%m%d")
        try:
            r = requests.get(f"https://www.twse.com.tw/rwd/zh/fund/T86?date={date_str}&response=json&selectType=ALL", headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            payload = r.json()
            if payload.get("stat") == "OK" and payload.get("data"):
                fields = payload["fields"]
                df = pd.DataFrame(payload["data"], columns=fields)
                c_idx = next(i for i, c in enumerate(fields) if "代號" in c)
                f_idx = next(i for i, c in enumerate(fields) if "外陸資買賣超" in c or "外資買賣超" in c)
                t_idx = next(i for i, c in enumerate(fields) if "投信買賣超" in c)

                df_filtered = df[df.iloc[:, c_idx].isin(codes)]
                for _, row in df_filtered.iterrows():
                    code = str(row.iloc[c_idx]).strip()
                    net_f = pd.to_numeric(str(row.iloc[f_idx]).replace(",", ""), errors="coerce")
                    net_t = pd.to_numeric(str(row.iloc[t_idx]).replace(",", ""), errors="coerce")
                    if pd.notna(net_f): result_dict[code]["外資5日"] += (net_f / 1000)
                    if pd.notna(net_t): result_dict[code]["投信5日"] += (net_t / 1000)
                valid_days += 1
            time.sleep(1.5)
        except: time.sleep(0.5)
        current_date -= timedelta(days=1)

    res_rows = []
    for k, v in result_dict.items():
        res_rows.append({"Code": k, "外資5日累計買賣超": int(round(v["外資5日"],0)), "投信5日累計買賣超": int(round(v["投信5日"],0))})

    STATUS["外資5日累計"] = f"✅ TWSE ({valid_days}天)"
    STATUS["投信5日累計"] = f"✅ TWSE ({valid_days}天)"
    return pd.DataFrame(res_rows)

# ═══════════════════════════════════════════════
#  Phase 4: 新增與修復的關鍵模組 (持股/發行量備援機制/財報)
# ═══════════════════════════════════════════════
def get_shareholding_and_market_cap(codes: list) -> dict:
    """★ 升級版：導入動態 UA 輪替，並建立 YFinance 備援市值機制"""
    print(f"[6/8] 抓取外資持股比率並精算市值 (TWSE MI_QFIIS + 備援，共 {len(codes)} 檔)...")
    
    uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0"
    ]

    def fetch_twse_qfiis(days_ago):
        curr = datetime.now() - timedelta(days=days_ago)
        if curr.hour < 15 and days_ago == 0: curr -= timedelta(days=1)

        for _ in range(12): # 放寬往回找尋的交易天數
            date_str = curr.strftime("%Y%m%d")
            try:
                r = requests.get(
                    f"https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date={date_str}&response=json&selectType=ALL",
                    headers={"User-Agent": random.choice(uas)}, timeout=15
                )
                data = r.json()
                if data.get("stat") == "OK" and data.get("data"):
                    fields = data["fields"]
                    df = pd.DataFrame(data["data"], columns=fields)
                    c_idx = next((i for i, c in enumerate(fields) if "代號" in c), -1)
                    r_idx = next((i for i, c in enumerate(fields) if "持股比率" in c), -1)
                    s_idx = next((i for i, c in enumerate(fields) if "發行股數" in c), -1)

                    if c_idx != -1 and r_idx != -1:
                        df_filtered = df[df.iloc[:, c_idx].isin(codes)]
                        res = {}
                        for _, row in df_filtered.iterrows():
                            code = str(row.iloc[c_idx]).strip()
                            ratio = float(str(row.iloc[r_idx]).replace(",", "").strip())
                            shares_str = str(row.iloc[s_idx]).replace(",", "").strip() if s_idx != -1 else "0"
                            res[code] = {"ratio": ratio, "shares": int(shares_str) if shares_str.isdigit() else 0}
                        return res, date_str
            except Exception:
                pass
            curr -= timedelta(days=1)
            time.sleep(1.5)
        return {}, None

    latest_data, latest_date = fetch_twse_qfiis(0)
    time.sleep(2)
    past_data, past_date = fetch_twse_qfiis(7)

    result = {}
    for code in codes:
        curr_ratio = latest_data.get(code, {}).get("ratio", np.nan)
        past_ratio = past_data.get(code, {}).get("ratio", np.nan)
        shares = latest_data.get(code, {}).get("shares", 0)

        # ★ 備援機制：若無法取得發行股數，呼叫 yfinance 補齊市值
        yf_market_cap = 0.0
        if shares == 0:
            try:
                import yfinance as yf
                mc = yf.Ticker(f"{code}.TW").info.get("marketCap", 0)
                if mc: yf_market_cap = mc / 100000000
            except: pass

        diff = round(curr_ratio - past_ratio, 2) if (pd.notna(curr_ratio) and pd.notna(past_ratio)) else np.nan
        result[code] = {
            "外資持股比率(%)": curr_ratio,
            "外資持股週增減(%)": diff,
            "發行股數": shares,
            "備援市值(億)": yf_market_cap
        }

    STATUS["外資持股&市值"] = f"✅ 雙備援模組 ({latest_date or '已啟用備援'})"
    return result

def get_financials(codes: list) -> pd.DataFrame:
    print(f"[7/8] 抓取財務快照 (營收與 EPS，共 {len(codes)} 檔)...")
    results = []
    today_str = datetime.now().strftime("%Y-%m-%d")
    start_str = (datetime.now() - timedelta(days=450)).strftime("%Y-%m-%d")

    for code in codes:
        fin_data = {"Code": code, "近四季EPS": np.nan, "最新月營收YoY%": np.nan, "最新月營收MoM%": np.nan}
        try:
            r_rev = requests.get("https://api.finmindtrade.com/api/v4/data", params={
                "dataset": "TaiwanStockMonthRevenue", "data_id": code,
                "start_date": start_str, "end_date": today_str, "token": FINMIND_TOKEN
            }, timeout=10)
            rev_payload = r_rev.json()
            if rev_payload.get("status") == 200 and rev_payload.get("data"):
                df_rev = pd.DataFrame(rev_payload["data"]).sort_values("date")
                if len(df_rev) >= 2:
                    last_rev = float(df_rev.iloc[-1]["revenue"])
                    prev_rev = float(df_rev.iloc[-2]["revenue"])
                    fin_data["最新月營收MoM%"] = round((last_rev / prev_rev - 1) * 100, 1) if prev_rev else np.nan
                    if len(df_rev) >= 13:
                        last_yr_rev = float(df_rev.iloc[-13]["revenue"])
                        fin_data["最新月營收YoY%"] = round((last_rev / last_yr_rev - 1) * 100, 1) if last_yr_rev else np.nan

            r_eps = requests.get("https://api.finmindtrade.com/api/v4/data", params={
                "dataset": "TaiwanStockFinancialStatements", "data_id": code,
                "start_date": start_str, "end_date": today_str, "token": FINMIND_TOKEN
            }, timeout=10)
            eps_payload = r_eps.json()
            if eps_payload.get("status") == 200 and eps_payload.get("data"):
                df_eps = pd.DataFrame(eps_payload["data"])
                df_eps = df_eps[df_eps["type"] == "EPS"].copy()
                df_eps["value"] = pd.to_numeric(df_eps["value"], errors="coerce")
                df_eps = df_eps.dropna(subset=["value"]).sort_values("date")
                if len(df_eps) > 0:
                    ttm_eps = df_eps.tail(4)["value"].sum()
                    fin_data["近四季EPS"] = round(ttm_eps, 2)

        except Exception: pass
        results.append(fin_data)
        time.sleep(0.3) 

    STATUS["財務快照"] = "✅ FinMind"
    return pd.DataFrame(results)

# ═══════════════════════════════════════════════
#  主體組合流程
# ═══════════════════════════════════════════════
def build_smart_pool():
    print("啟動終極選股池系統 v3.0 (高防呆雙備援版)，正在準備爬取...")

    macro_data = get_macro()
    twii_status = get_twii_status()
    df_quote = get_twse_quote()
    df_pe = get_pe_pb_div()
    df_inst = get_institution()

    df = df_quote.merge(df_pe, on="Code", how="left").merge(df_inst, on="Code", how="left")

    mask = (df["Code"].str.match(r"^[1-9]\d{3}$") & ~df["Name"].str.contains("ETF|ETN|權證|特別股|-DR")
            & (df["ClosingPrice"] >= 10) & (df["成交量_張"] >= 2000) & (df["漲跌幅%"] > -9.5))
    df_filtered = df[mask].copy()

    n_limit = int(df_filtered["漲停標記"].sum())
    CORE_N, SURGE_N, SHORT_N = 12, (28 if n_limit >= 20 else 18 if n_limit >= 10 else 13), 5
    STATUS["池子容量"] = f"核心{CORE_N} + 爆量{SURGE_N} + 空頭{SHORT_N} = {CORE_N+SURGE_N+SHORT_N}"

    df_core = df_filtered.sort_values("成交金額_億", ascending=False).head(CORE_N).copy()
    df_core["群組"] = f"1_核心 Top{CORE_N}"
    core_codes = df_core["Code"].tolist()

    df_cand = df_filtered[~df_filtered["Code"].isin(core_codes)].sort_values("成交量_張", ascending=False).head(250).copy()
    rvol_dict = get_rvol(df_cand["Code"].tolist(), df_cand)
    df_cand["RVOL"] = df_cand["Code"].map(rvol_dict).fillna(0)

    df_surge = df_cand[(df_cand["RVOL"] >= 1.5) & (df_cand["漲跌幅%"] > -3.0)].copy()
    if len(df_surge) < SURGE_N:
        backup = df_cand[(df_cand["RVOL"] >= 1.2) & (df_cand["漲跌幅%"] > -5.0) & ~df_cand["Code"].isin(df_surge["Code"])].sort_values("RVOL", ascending=False).head(SURGE_N - len(df_surge))
        df_surge = pd.concat([df_surge, backup])
    df_surge = df_surge.sort_values("RVOL", ascending=False).head(SURGE_N).copy()
    df_surge["群組"] = f"2_爆量 Top{SURGE_N}"

    already_in = core_codes + df_surge["Code"].tolist()
    df_short = df_cand[~df_cand["Code"].isin(already_in) & (df_cand["漲跌幅%"] < -2.0) & (df_cand["RVOL"] >= 1.0)].copy()
    if len(df_short) < SHORT_N:
        backup_short = df_cand[~df_cand["Code"].isin(already_in + df_short["Code"].tolist()) & (df_cand["漲跌幅%"] < -1.0) & (df_cand["RVOL"] >= 0.8)].sort_values("RVOL", ascending=False).head(SHORT_N - len(df_short))
        df_short = pd.concat([df_short, backup_short])
    df_short = df_short.sort_values("RVOL", ascending=False).head(SHORT_N).copy()
    df_short["群組"] = f"3_空方候選 Top{SHORT_N}"

    core_rvol_dict = get_rvol(core_codes, df_core)
    df_core["RVOL"] = df_core["Code"].map(core_rvol_dict).fillna(0)

    all_codes = core_codes + df_surge["Code"].tolist() + df_short["Code"].tolist()
    df_tech = get_technicals(all_codes)
    attention_codes, disposition = get_attention_disposition()
    df_5d = get_institution_5d(all_codes)

    sh_and_mc_dict = get_shareholding_and_market_cap(all_codes)
    df_fin = get_financials(all_codes)

    rename_map = {"OpeningPrice": "開盤價", "HighestPrice": "最高價", "LowestPrice": "最低價"}
    df_final = pd.concat([df_core, df_surge, df_short], ignore_index=True).rename(columns=rename_map)
    df_final = df_final.rename(columns={"Code": "股票代號", "Name": "股票名稱", "ClosingPrice": "收盤價", "成交量_張": "成交量(張)", "成交金額_億": "成交金額(億)"})

    df_final = df_final.merge(df_tech.rename(columns={"Code": "股票代號"}), on="股票代號", how="left")
    df_final = df_final.merge(df_5d.rename(columns={"Code": "股票代號"}), on="股票代號", how="left")
    df_final = df_final.merge(df_fin.rename(columns={"Code": "股票代號"}), on="股票代號", how="left")

    df_final["注意股"] = df_final["股票代號"].isin(attention_codes)
    df_final["處置股迄日"] = df_final["股票代號"].map(disposition).fillna("")

    df_final["外資持股比率(%)"] = df_final["股票代號"].map(lambda x: sh_and_mc_dict.get(x, {}).get("外資持股比率(%)", np.nan))
    df_final["外資持股週增減(%)"] = df_final["股票代號"].map(lambda x: sh_and_mc_dict.get(x, {}).get("外資持股週增減(%)", np.nan))
    df_final["發行股數"] = df_final["股票代號"].map(lambda x: sh_and_mc_dict.get(x, {}).get("發行股數", 0))

    # ★ 智慧備援市值計算機制
    def compute_market_cap(row):
        code = row.get("股票代號")
        shares = row.get("發行股數", 0)
        close_p = row.get("收盤價", 0)
        if shares > 0 and pd.notna(close_p):
            return round(shares * close_p / 100000000, 2)
        # 若發行股數為0，自動啟用 yfinance 回傳的備援市值
        return round(sh_and_mc_dict.get(code, {}).get("備援市值(億)", 0.0), 2)

    df_final["市值(億)"] = df_final.apply(compute_market_cap, axis=1)
    df_final = df_final.drop(columns=["發行股數"])

    for k, v in macro_data.items(): df_final[k] = v
    for k, v in twii_status.items(): df_final[k] = v

    df_final = df_final.sort_values(by=["群組", "成交金額(億)", "RVOL"], ascending=[True, False, False]).reset_index(drop=True)
    df_final.index += 1

    today_str = datetime.now().strftime("%Y%m%d")
    fname = f"smart_pool_v3.0_fixed_{today_str}.csv"
    df_final.to_csv(fname, index_label="排名", encoding="utf-8-sig")

    print(f"\n{'='*60}")
    print(f"  執行完畢！共產出 {len(df_final)} 檔，已存為 {fname}")
    print(f"{'─'*60}")
    for k, v in STATUS.items(): print(f"    {k:11s}：{v}")
    print(f"{'='*60}\n")
    print(df_final[["群組", "股票代號", "股票名稱", "收盤價", "市值(億)", "外資持股比率(%)", "漲停標記", "跌停標記"]].head(10).to_string())



# Google Drive 上傳功能 - 使用 OAuth Refresh Token
def upload_to_google_drive(csv_filename, folder_id="1vPeUEL5K-g8R7sGjLunzvx3hs8iOL5LN"):
    try:
        import requests
        import json as json_lib
        client_id = os.environ.get("GOOGLE_CLIENT_ID")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
        refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
        if not all([client_id, client_secret, refresh_token]):
            print("WARNING: Missing GOOGLE credentials")
            return False

        # Get access token
        token_resp = requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }, timeout=15)
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]

        # Read file
        with open(csv_filename, "rb") as f:
            file_content = f.read()

        # Build multipart body manually
        boundary = "----PythonFormBoundary7MA4YWxkTrZu0gW"
        metadata = json_lib.dumps({"name": csv_filename, "parents": [folder_id]})
        
        body_part1 = ("--" + boundary + "
"
                     "Content-Type: application/json

"
                     + metadata + "
"
                     "--" + boundary + "
"
                     "Content-Type: text/csv

").encode("utf-8")
        
        body_part2 = ("
--" + boundary + "--
").encode("utf-8")
        body = body_part1 + file_content + body_part2

        headers = {
            "Authorization": "Bearer " + access_token,
            "Content-Type": "multipart/related; boundary=" + boundary
        }

        resp = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files",
            headers=headers,
            data=body,
            timeout=30
        )
        resp.raise_for_status()
        file_id = resp.json().get("id", "unknown")
        print("DONE: Uploaded " + csv_filename + " to Google Drive, ID: " + file_id)
        return True

    except Exception as e:
        print("ERROR: Google Drive upload failed: " + str(e))
        return False

if __name__ == "__main__":
    build_smart_pool()
    today_str = datetime.now().strftime("%Y%m%d")
    csv_filename = f"smart_pool_v3.0_fixed_{today_str}.csv"
    print("\n" + "="*60)
    print("  Uploading CSV to Google Drive...")
    print("="*60)
    upload_to_google_drive(csv_filename)