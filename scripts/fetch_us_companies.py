"""
미국 상장사 수집 (S&P 500 우선) — SEC ticker map + FDR 시총/섹터

데이터 흐름:
  1. SEC company_tickers.json    → ticker, CIK, name (전체 미국 상장사 약 10K)
  2. FDR StockListing('S&P500')  → S&P 500 종목 + 시총 + 섹터 + 거래소
  3. CIK이 5자리 미만이면 0-pad해서 10자리로 (EDGAR companyfacts URL 형식)
  4. ticker로 inner join → S&P 500만 추출 (확장 시 여기서 풀어주면 됨)

환경변수:
  - EDGAR_USER_AGENT (필수): 'jusik101 (your@email.com)'
  - LIST_SCOPE (선택): 'sp500' (디폴트) | 'all_listed' (NASDAQ+NYSE 전체)

출력 형식:
[
  {
    "ticker": "AAPL",
    "cik": "0000320193",
    "name": "Apple Inc.",
    "exchange": "NASDAQ",
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "market_cap": 3500000000000,
    "is_sp500": 1
  },
  ...
]

GitHub Actions에서 실행 → /api/sync/us-companies 에 POST.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import requests
import FinanceDataReader as fdr

# ── 환경 ────────────────────────────────────────────────────────────────────
EDGAR_USER_AGENT = os.environ.get("EDGAR_USER_AGENT", "")
LIST_SCOPE = os.environ.get("LIST_SCOPE", "sp500")  # 'sp500' | 'all_listed'

if not EDGAR_USER_AGENT:
    print("[fetch_us_companies] EDGAR_USER_AGENT missing", file=sys.stderr)
    sys.exit(1)


# ── SEC ticker → CIK ────────────────────────────────────────────────────────
def fetch_ticker_to_cik() -> dict[str, dict[str, Any]]:
    """
    SEC company_tickers.json 다운로드 → ticker(uppercase) → {cik, name} dict.

    응답 예시:
      {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}
    """
    url = "https://www.sec.gov/files/company_tickers.json"
    headers = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    raw = resp.json()

    out: dict[str, dict[str, Any]] = {}
    for entry in raw.values():
        ticker = entry.get("ticker", "").upper()
        cik = entry.get("cik_str")
        if not ticker or cik is None:
            continue
        # CIK은 10자리 0-padding (companyfacts URL 형식)
        cik_padded = str(cik).zfill(10)
        out[ticker] = {"cik": cik_padded, "name": entry.get("title", ticker)}
    print(f"[fetch_us_companies] SEC ticker_map: {len(out)} entries", file=sys.stderr)
    return out


# ── FDR S&P 500 (시총/섹터/거래소 보강) ───────────────────────────────────────
def fetch_sp500_extras() -> dict[str, dict[str, Any]]:
    """FDR로 S&P 500 메타 가져오기."""
    df = fdr.StockListing("S&P500")
    print(
        f"[fetch_us_companies] FDR S&P500: {len(df)} rows, columns={df.columns.tolist()}",
        file=sys.stderr,
    )

    # 컬럼명 normalize (FDR이 시점에 따라 다를 수 있음)
    cols = {c.lower(): c for c in df.columns}
    sym_col = cols.get("symbol") or cols.get("code")
    name_col = cols.get("name")
    sec_col = cols.get("sector") or cols.get("gicssector")
    ind_col = cols.get("industry") or cols.get("gicssub-industry")

    extras: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        ticker = str(row[sym_col]).upper()
        if not ticker:
            continue
        extras[ticker] = {
            "sector": str(row[sec_col]) if sec_col and sec_col in row else None,
            "industry": str(row[ind_col]) if ind_col and ind_col in row else None,
            "name_fdr": str(row[name_col]) if name_col and name_col in row else None,
        }
    return extras


def fetch_marketcap_for(tickers: list[str]) -> dict[str, int]:
    """
    1차: NASDAQ + NYSE 거래소 listing의 시총 컬럼 (FDR)
    2차 fallback: yfinance Ticker(t).info["marketCap"] (시간 좀 걸림)

    FDR StockListing은 시총 컬럼이 없는 경우 다수라 yfinance fallback 필수.
    """
    caps: dict[str, int] = {}
    exchanges: dict[str, str] = {}
    for exch in ["NASDAQ", "NYSE", "AMEX"]:
        try:
            df = fdr.StockListing(exch)
        except Exception as e:
            print(f"[fetch_us_companies] {exch} listing error: {e}", file=sys.stderr)
            continue
        cols = {c.lower(): c for c in df.columns}
        sym_col = cols.get("symbol") or cols.get("code")
        cap_col = (
            cols.get("marcap")
            or cols.get("marketcap")
            or cols.get("market cap")
            or cols.get("market_cap")
        )
        if sym_col is None:
            continue
        for _, row in df.iterrows():
            ticker = str(row[sym_col]).upper()
            exchanges[ticker] = exch
            if cap_col and cap_col in row:
                v = row[cap_col]
                try:
                    if v is not None and not (isinstance(v, float) and v != v):
                        n = int(v)
                        if n > 0:
                            caps[ticker] = n
                except (ValueError, TypeError):
                    pass
        print(
            f"[fetch_us_companies] {exch}: {len(df)} stocks loaded",
            file=sys.stderr,
        )
    return caps, exchanges  # type: ignore


def fill_marketcaps_yfinance(
    tickers: list[str], existing: dict[str, int]
) -> dict[str, int]:
    """
    yfinance Ticker(t).info["marketCap"]로 누락된 시총 보강.

    FDR listing에 시총 컬럼이 없거나 NaN인 경우 fallback.
    종목별 호출이라 시간 걸림 (501 종목 × 0.5초 ≈ 4분).
    """
    try:
        import yfinance as yf
    except ImportError:
        print(
            "[fetch_us_companies] yfinance not available, skipping marketcap fallback",
            file=sys.stderr,
        )
        return existing

    out = dict(existing)
    missing = [t for t in tickers if t not in existing]
    print(
        f"[fetch_us_companies] yfinance fallback for {len(missing)} tickers",
        file=sys.stderr,
    )
    for i, t in enumerate(missing, 1):
        try:
            info = yf.Ticker(t).info
            mcap = info.get("marketCap")
            if isinstance(mcap, (int, float)) and mcap > 0:
                out[t] = int(mcap)
        except Exception as e:
            # rate limit / network 에러 — 조용히 skip
            if i <= 3:
                print(f"[fetch_us_companies] {t} yfinance error: {e}", file=sys.stderr)
        if i % 50 == 0:
            print(
                f"[fetch_us_companies] yfinance progress {i}/{len(missing)} (filled {len(out) - len(existing)})",
                file=sys.stderr,
            )
    print(
        f"[fetch_us_companies] yfinance filled {len(out) - len(existing)} new caps",
        file=sys.stderr,
    )
    return out


# ── 메인 ───────────────────────────────────────────────────────────────────
def main() -> int:
    ticker_map = fetch_ticker_to_cik()
    sp500_extras = fetch_sp500_extras()
    caps, exchanges = fetch_marketcap_for(list(ticker_map.keys()))

    # 범위 결정
    if LIST_SCOPE == "sp500":
        target_tickers = set(sp500_extras.keys()) & set(ticker_map.keys())
    elif LIST_SCOPE == "all_listed":
        target_tickers = set(ticker_map.keys())
    else:
        print(f"[fetch_us_companies] unknown LIST_SCOPE: {LIST_SCOPE}", file=sys.stderr)
        return 1

    print(
        f"[fetch_us_companies] scope={LIST_SCOPE}, target tickers={len(target_tickers)}",
        file=sys.stderr,
    )

    # FDR로 안 잡힌 시총은 yfinance로 보강 (target에 들어간 종목만)
    caps = fill_marketcaps_yfinance(sorted(target_tickers), caps)

    output: list[dict[str, Any]] = []
    for ticker in sorted(target_tickers):
        sec = ticker_map[ticker]
        extras = sp500_extras.get(ticker, {})
        output.append(
            {
                "ticker": ticker,
                "cik": sec["cik"],
                "name": sec["name"],
                "exchange": exchanges.get(ticker),
                "sector": extras.get("sector"),
                "industry": extras.get("industry"),
                "market_cap": caps.get(ticker),
                "is_sp500": 1 if ticker in sp500_extras else 0,
            }
        )

    print(f"[fetch_us_companies] DONE — {len(output)} companies", file=sys.stderr)
    if not output:
        return 1

    json.dump(output, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
