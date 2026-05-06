"""
미국 상장사 배당 events 수집 — FDR(Yahoo) 1차 + EDGAR companyfacts fallback

데이터 흐름:
  1. companies.json (D1 us_companies dump) → ticker, CIK
  2. for each ticker: FDR DataReader(ticker, since=...) → Dividends 컬럼
     - index = ex-dividend date (Yahoo는 ex-date 기준 시계열 제공)
     - val = 1주당 배당금 (USD)
  3. FDR이 데이터 못 받는 종목 → EDGAR companyfacts fallback
     - period_end를 ex-date로 (회계상 분기말 ≈ ex-date 근사)
     - dps만 있고 정확한 ex-date 없는 케이스
  4. JSON 출력 → /api/sync/us-dividends POST

환경변수:
  - EDGAR_USER_AGENT (필수)
  - YEARS (선택, 디폴트 5)
  - LIMIT (선택, 디폴트 0)
  - COMPANIES_FILE (선택)

출력 형식:
[
  {
    "ticker": "AAPL",
    "ex_dividend_date": "2025-02-10",
    "payment_date": null,
    "dividend_per_share": 0.25,
    "dividend_type": "CASH",
    "source": "yahoo"
  },
  ...
]
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, date
from typing import Any

import requests

# FDR은 import 자체가 무거우므로 (pandas + numpy + lxml ...) 필요한 시점에 lazy import
def _lazy_fdr():
    import FinanceDataReader as fdr
    return fdr


# ── 환경 ────────────────────────────────────────────────────────────────────
EDGAR_USER_AGENT = os.environ.get("EDGAR_USER_AGENT", "")
YEARS = int(os.environ.get("YEARS", "5"))
LIMIT = int(os.environ.get("LIMIT", "0"))
COMPANIES_FILE = os.environ.get("COMPANIES_FILE", "")
EDGAR_INTERVAL_SEC = float(os.environ.get("EDGAR_INTERVAL_SEC", "0.12"))

if not EDGAR_USER_AGENT:
    print("[fetch_us_dividends] EDGAR_USER_AGENT missing", file=sys.stderr)
    sys.exit(1)


# ── 회사 리스트 ─────────────────────────────────────────────────────────────
def load_companies() -> list[dict[str, Any]]:
    if COMPANIES_FILE and os.path.exists(COMPANIES_FILE):
        with open(COMPANIES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    raw = sys.stdin.read()
    if not raw.strip():
        print("[fetch_us_dividends] no input", file=sys.stderr)
        sys.exit(1)
    return json.loads(raw)


# ── FDR Yahoo 1차 ──────────────────────────────────────────────────────────
def fetch_dividends_yahoo(
    ticker: str, since: str
) -> list[dict[str, Any]]:
    """
    FDR DataReader(ticker, since)의 Dividends 컬럼.
    index = ex-dividend date, value = USD/share.
    """
    fdr = _lazy_fdr()
    try:
        df = fdr.DataReader(ticker, since)
    except Exception as e:
        print(f"[fetch_us_dividends] {ticker} FDR error: {e}", file=sys.stderr)
        return []

    if df is None or df.empty:
        return []

    # 컬럼명 normalize
    cols = {c.lower(): c for c in df.columns}
    div_col = cols.get("dividends") or cols.get("dividend")
    if div_col is None:
        return []

    out: list[dict[str, Any]] = []
    div_series = df[div_col]
    for idx, val in div_series.items():
        try:
            v = float(val)
        except (TypeError, ValueError):
            continue
        if v <= 0:
            continue
        try:
            ex_date = idx.strftime("%Y-%m-%d")
        except AttributeError:
            continue
        out.append(
            {
                "ticker": ticker,
                "ex_dividend_date": ex_date,
                "payment_date": None,
                "dividend_per_share": round(v, 4),
                "dividend_type": "CASH",
                "source": "yahoo",
            }
        )
    return out


# ── EDGAR fallback ─────────────────────────────────────────────────────────
def fetch_dividends_edgar(
    cik: str, ticker: str, since_year: int
) -> list[dict[str, Any]]:
    """
    SEC EDGAR companyfacts에서 CommonStockDividendsPerShareDeclared 분기값.
    period_end를 ex-date로 (정확한 ex-date는 아니지만 fallback).
    """
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    headers = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        facts = resp.json()
    except requests.RequestException as e:
        print(
            f"[fetch_us_dividends] {cik} EDGAR error: {e}", file=sys.stderr
        )
        return []

    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    info = (
        us_gaap.get("CommonStockDividendsPerShareDeclared")
        or us_gaap.get("CommonStockDividendsPerShareCashPaid")
    )
    if not info:
        return []

    units = info.get("units", {})
    entries = units.get("USD/shares") or units.get("USD") or []

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for e in entries:
        s, en = e.get("start"), e.get("end")
        if not s or not en:
            continue
        try:
            sy, sm, sd = (int(x) for x in s.split("-"))
            ey, em, ed = (int(x) for x in en.split("-"))
        except ValueError:
            continue
        if ey < since_year:
            continue
        days = (date(ey, em, ed) - date(sy, sm, sd)).days
        if not (80 <= days <= 100):
            continue
        try:
            v = float(e.get("val", 0))
        except (TypeError, ValueError):
            continue
        if v <= 0:
            continue
        if en in seen:
            continue
        seen.add(en)
        out.append(
            {
                "ticker": ticker,
                "ex_dividend_date": en,  # 정확한 ex-date 아님, 분기말일
                "payment_date": None,
                "dividend_per_share": round(v, 4),
                "dividend_type": "CASH",
                "source": "edgar",
            }
        )
    return out


# ── 메인 ───────────────────────────────────────────────────────────────────
def main() -> int:
    companies = load_companies()
    if LIMIT > 0:
        companies = companies[:LIMIT]

    since_year = datetime.now().year - YEARS
    since = f"{since_year}-01-01"
    print(
        f"[fetch_us_dividends] companies={len(companies)}, since={since}",
        file=sys.stderr,
    )

    all_items: list[dict[str, Any]] = []
    for i, company in enumerate(companies, 1):
        ticker = company["ticker"]
        cik = company.get("cik", "")

        # 1차 Yahoo
        items = fetch_dividends_yahoo(ticker, since)

        # Yahoo가 못 받으면 EDGAR fallback
        if not items and cik:
            items = fetch_dividends_edgar(cik, ticker, since_year)
            time.sleep(EDGAR_INTERVAL_SEC)

        all_items.extend(items)

        if i % 50 == 0 or i == len(companies):
            print(
                f"[fetch_us_dividends] progress {i}/{len(companies)} — total {len(all_items)}",
                file=sys.stderr,
            )

    # 중복 제거 (ticker, ex_dividend_date, dividend_type)
    seen: set[tuple[str, str, str]] = set()
    unique: list[dict[str, Any]] = []
    for it in all_items:
        key = (it["ticker"], it["ex_dividend_date"], it["dividend_type"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)

    print(
        f"[fetch_us_dividends] DONE — {len(unique)} unique events ({len(all_items) - len(unique)} dups dropped)",
        file=sys.stderr,
    )
    if not unique:
        return 1

    json.dump(unique, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
