"""
미국 상장사 배당 events 수집 — yfinance 직접 사용

데이터 흐름:
  1. companies.json (D1 us_companies dump) → ticker 리스트
  2. for each ticker: yf.Ticker(ticker).dividends
     - index = 정확한 ex-dividend date (Yahoo 공식)
     - val = 1주당 배당금 (USD, split-adjusted)
  3. JSON 출력 → /api/sync/us-dividends POST

이전 버전(FDR + EDGAR fallback) 폐기 이유:
  - FDR이 NVDA 같은 대형주에서 가끔 빈 결과 반환
  - EDGAR fallback이 정확한 ex-date 없음 (분기말일로 대체 → 1-2달 오차)
  - EDGAR는 같은 기간에 raw($0.04) / split-adjusted($0.004) / cumulative($0.16)
    여러 entry 신고하는 경우 dedup 어려움
  - yfinance 직접 호출이 가장 정확하고 일관된 데이터 제공

환경변수:
  - YEARS (선택, 디폴트 5) — 수집 기간 (years before now)
  - LIMIT (선택, 디폴트 0) — top N 회사만 (디버깅)
  - COMPANIES_FILE (선택) — companies.json 경로
  - REQUEST_INTERVAL_SEC (선택, 디폴트 0.05) — Yahoo throttle 방지

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
from datetime import datetime, timezone
from typing import Any

# yfinance는 import 자체가 무거우므로 lazy
def _lazy_yf():
    import yfinance as yf

    return yf


# ── 환경 ────────────────────────────────────────────────────────────────────
YEARS = int(os.environ.get("YEARS", "5"))
LIMIT = int(os.environ.get("LIMIT", "0"))
COMPANIES_FILE = os.environ.get("COMPANIES_FILE", "")
REQUEST_INTERVAL_SEC = float(os.environ.get("REQUEST_INTERVAL_SEC", "0.05"))


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


# ── yfinance dividend fetch ────────────────────────────────────────────────
def fetch_dividends(ticker: str, since_year: int) -> list[dict[str, Any]]:
    """
    yfinance Ticker(ticker).dividends → 정확한 ex-date + amount.
    yfinance가 빈 결과 반환하면 [] (재시도 1회).

    yfinance dividends는 split-adjusted 값.
    """
    yf = _lazy_yf()

    for attempt in range(2):
        try:
            t = yf.Ticker(ticker)
            divs = t.dividends
        except Exception as e:
            if attempt == 0:
                time.sleep(0.5)
                continue
            print(
                f"[fetch_us_dividends] {ticker} yfinance error: {e}",
                file=sys.stderr,
            )
            return []

        if divs is None or divs.empty:
            if attempt == 0:
                time.sleep(0.5)
                continue
            return []

        # 성공
        break
    else:
        return []

    out: list[dict[str, Any]] = []
    for ts, val in divs.items():
        try:
            # ts: pandas Timestamp (timezone-aware)
            ex_date = ts.strftime("%Y-%m-%d")
            year = ts.year
        except Exception:
            continue
        if year < since_year:
            continue
        try:
            v = float(val)
        except (TypeError, ValueError):
            continue
        if v <= 0:
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


# ── 메인 ───────────────────────────────────────────────────────────────────
def main() -> int:
    companies = load_companies()
    if LIMIT > 0:
        companies = companies[:LIMIT]

    since_year = datetime.now(timezone.utc).year - YEARS
    print(
        f"[fetch_us_dividends] companies={len(companies)}, since_year={since_year}",
        file=sys.stderr,
    )

    all_items: list[dict[str, Any]] = []
    no_data_count = 0
    for i, company in enumerate(companies, 1):
        ticker = company["ticker"]
        items = fetch_dividends(ticker, since_year)
        if not items:
            no_data_count += 1
        all_items.extend(items)
        time.sleep(REQUEST_INTERVAL_SEC)
        if i % 50 == 0 or i == len(companies):
            print(
                f"[fetch_us_dividends] progress {i}/{len(companies)} "
                f"— total {len(all_items)} events, no-data {no_data_count}",
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
        f"[fetch_us_dividends] DONE — {len(unique)} unique events "
        f"({len(all_items) - len(unique)} dups dropped, "
        f"{no_data_count} companies with no data)",
        file=sys.stderr,
    )
    if not unique:
        return 1

    json.dump(unique, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
