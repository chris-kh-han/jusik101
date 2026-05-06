"""
미국 상장사 Income Statement 24개 항목 수집 — TradingView 스타일 표용

데이터 흐름:
  1. companies.json → ticker, CIK 리스트
  2. for each CIK: GET data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
  3. 24개 IS 항목별 us-gaap 태그 추출:
     - 직접 신고: SEC가 그대로 신고하는 태그 (Revenue, OperatingIncomeLoss 등)
     - Computed:  여러 태그 결합 (GrossProfit = Revenue - COGS, EBITDA = OpIncome + D&A)
  4. period 필터:
     - Q1/Q2/Q3/Q4 (80~100일 분기 entry)
     - FY (350~380일 연 누적 entry)
  5. 같은 (fy, period) 키에 직접/비교 entry 중복 → end 가장 최근 채택
  6. JSON 출력 → /api/sync/us-financial-facts POST

환경변수:
  - EDGAR_USER_AGENT (필수)
  - YEARS (선택, 디폴트 5)
  - LIMIT (선택, 디폴트 0)
  - COMPANIES_FILE (선택, JSON 경로)

출력 형식:
[
  {
    "ticker": "AAPL", "fiscal_year": 2026, "period": "Q2",
    "period_end": "2026-03-28", "category": "IS",
    "account_name": "TotalRevenue", "display_label": "Total revenue",
    "display_order": 10, "value": 111184000000
  },
  ...
]
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime
from typing import Any, Iterable

import requests

# ── 환경 ────────────────────────────────────────────────────────────────────
EDGAR_USER_AGENT = os.environ.get("EDGAR_USER_AGENT", "")
YEARS = int(os.environ.get("YEARS", "5"))
LIMIT = int(os.environ.get("LIMIT", "0"))
COMPANIES_FILE = os.environ.get("COMPANIES_FILE", "")
REQUEST_INTERVAL_SEC = float(os.environ.get("REQUEST_INTERVAL_SEC", "0.12"))

if not EDGAR_USER_AGENT:
    print("[fetch_us_is] EDGAR_USER_AGENT missing", file=sys.stderr)
    sys.exit(1)


# ── 항목 정의 ───────────────────────────────────────────────────────────────
# (display_order, account_name, display_label, [tag fallback list])
# tag fallback: 첫 번째 매치되는 태그의 값 채택 — 직접 신고 항목.
# computed 항목은 별도 함수에서 처리 (tag 리스트 빈 list).
INCOME_STATEMENT_ITEMS: list[tuple[int, str, str, list[str]]] = [
    (
        10, "TotalRevenue", "Total revenue",
        [
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "SalesRevenueNet",
            "RevenuesNetOfInterestExpense",
        ],
    ),
    (
        20, "CostOfGoodsSold", "Cost of goods sold",
        [
            "CostOfGoodsAndServicesSold",
            "CostOfRevenue",
            "CostOfServices",
            "CostOfGoodsSold",
        ],
    ),
    (
        30, "GrossProfit", "Gross profit",
        ["GrossProfit"],  # 없으면 computed: Revenue - COGS
    ),
    (
        40, "OperatingExpensesExclCogs", "Operating expenses (excl. COGS)",
        [],  # computed: TotalOperatingExpenses - COGS
    ),
    (
        50, "OperatingIncome", "Operating income",
        ["OperatingIncomeLoss"],
    ),
    (
        60, "NonOperatingIncome", "Non-operating income (total)",
        [
            "NonoperatingIncomeExpense",
            "NonoperatingIncomeExpenseNet",
        ],
    ),
    (
        70, "PretaxIncome", "Pretax income",
        [
            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
        ],
    ),
    (
        80, "EquityInEarnings", "Equity in earnings",
        ["IncomeLossFromEquityMethodInvestments"],
    ),
    (
        90, "Taxes", "Taxes",
        ["IncomeTaxExpenseBenefit"],
    ),
    (
        100, "MinorityInterest", "Non-controlling/minority interest",
        ["NetIncomeLossAttributableToNoncontrollingInterest"],
    ),
    (
        110, "AfterTaxOther", "After tax other income/expense",
        [],  # computed: NetIncome - (PretaxIncome - Taxes - MinorityInterest)
    ),
    (
        120, "NetIncomeBeforeDiscontinued", "Net income before discontinued operations",
        ["IncomeLossFromContinuingOperations"],
    ),
    (
        130, "DiscontinuedOperations", "Discontinued operations",
        [
            "IncomeLossFromDiscontinuedOperationsNetOfTax",
            "DiscontinuedOperationGainLossOnDisposalOfDiscontinuedOperationNetOfTax",
        ],
    ),
    (
        140, "NetIncome", "Net income",
        ["NetIncomeLoss"],
    ),
    (
        150, "DilutionAdjustment", "Dilution adjustment",
        [],  # computed: NetIncomeLoss - DilutedNI (드물게 있음)
    ),
    (
        160, "PreferredDividends", "Preferred dividends",
        [
            "PreferredStockDividendsAndOtherAdjustments",
            "PreferredStockDividends",
        ],
    ),
    (
        170, "DilutedNiAvailable", "Diluted net income available to common stockholders",
        [
            "NetIncomeLossAvailableToCommonStockholdersDiluted",
            "NetIncomeLossAvailableToCommonStockholdersBasic",
        ],
    ),
    (
        180, "BasicEps", "Basic earnings per share (basic EPS)",
        ["EarningsPerShareBasic"],
    ),
    (
        190, "DilutedEps", "Diluted earnings per share (diluted EPS)",
        ["EarningsPerShareDiluted"],
    ),
    (
        200, "BasicSharesOutstanding", "Average basic shares outstanding",
        ["WeightedAverageNumberOfSharesOutstandingBasic"],
    ),
    (
        210, "DilutedSharesOutstanding", "Diluted shares outstanding",
        ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    ),
    (
        220, "Ebitda", "EBITDA",
        [],  # computed: OperatingIncome + DepreciationAndAmortization
    ),
    (
        230, "Ebit", "EBIT",
        [],  # OperatingIncome 자체로 근사
    ),
    (
        240, "TotalOperatingExpenses", "Total operating expenses",
        ["OperatingExpenses", "CostsAndExpenses"],
    ),
]

# Computed 항목에 필요한 추가 raw 태그 (helper로 추출)
DA_TAGS = [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "Depreciation",
]

# 평균값 항목 — Q4 합성 시 누적 차감(FY - Q1 - Q2 - Q3) 적용 금지.
# 가중평균 주식수는 분기별 ~동일한 평균값이라 차감하면 음수가 나옴.
# (예: Apple FY2024 BasicSharesOutstanding ≈ 15.4B → 누적차감 시 -30.9B)
# Q4는 FY 값을 근사로 사용 (분기 간 변동 작음 → 1% 이내 오차).
AVERAGE_VALUE_ACCOUNTS = {
    "BasicSharesOutstanding",
    "DilutedSharesOutstanding",
}


# ── HTTP / 추출 유틸 ───────────────────────────────────────────────────────
def fetch_companyfacts(cik: str) -> dict[str, Any] | None:
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    headers = {"User-Agent": EDGAR_USER_AGENT, "Accept": "application/json"}
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"[fetch_us_is] {cik} fetch error: {e}", file=sys.stderr)
        return None


def days_between(s: str, e: str) -> int:
    return (date.fromisoformat(e) - date.fromisoformat(s)).days


def form_priority(form: str | None) -> int:
    if form == "10-Q":
        return 3
    if form == "10-K":
        return 2
    if form and form.startswith("10-"):
        return 1
    return 0


def pick_unit_entries(info: dict[str, Any]) -> list[dict[str, Any]]:
    """USD 우선, 없으면 USD/shares (EPS), 없으면 shares, 없으면 첫 unit."""
    units = info.get("units", {})
    for key in ("USD", "USD/shares", "shares"):
        if key in units:
            return units[key]
    keys = list(units.keys())
    return units[keys[0]] if keys else []


def first_present_tag(facts: dict[str, Any], tags: Iterable[str]) -> dict[str, Any] | None:
    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        info = us_gaap.get(tag)
        if info:
            return info
    return None


def extract_period_entries_merged(
    facts: dict[str, Any], tags: Iterable[str], since_year: int
) -> dict[tuple[int, str], dict[str, Any]]:
    """
    여러 fallback 태그의 entries를 (fy, period) 단위로 merge.

    문제: first_present_tag는 1순위 태그만 반환 → 그 태그가 일부 fy만
    커버하면 나머지 fy는 빈 칸이 됨 (예: NVIDIA의 RevenueFromContract...
    는 fy 2019~2022만 → fy 2023+ 비어있음, 정작 Revenues 태그엔 다 있음).

    해결: 모든 fallback 태그 순회 → 같은 (fy, period) 키엔 1순위 태그 우선
    (이미 있으면 skip), 없는 키만 후순위 태그에서 채움.
    """
    us_gaap = facts.get("facts", {}).get("us-gaap", {})
    merged: dict[tuple[int, str], dict[str, Any]] = {}
    for tag in tags:
        info = us_gaap.get(tag)
        if not info:
            continue
        per = extract_period_entries(info, since_year)
        for key, entry in per.items():
            if key not in merged:
                merged[key] = entry
    return merged


def extract_period_entries(
    info: dict[str, Any] | None, since_year: int
) -> dict[tuple[int, str], dict[str, Any]]:
    """
    한 us-gaap 태그의 entries에서 분기/연 단위로 추출.
    key: (fiscal_year, period) where period in {'Q1','Q2','Q3','Q4','FY'}
    같은 키 여러 entry 있으면 end 가장 최근 + form 우선순위 채택 (비교 entry 제거).
    """
    if not info:
        return {}
    entries = pick_unit_entries(info)
    out: dict[tuple[int, str], dict[str, Any]] = {}

    for e in entries:
        s, en = e.get("start"), e.get("end")
        fy = e.get("fy")
        fp = e.get("fp")
        if not en or fy is None or fp not in ("Q1", "Q2", "Q3", "Q4", "FY"):
            continue
        if fy < since_year:
            continue

        if s:
            try:
                days = days_between(s, en)
            except ValueError:
                continue
            # 분기 entry: 80~100일
            # 연 entry: 350~380일
            if 80 <= days <= 100:
                period = fp if fp != "FY" else None
                if period is None:
                    continue
            elif 350 <= days <= 380 and fp == "FY":
                period = "FY"
            else:
                continue
        else:
            # start 없는 시점 entry — IS는 거의 없음 (BS만)
            continue

        key = (int(fy), period)
        existing = out.get(key)
        if existing:
            existing_end = existing.get("end", "")
            new_end = en
            if new_end < existing_end:
                continue
            if new_end == existing_end:
                if (form_priority(e.get("form")), e.get("filed", "")) <= (
                    form_priority(existing.get("form")),
                    existing.get("filed", ""),
                ):
                    continue
        out[key] = e

    return out


def fp_synthesize_q4(
    extracted: dict[tuple[int, str], dict[str, Any]],
    is_average: bool = False,
) -> dict[tuple[int, str], dict[str, Any]]:
    """
    Q4 단독이 SEC에 없는 케이스 → 합성.

    is_average=False (default): 누적 항목 (revenue/income/expenses 등).
      Q4 = FY - (Q1 + Q2 + Q3)

    is_average=True: 평균값 항목 (가중평균 주식수 등).
      Q4 ≈ FY 값 그대로 (분기 간 변동 작아 1% 이내 오차).
      누적차감하면 음수가 나옴 (예: Apple BasicShares -30.9B).
    """
    out = dict(extracted)
    fy_years = {fy for (fy, p) in extracted.keys() if p == "FY"}
    for fy in fy_years:
        if (fy, "Q4") in out:
            continue
        fy_e = out.get((fy, "FY"))
        if not fy_e:
            continue

        if is_average:
            # 평균값 — FY 값을 Q4 근사로 사용
            q3 = out.get((fy, "Q3"))
            q3_end = q3.get("end") if q3 else None
            try:
                fy_val = float(fy_e["val"])
            except (KeyError, ValueError, TypeError):
                continue
            out[(fy, "Q4")] = {
                "val": fy_val,
                "start": q3_end or fy_e.get("start"),
                "end": fy_e["end"],
                "fy": fy,
                "fp": "Q4",
                "form": "10-K (FY-approx)",
            }
            continue

        # 누적 항목 — Q1+Q2+Q3 모두 필요
        q1 = out.get((fy, "Q1"))
        q2 = out.get((fy, "Q2"))
        q3 = out.get((fy, "Q3"))
        if not (q1 and q2 and q3):
            continue
        try:
            q4_val = (
                float(fy_e["val"])
                - float(q1["val"])
                - float(q2["val"])
                - float(q3["val"])
            )
        except (KeyError, ValueError, TypeError):
            continue
        out[(fy, "Q4")] = {
            "val": q4_val,
            "start": q3["end"],
            "end": fy_e["end"],
            "fy": fy,
            "fp": "Q4",
            "form": "10-K (computed)",
        }
    return out


# ── 회사별 처리 ─────────────────────────────────────────────────────────────
def process_company(
    company: dict[str, Any], since_year: int
) -> list[dict[str, Any]]:
    ticker = company["ticker"]
    cik = company["cik"]
    facts = fetch_companyfacts(cik)
    if not facts:
        return []

    # 각 직접 신고 항목 추출 → key=(item_account_name) → {(fy,period): entry}
    # fallback 태그를 (fy, period) 단위로 merge (1순위 우선)
    # → 1순위 태그가 일부 fy만 커버해도 나머지를 후순위에서 보충 (예: NVIDIA Revenues)
    direct_extracted: dict[str, dict[tuple[int, str], dict[str, Any]]] = {}
    for order, account_name, label, tags in INCOME_STATEMENT_ITEMS:
        if not tags:
            continue  # computed 항목은 별도
        per = extract_period_entries_merged(facts, tags, since_year)
        is_avg = account_name in AVERAGE_VALUE_ACCOUNTS
        direct_extracted[account_name] = fp_synthesize_q4(per, is_average=is_avg)

    # 추가 helper 태그 (computed용) — D&A는 누적 항목
    da_extracted = fp_synthesize_q4(
        extract_period_entries_merged(facts, DA_TAGS, since_year)
    )

    # Computed 항목 계산
    def get_val(account: str, key: tuple[int, str]) -> float | None:
        e = direct_extracted.get(account, {}).get(key)
        if not e:
            return None
        try:
            return float(e["val"])
        except (KeyError, ValueError, TypeError):
            return None

    def get_da_val(key: tuple[int, str]) -> float | None:
        e = da_extracted.get(key)
        if not e:
            return None
        try:
            return float(e["val"])
        except (KeyError, ValueError, TypeError):
            return None

    # 모든 (fy, period) 키 union
    all_keys: set[tuple[int, str]] = set()
    for d in direct_extracted.values():
        all_keys.update(d.keys())

    rows: list[dict[str, Any]] = []
    for key in sorted(all_keys):
        fy, period = key
        # period_end는 가장 큰 end 채택
        end_candidates = [
            direct_extracted[acc][key]["end"]
            for acc in direct_extracted
            if key in direct_extracted[acc]
        ]
        period_end = max(end_candidates) if end_candidates else None
        if period_end is None:
            continue

        rev = get_val("TotalRevenue", key)
        cogs = get_val("CostOfGoodsSold", key)
        op_income = get_val("OperatingIncome", key)
        net_income = get_val("NetIncome", key)
        pretax = get_val("PretaxIncome", key)
        taxes = get_val("Taxes", key)
        minority = get_val("MinorityInterest", key) or 0.0
        total_opex = get_val("TotalOperatingExpenses", key)

        # Gross profit = Revenue - COGS (직접 신고 우선, 없으면 계산)
        gp_direct = get_val("GrossProfit", key)
        gross_profit = gp_direct
        if gross_profit is None and rev is not None and cogs is not None:
            gross_profit = rev - cogs

        # Operating expenses (excl. COGS) — TradingView 표시: GrossProfit - OperatingIncome
        # (R&D + SG&A 합계, 음수로 표시 = 지출).
        # 기존 (TotalOpEx - COGS) 로직은 회사마다 OperatingExpenses 태그 정의가 달라
        # Apple 같이 이미 excl. COGS인 경우 잘못된 값 — 부호 통일 위해 IS identity 사용.
        opex_excl_cogs = None
        if op_income is not None and gross_profit is not None:
            opex_excl_cogs = op_income - gross_profit  # 지출이므로 음수

        # After tax other = NetIncome - (PretaxIncome - Taxes - MinorityInterest)
        # taxes는 expense라 (+) 부호로 차감 의도 — 정확한 부호는 회사마다 — 0이 정상
        after_tax_other = None
        if (
            net_income is not None
            and pretax is not None
            and taxes is not None
        ):
            after_tax_other = net_income - (pretax - taxes - minority)

        # EBITDA = OperatingIncome + D&A (절댓값)
        ebitda = None
        if op_income is not None:
            da = get_da_val(key)
            ebitda = op_income + (da or 0.0)

        # EBIT = OperatingIncome (근사)
        ebit = op_income

        computed = {
            "GrossProfit": gross_profit,
            "OperatingExpensesExclCogs": opex_excl_cogs,
            "AfterTaxOther": after_tax_other,
            "Ebitda": ebitda,
            "Ebit": ebit,
            "DilutionAdjustment": None,  # 거의 0 — 추후 정밀 추가
        }

        # row 생성 — 24개 항목 모두 (값 있는 것만)
        for order, account_name, label, tags in INCOME_STATEMENT_ITEMS:
            value: float | None
            if tags:
                value = get_val(account_name, key)
            else:
                value = computed.get(account_name)

            if value is None:
                continue  # null row 스킵 (D1 절약)

            rows.append(
                {
                    "ticker": ticker,
                    "fiscal_year": fy,
                    "period": period,
                    "period_end": period_end,
                    "category": "IS",
                    "account_name": account_name,
                    "display_label": label,
                    "display_order": order,
                    "value": value,
                }
            )

    return rows


# ── 메인 ───────────────────────────────────────────────────────────────────
def load_companies() -> list[dict[str, Any]]:
    if COMPANIES_FILE and os.path.exists(COMPANIES_FILE):
        with open(COMPANIES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    raw = sys.stdin.read()
    if not raw.strip():
        print("[fetch_us_is] no input", file=sys.stderr)
        sys.exit(1)
    return json.loads(raw)


def main() -> int:
    companies = load_companies()
    if LIMIT > 0:
        companies = companies[:LIMIT]

    since_year = datetime.now().year - YEARS
    print(
        f"[fetch_us_is] companies={len(companies)}, since={since_year}",
        file=sys.stderr,
    )

    all_rows: list[dict[str, Any]] = []
    for i, company in enumerate(companies, 1):
        try:
            rows = process_company(company, since_year)
        except Exception as e:
            print(f"[fetch_us_is] {company.get('ticker')} error: {e}", file=sys.stderr)
            rows = []
        all_rows.extend(rows)
        time.sleep(REQUEST_INTERVAL_SEC)
        if i % 50 == 0 or i == len(companies):
            print(
                f"[fetch_us_is] progress {i}/{len(companies)} — total rows {len(all_rows)}",
                file=sys.stderr,
            )

    print(f"[fetch_us_is] DONE — {len(all_rows)} rows", file=sys.stderr)
    if not all_rows:
        return 1

    json.dump(all_rows, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
