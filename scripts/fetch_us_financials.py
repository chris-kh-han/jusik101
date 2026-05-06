"""
미국 상장사 분기별 재무제표 수집 — SEC EDGAR companyfacts/CIK{cik}.json 파싱

데이터 흐름:
  1. companies.us_companies.json (or D1 dump) → ticker, CIK 리스트
  2. for each CIK: GET data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
  3. us-gaap 태그별 분기 entry 추출 + 중복 제거
  4. (fy, fp)별 1행으로 join → JSON 출력 → /api/sync/us-financials POST

핵심 추출 로직 (Step 2 검증 결과):
  - PnL: start~end 80~100일이 분기 entry
  - BS: start 없고 end만 있는 시점값
  - 같은 (fy, fp)에 여러 entry → form 우선순위 (10-Q > 10-K), filed 최근

태그 매핑 (fallback 순서):
  revenue: RevenueFromContractWithCustomerExcludingAssessedTax → Revenues → SalesRevenueNet
  operating_income: OperatingIncomeLoss
  net_income: NetIncomeLoss
  eps_basic / eps_diluted: EarningsPerShareBasic / EarningsPerShareDiluted
  assets: Assets, liabilities: Liabilities, equity: StockholdersEquity
  shares_outstanding: CommonStockSharesOutstanding
  dividend_per_share: CommonStockDividendsPerShareDeclared

환경변수:
  - EDGAR_USER_AGENT (필수)
  - YEARS (선택, 디폴트 5)
  - LIMIT (선택, 디폴트 0 = 전체) — 디버깅용 N개만
  - COMPANIES_FILE (선택) — JSON 파일 경로 (us_companies.json)

SEC 한도:
  - 10 requests/sec → 0.1초 간격
  - 501개 회사 × 1회 = 약 50초

출력 형식:
[
  {
    "ticker": "AAPL", "fiscal_year": 2026, "fiscal_quarter": 2,
    "period_start": "2025-12-28", "period_end": "2026-03-28",
    "revenue": 111184000000, "operating_income": 35885000000, "net_income": 29578000000,
    "eps_basic": 1.92, "eps_diluted": 1.91,
    "total_assets": 364840000000, "total_liabilities": 273380000000, "total_equity": 91460000000,
    "shares_outstanding": 14850000000,
    "dividend_per_share": 0.26
  },
  ...
]
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timezone
from typing import Any, Iterable

import requests

# ── 환경 ────────────────────────────────────────────────────────────────────
EDGAR_USER_AGENT = os.environ.get("EDGAR_USER_AGENT", "")
YEARS = int(os.environ.get("YEARS", "5"))
LIMIT = int(os.environ.get("LIMIT", "0"))
COMPANIES_FILE = os.environ.get("COMPANIES_FILE", "")
REQUEST_INTERVAL_SEC = float(os.environ.get("REQUEST_INTERVAL_SEC", "0.12"))

if not EDGAR_USER_AGENT:
    print("[fetch_us_financials] EDGAR_USER_AGENT missing", file=sys.stderr)
    sys.exit(1)


# ── 태그 매핑 ───────────────────────────────────────────────────────────────
REVENUE_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "RevenuesNetOfInterestExpense",
]
OPERATING_TAGS = ["OperatingIncomeLoss"]
NET_INCOME_TAGS = ["NetIncomeLoss"]
EPS_BASIC_TAGS = ["EarningsPerShareBasic"]
EPS_DILUTED_TAGS = ["EarningsPerShareDiluted"]

ASSETS_TAGS = ["Assets"]
LIABILITIES_TAGS = ["Liabilities"]
EQUITY_TAGS = [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
]
SHARES_TAGS = ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"]

DIVIDEND_TAGS = [
    "CommonStockDividendsPerShareDeclared",
    "CommonStockDividendsPerShareCashPaid",
]


# ── 유틸 ───────────────────────────────────────────────────────────────────
def load_companies() -> list[dict[str, Any]]:
    """companies JSON 파일에서 ticker/CIK 로드. 없으면 stdin."""
    if COMPANIES_FILE and os.path.exists(COMPANIES_FILE):
        with open(COMPANIES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    print(
        "[fetch_us_financials] COMPANIES_FILE not set or missing — reading stdin",
        file=sys.stderr,
    )
    raw = sys.stdin.read()
    if not raw.strip():
        print("[fetch_us_financials] no input", file=sys.stderr)
        sys.exit(1)
    return json.loads(raw)


def fetch_companyfacts(cik: str) -> dict[str, Any] | None:
    """SEC EDGAR companyfacts JSON. None on 404/error."""
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    headers = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(
            f"[fetch_us_financials] {cik} fetch error: {e}", file=sys.stderr
        )
        return None


def days_between(s: str, e: str) -> int:
    return (date.fromisoformat(e) - date.fromisoformat(s)).days


def first_present_tag(facts: dict[str, Any], tags: Iterable[str]) -> dict[str, Any] | None:
    """tags 순서대로 us-gaap에서 찾아 첫 번째로 존재하는 거 반환."""
    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        info = us_gaap.get(tag)
        if info:
            return info
    return None


def pick_unit_entries(
    info: dict[str, Any], preferred_unit: str = "USD"
) -> list[dict[str, Any]]:
    """info.units에서 USD 우선 (없으면 첫번째)."""
    units = info.get("units", {})
    if preferred_unit in units:
        return units[preferred_unit]
    # USD/shares 같은 케이스 (EPS, DPS) — 자체 키 사용
    if "USD/shares" in units:
        return units["USD/shares"]
    if "shares" in units:
        return units["shares"]
    keys = list(units.keys())
    return units[keys[0]] if keys else []


def form_priority(form: str | None) -> int:
    """10-Q > 10-K > 기타. 큰 숫자가 우선."""
    if form == "10-Q":
        return 3
    if form == "10-K":
        return 2
    if form and form.startswith("10-"):
        return 1
    return 0


def extract_quarterly_pnl(
    info: dict[str, Any] | None, since_year: int
) -> dict[tuple[int, str], dict[str, Any]]:
    """
    PnL/DPS 태그에서 분기 entry 추출 → (fy, fp) → entry dict.
    같은 (fy, fp) 여러 entry 있으면 (form_priority, filed) 최댓값 채택.

    Q4 채움 로직:
      - SEC XBRL에서 회사가 Q4 단독을 따로 신고 안 하는 경우 다수 (10-K엔 FY 합계만)
      - FY (350-380일 누적) entry가 있고 Q1/Q2/Q3가 추출됐으면
        Q4 = FY - (Q1 + Q2 + Q3)로 합성 entry 생성
    """
    if not info:
        return {}
    entries = pick_unit_entries(info)

    # 분기 entry (80-100일)
    out: dict[tuple[int, str], dict[str, Any]] = {}
    # FY 누적 entry (350-380일) — Q4 채우기 위해
    fy_cumulative: dict[int, dict[str, Any]] = {}

    for e in entries:
        s, en = e.get("start"), e.get("end")
        if not s or not en:
            continue
        fy = e.get("fy")
        fp = e.get("fp")
        if fy is None:
            continue
        if fy < since_year:
            continue
        try:
            days = days_between(s, en)
        except ValueError:
            continue

        # 분기 entry (80-100일) — fp=FY 제외 (FY는 누적값이라 분기 단독 X)
        if 80 <= days <= 100:
            if fp not in ("Q1", "Q2", "Q3", "Q4"):
                continue
            key = (int(fy), str(fp))
            existing = out.get(key)
            if existing:
                # SEC XBRL은 같은 (fy, fp) 키에 비교용 prior year entry도 포함
                # → end가 더 최근인 것이 직접 신고. end < existing이면 비교용 → skip
                existing_end = existing.get("end", "")
                new_end = e.get("end", "")
                if new_end < existing_end:
                    continue
                if new_end == existing_end:
                    # 같은 end (정정/재신고) → form 우선순위 + filed 최근
                    existing_pri = (
                        form_priority(existing.get("form")),
                        existing.get("filed", ""),
                    )
                    new_pri = (
                        form_priority(e.get("form")),
                        e.get("filed", ""),
                    )
                    if new_pri <= existing_pri:
                        continue
            out[key] = e
            continue

        # FY 연간 누적 entry (350-380일)
        if 350 <= days <= 380 and fp == "FY":
            existing = fy_cumulative.get(int(fy))
            if existing:
                existing_end = existing.get("end", "")
                new_end = e.get("end", "")
                if new_end < existing_end:
                    continue
                if new_end == existing_end:
                    existing_pri = (
                        form_priority(existing.get("form")),
                        existing.get("filed", ""),
                    )
                    new_pri = (
                        form_priority(e.get("form")),
                        e.get("filed", ""),
                    )
                    if new_pri <= existing_pri:
                        continue
            fy_cumulative[int(fy)] = e

    # Q4 합성: FY - (Q1 + Q2 + Q3)
    for fy_year, fy_entry in fy_cumulative.items():
        q4_key = (fy_year, "Q4")
        if q4_key in out:
            continue  # 이미 Q4 분기 entry 존재
        q1 = out.get((fy_year, "Q1"))
        q2 = out.get((fy_year, "Q2"))
        q3 = out.get((fy_year, "Q3"))
        if not (q1 and q2 and q3):
            continue
        try:
            fy_val = float(fy_entry["val"])
            sum_q123 = (
                float(q1["val"]) + float(q2["val"]) + float(q3["val"])
            )
        except (KeyError, ValueError, TypeError):
            continue
        q4_val = fy_val - sum_q123
        # 합성 entry 만들기 — start는 Q3 end 다음, end는 FY end
        out[q4_key] = {
            "val": q4_val,
            "start": q3["end"],
            "end": fy_entry["end"],
            "fy": fy_year,
            "fp": "Q4",
            "form": "10-K (computed Q4)",
            "filed": fy_entry.get("filed", ""),
        }

    return out


def extract_quarterly_bs(
    info: dict[str, Any] | None, since_year: int
) -> dict[tuple[int, str], dict[str, Any]]:
    """
    BS 태그에서 분기말 시점값 추출 → (fy, fp) → entry dict.
    BS는 start 없고 end만 있음.

    SEC XBRL은 같은 (fy, fp)에 비교용 prior year entry도 포함 → end 가장 최근 채택.
    """
    if not info:
        return {}
    entries = pick_unit_entries(info)
    out: dict[tuple[int, str], dict[str, Any]] = {}
    for e in entries:
        if e.get("start"):
            continue
        en = e.get("end")
        if not en:
            continue
        fy = e.get("fy")
        fp = e.get("fp")
        if fy is None or fp not in ("Q1", "Q2", "Q3", "Q4", "FY"):
            continue
        if fy < since_year:
            continue
        key = (int(fy), str(fp))
        existing = out.get(key)
        if existing:
            existing_end = existing.get("end", "")
            new_end = e.get("end", "")
            if new_end < existing_end:
                continue  # 비교용 prior year entry → skip
            if new_end == existing_end:
                existing_pri = (
                    form_priority(existing.get("form")),
                    existing.get("filed", ""),
                )
                new_pri = (form_priority(e.get("form")), e.get("filed", ""))
                if new_pri <= existing_pri:
                    continue
        out[key] = e
    return out


def fp_to_quarter(fp: str) -> int:
    """FY → 4 (사업보고서 = Q4 시점), Q1~Q3 그대로."""
    if fp == "FY":
        return 4
    return int(fp.replace("Q", ""))


# ── 회사별 처리 ─────────────────────────────────────────────────────────────
def process_company(
    company: dict[str, Any], since_year: int
) -> list[dict[str, Any]]:
    """단일 회사의 분기별 재무 시계열 추출."""
    ticker = company["ticker"]
    cik = company["cik"]
    facts = fetch_companyfacts(cik)
    if not facts:
        return []

    # 각 카테고리별 분기 entry 추출
    revenue = extract_quarterly_pnl(first_present_tag(facts, REVENUE_TAGS), since_year)
    op_income = extract_quarterly_pnl(first_present_tag(facts, OPERATING_TAGS), since_year)
    net_income = extract_quarterly_pnl(first_present_tag(facts, NET_INCOME_TAGS), since_year)
    eps_basic = extract_quarterly_pnl(first_present_tag(facts, EPS_BASIC_TAGS), since_year)
    eps_diluted = extract_quarterly_pnl(first_present_tag(facts, EPS_DILUTED_TAGS), since_year)
    dps = extract_quarterly_pnl(first_present_tag(facts, DIVIDEND_TAGS), since_year)

    assets = extract_quarterly_bs(first_present_tag(facts, ASSETS_TAGS), since_year)
    liab = extract_quarterly_bs(first_present_tag(facts, LIABILITIES_TAGS), since_year)
    equity = extract_quarterly_bs(first_present_tag(facts, EQUITY_TAGS), since_year)
    shares = extract_quarterly_bs(first_present_tag(facts, SHARES_TAGS), since_year)

    # union of all (fy, fp) keys
    all_keys = (
        set(revenue.keys())
        | set(op_income.keys())
        | set(net_income.keys())
        | set(assets.keys())
        | set(equity.keys())
    )

    rows: list[dict[str, Any]] = []
    for fy, fp in sorted(all_keys):
        # period_end는 PnL의 end 또는 BS의 end (둘 다 같은 분기 끝)
        period_end = None
        period_start = None
        for src in (revenue, op_income, net_income):
            e = src.get((fy, fp))
            if e:
                period_start = e.get("start")
                period_end = e.get("end")
                break
        if period_end is None:
            for src in (assets, liab, equity, shares):
                e = src.get((fy, fp))
                if e:
                    period_end = e.get("end")
                    break
        if period_end is None:
            continue

        def val(src: dict, key: tuple[int, str]) -> Any:
            e = src.get(key)
            return e.get("val") if e else None

        rows.append(
            {
                "ticker": ticker,
                "fiscal_year": fy,
                "fiscal_quarter": fp_to_quarter(fp),
                "period_start": period_start,
                "period_end": period_end,
                "revenue": val(revenue, (fy, fp)),
                "operating_income": val(op_income, (fy, fp)),
                "net_income": val(net_income, (fy, fp)),
                "eps_basic": val(eps_basic, (fy, fp)),
                "eps_diluted": val(eps_diluted, (fy, fp)),
                "total_assets": val(assets, (fy, fp)),
                "total_liabilities": val(liab, (fy, fp)),
                "total_equity": val(equity, (fy, fp)),
                "shares_outstanding": val(shares, (fy, fp)),
                "dividend_per_share": val(dps, (fy, fp)),
            }
        )

    return rows


# ── 메인 ───────────────────────────────────────────────────────────────────
def main() -> int:
    companies = load_companies()
    if LIMIT > 0:
        companies = companies[:LIMIT]

    since_year = datetime.now().year - YEARS
    print(
        f"[fetch_us_financials] companies={len(companies)}, since_year={since_year}",
        file=sys.stderr,
    )

    all_rows: list[dict[str, Any]] = []
    for i, company in enumerate(companies, 1):
        try:
            rows = process_company(company, since_year)
        except Exception as e:
            print(
                f"[fetch_us_financials] {company.get('ticker')} error: {e}",
                file=sys.stderr,
            )
            rows = []
        all_rows.extend(rows)
        time.sleep(REQUEST_INTERVAL_SEC)
        if i % 50 == 0 or i == len(companies):
            print(
                f"[fetch_us_financials] progress {i}/{len(companies)} — total rows {len(all_rows)}",
                file=sys.stderr,
            )

    print(f"[fetch_us_financials] DONE — {len(all_rows)} rows", file=sys.stderr)
    if not all_rows:
        return 1

    json.dump(all_rows, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
