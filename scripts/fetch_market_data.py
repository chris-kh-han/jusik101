"""
KOSPI/KOSDAQ 시장 분류 + 시가총액 데이터 수집

GitHub Actions에서 실행되어 결과를 stdout에 JSON으로 출력.
워크플로우가 이 출력을 /api/sync/market 에 POST.

데이터 소스: FinanceDataReader (KRX 또는 Naver Finance fallback)

출력 형식:
[
  {"stock_code": "005930", "market": "KOSPI", "market_cap": 500000000000000},
  ...
]
"""

import json
import sys
from typing import Any

import FinanceDataReader as fdr


def fetch_market(market: str) -> list[dict[str, Any]]:
    """KOSPI 또는 KOSDAQ 종목 리스트 + 시가총액 조회."""
    try:
        df = fdr.StockListing(market)
    except Exception as e:
        print(f"[fetch_market_data] {market} fetch 실패: {e}", file=sys.stderr)
        return []

    # 컬럼 표준화
    # FDR이 시점에 따라 컬럼명이 약간 달라서 방어적으로 처리
    cols = {c.lower(): c for c in df.columns}

    code_col = cols.get("code") or cols.get("symbol")
    marcap_col = cols.get("marcap") or cols.get("marketcap")

    if code_col is None:
        print(f"[fetch_market_data] {market}: Code 컬럼을 찾을 수 없음. 컬럼: {df.columns.tolist()}", file=sys.stderr)
        return []

    items: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        stock_code = str(row[code_col]).zfill(6)  # 6자리 zero-pad

        # 종목코드는 6자리 숫자만 허용 (우선주, 채권 등 제외)
        if not stock_code.isdigit() or len(stock_code) != 6:
            continue

        market_cap = None
        if marcap_col is not None:
            try:
                v = row[marcap_col]
                # NaN, None, 0 처리
                if v is not None and not (isinstance(v, float) and v != v):  # NaN 체크
                    market_cap = int(v)
                    if market_cap <= 0:
                        market_cap = None
            except (ValueError, TypeError):
                market_cap = None

        items.append({
            "stock_code": stock_code,
            "market": market,
            "market_cap": market_cap,
        })

    return items


def main() -> int:
    all_items: list[dict[str, Any]] = []

    for market in ("KOSPI", "KOSDAQ"):
        items = fetch_market(market)
        print(f"[fetch_market_data] {market}: {len(items)}개", file=sys.stderr)
        all_items.extend(items)

    # 중복 stock_code 제거 (혹시라도 있으면 첫 번째 유지)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in all_items:
        if item["stock_code"] in seen:
            continue
        seen.add(item["stock_code"])
        unique.append(item)

    print(f"[fetch_market_data] 총 {len(unique)}개 (중복 제거 후)", file=sys.stderr)

    if not unique:
        print("[fetch_market_data] 수집된 데이터 없음 — exit 1", file=sys.stderr)
        return 1

    # stdout에 JSON 출력
    json.dump(unique, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
