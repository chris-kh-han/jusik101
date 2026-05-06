"""
DART 현금/현물 배당결정 공시 수집 → 정확한 배당락일/지급일/주당배당금 추출

데이터 흐름:
  1. companies.json에서 시총 상위 N 종목 로드 (top N)
  2. 각 종목별 /list.json 호출 → "배당" 포함 공시 필터
  3. 각 공시의 rcept_no로 /document.xml 호출 → ZIP 응답
  4. ZIP 풀고 XML/HTML 파싱 → 배당기준일/배당지급예정일/주당현금배당금 추출
  5. 배치로 stdout에 JSON 출력 (워크플로우가 /api/sync/dividends에 POST)

환경변수:
  - DART_API_KEY (필수)
  - TOP_N (선택, 디폴트 1000)
  - YEARS (선택, 디폴트 5)

DART 한도 안전 마진:
  - top 1000 × 평균 5회 호출 = 약 5,000회/실행 (일 한도 10,000)

출력 형식:
[
  {
    "stock_code": "005930",
    "ex_dividend_date": "2024-12-30",
    "payment_date": "2025-04-18",
    "dividend_per_share": 363,
    "dividend_type": "CASH",
    "source": "dart"
  },
  ...
]
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import zipfile
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree as ET

import urllib.request
import urllib.error
import urllib.parse

# ── 설정 ───────────────────────────────────────────────────────────────────
DART_API_KEY = os.environ.get("DART_API_KEY", "")
TOP_N = int(os.environ.get("TOP_N", "1000"))
YEARS = int(os.environ.get("YEARS", "5"))
COMPANIES_JSON = os.environ.get(
    "COMPANIES_JSON", "src/data/companies.json"
)
REQUEST_DELAY_SEC = float(os.environ.get("REQUEST_DELAY_SEC", "0.05"))

if not DART_API_KEY:
    print("[fetch_dividend] DART_API_KEY missing", file=sys.stderr)
    sys.exit(1)


# ── HTTP 유틸 ──────────────────────────────────────────────────────────────
def http_get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "jusik101-cron/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_json(url: str, timeout: int = 30) -> dict[str, Any]:
    raw = http_get(url, timeout=timeout)
    return json.loads(raw.decode("utf-8"))


# ── DART API ───────────────────────────────────────────────────────────────
def fetch_disclosure_list(
    corp_code: str, bgn_de: str, end_de: str
) -> list[dict[str, Any]]:
    """
    /list.json 호출 → 'report_nm'에 '배당' 포함된 공시만 반환.
    페이지네이션 자동.
    """
    items: list[dict[str, Any]] = []
    page_no = 1
    while True:
        params = {
            "crtfc_key": DART_API_KEY,
            "corp_code": corp_code,
            "bgn_de": bgn_de,
            "end_de": end_de,
            "page_count": 100,
            "page_no": page_no,
        }
        url = "https://opendart.fss.or.kr/api/list.json?" + urllib.parse.urlencode(
            params
        )
        try:
            data = http_get_json(url)
        except urllib.error.HTTPError as e:
            print(
                f"[fetch_dividend] {corp_code} list.json HTTP {e.code}",
                file=sys.stderr,
            )
            return items

        if data.get("status") != "000":
            # status 013 = 조회된 데이터 없음 (정상)
            return items

        page_list = data.get("list", []) or []
        for item in page_list:
            if "배당" in (item.get("report_nm") or ""):
                items.append(item)

        total_pages = int(data.get("total_page", 1))
        if page_no >= total_pages:
            break
        page_no += 1
        time.sleep(REQUEST_DELAY_SEC)

    return items


def fetch_document_zip(rcept_no: str) -> bytes | None:
    """
    /document.xml 호출 → ZIP 바이트 응답.
    실제 응답은 ZIP 파일이지만 Content-Type이 종종 잘못 표시됨.
    """
    params = {"crtfc_key": DART_API_KEY, "rcept_no": rcept_no}
    url = "https://opendart.fss.or.kr/api/document.xml?" + urllib.parse.urlencode(
        params
    )
    try:
        return http_get(url, timeout=60)
    except urllib.error.HTTPError as e:
        print(f"[fetch_dividend] document.xml HTTP {e.code}", file=sys.stderr)
        return None


# ── XML 파싱 ───────────────────────────────────────────────────────────────
# DART 공시 본문은 HTML-like XML — <td><span ...>레이블</span></td> ... <td><span class="xforms_input" ...>값</span></td>
# 보통주식 1주당 배당금은 라벨 다음에 "보통주식"이 또 끼어있어서 두 단계 필요.

ISO_DATE = re.compile(r"(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})")
RE_VALUE_SPAN = re.compile(
    r'<span[^>]*class="xforms_input"[^>]*>\s*([^<]*?)\s*</span>'
)


def normalize_date(s: str | None) -> str | None:
    """'2024년 12월 30일' / '2024-12-30' / '2024.12.30' → '2024-12-30'."""
    if not s:
        return None
    m = ISO_DATE.search(s)
    if not m:
        return None
    y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return f"{y}-{mo:02d}-{d:02d}"


def normalize_amount(s: str | None) -> int | None:
    """'363' / '363원' / '363,000원' → 363 (콤마/원 제거)."""
    if not s:
        return None
    cleaned = re.sub(r"[^\d]", "", s)
    if not cleaned:
        return None
    try:
        n = int(cleaned)
        return n if n > 0 else None
    except ValueError:
        return None


def find_first_value_after(
    text: str, start_pos: int, max_distance: int = 1500
) -> str | None:
    """start_pos 이후 max_distance 자 안에서 첫 번째 xforms_input span 값."""
    window = text[start_pos : start_pos + max_distance]
    m = RE_VALUE_SPAN.search(window)
    if not m:
        return None
    return m.group(1).strip()


def find_label_pos(text: str, label: str) -> int | None:
    """라벨 텍스트 첫 출현 위치의 끝 (정확 매치)."""
    idx = text.find(label)
    if idx < 0:
        return None
    return idx + len(label)


def parse_xml_for_dividend(xml_text: str) -> dict[str, Any]:
    """
    DART 현금ㆍ현물배당결정 공시 XML에서 배당 핵심 필드 추출.

    추출 필드 (보통주 기준):
      - record_date: 배당기준일
      - payment_date: 배당금 지급 예정일 (없으면 None — 주총 후 확정되는 케이스)
      - dividend_per_share: 1주당 배당금 (원)
      - dividend_kind: 'CASH' (현금배당) / 'STOCK' (현물/주식배당)
      - is_quarterly: 분기/반기 배당 여부 (배당구분 텍스트로 추정)
    """
    result: dict[str, Any] = {
        "record_date": None,
        "payment_date": None,
        "dividend_per_share": None,
        "dividend_kind": "CASH",
        "is_quarterly": False,
    }

    # 1) 1주당 배당금(원) — 라벨 → "보통주식" → 첫 xforms_input
    dps_label_end = find_label_pos(xml_text, "1주당 배당금")
    if dps_label_end is not None:
        common_idx = xml_text.find("보통주식", dps_label_end)
        if common_idx >= 0:
            value = find_first_value_after(xml_text, common_idx)
            result["dividend_per_share"] = normalize_amount(value)
        else:
            # 보통주식 구분이 없는 보고서 (단일 종류) → 라벨 직후 첫 값
            value = find_first_value_after(xml_text, dps_label_end)
            result["dividend_per_share"] = normalize_amount(value)

    # 2) 배당기준일
    record_label_end = find_label_pos(xml_text, "배당기준일")
    if record_label_end is not None:
        value = find_first_value_after(xml_text, record_label_end)
        result["record_date"] = normalize_date(value)

    # 3) 배당금지급 예정일자 (또는 배당지급)
    for label in [
        "배당금지급 예정일자",
        "배당금 지급 예정일",
        "배당금지급예정일",
        "배당지급일",
    ]:
        pos = find_label_pos(xml_text, label)
        if pos is not None:
            value = find_first_value_after(xml_text, pos)
            normalized = normalize_date(value)
            if normalized:
                result["payment_date"] = normalized
                break

    # 4) 배당구분 (분기/반기/결산)
    div_kind_pos = find_label_pos(xml_text, "1. 배당구분")
    if div_kind_pos is None:
        div_kind_pos = find_label_pos(xml_text, "배당구분")
    if div_kind_pos is not None:
        kind_value = find_first_value_after(xml_text, div_kind_pos, 500)
        if kind_value and ("분기" in kind_value or "반기" in kind_value):
            result["is_quarterly"] = True

    # 5) 배당종류 (현금/현물/주식)
    div_type_pos = find_label_pos(xml_text, "2. 배당종류")
    if div_type_pos is None:
        div_type_pos = find_label_pos(xml_text, "배당종류")
    if div_type_pos is not None:
        type_value = find_first_value_after(xml_text, div_type_pos, 500)
        if type_value and ("주식" in type_value or "현물" in type_value):
            result["dividend_kind"] = "STOCK"

    return result


def extract_dividend_from_zip(zip_bytes: bytes) -> dict[str, Any] | None:
    """ZIP 바이트 → 안의 XML 파일 모두 시도해서 배당 필드 추출."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        return None

    for name in zf.namelist():
        if not name.lower().endswith(".xml"):
            continue
        try:
            raw = zf.read(name)
        except KeyError:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = raw.decode("euc-kr")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", errors="ignore")

        parsed = parse_xml_for_dividend(text)
        if parsed["dividend_per_share"] and parsed["record_date"]:
            return parsed

    return None


def compute_ex_dividend_date(record_date_iso: str) -> str:
    """
    배당기준일에서 배당락일 계산.

    한국 주식 관례:
      - 배당기준일 D → 배당락일 = D - 1 거래일
      - 12-31 (휴장)이면 D - 2일 (12-29)
      - 주말이면 직전 금요일

    quarterly-dividend.ts의 estimateExDividendDate와 동일한 로직.
    """
    from datetime import datetime, timedelta

    try:
        d = datetime.strptime(record_date_iso, "%Y-%m-%d")
    except ValueError:
        return record_date_iso

    if d.month == 12 and d.day == 31:
        d = d - timedelta(days=2)
    else:
        d = d - timedelta(days=1)
    while d.weekday() in (5, 6):
        d = d - timedelta(days=1)
    return d.strftime("%Y-%m-%d")


# ── 메인 ───────────────────────────────────────────────────────────────────
def load_companies(top_n: int) -> list[dict[str, Any]]:
    """companies.json 로드 (시총 내림차순 top N, stockCode 있는 것만)."""
    with open(COMPANIES_JSON, "r", encoding="utf-8") as f:
        all_companies = json.load(f)
    # marketCap None은 뒤로
    sorted_list = sorted(
        all_companies,
        key=lambda c: (c.get("marketCap") or 0),
        reverse=True,
    )
    filtered = [c for c in sorted_list if c.get("stockCode")][:top_n]
    print(
        f"[fetch_dividend] companies loaded: {len(filtered)} (top {top_n})",
        file=sys.stderr,
    )
    return filtered


def collect_for_company(
    company: dict[str, Any], bgn_de: str, end_de: str
) -> list[dict[str, Any]]:
    """한 종목의 모든 배당 공시 → 파싱 결과 list."""
    corp_code = company["corpCode"]
    stock_code = company["stockCode"]

    disclosures = fetch_disclosure_list(corp_code, bgn_de, end_de)
    if not disclosures:
        return []

    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()  # (ex_dividend_date, type) 중복 방지

    for d in disclosures:
        rcept_no = d.get("rcept_no", "")
        if not rcept_no:
            continue
        time.sleep(REQUEST_DELAY_SEC)
        zip_bytes = fetch_document_zip(rcept_no)
        if not zip_bytes:
            continue

        parsed = extract_dividend_from_zip(zip_bytes)
        if not parsed:
            continue

        record_date = parsed.get("record_date")
        dps = parsed.get("dividend_per_share")
        if not record_date or not dps:
            continue

        ex_dividend_date = compute_ex_dividend_date(record_date)
        dividend_type = parsed.get("dividend_kind", "CASH")

        key = (ex_dividend_date, dividend_type)
        if key in seen:
            continue
        seen.add(key)

        output.append(
            {
                "stock_code": stock_code,
                "ex_dividend_date": ex_dividend_date,
                "payment_date": parsed.get("payment_date"),
                "dividend_per_share": dps,
                "dividend_type": dividend_type,
                "source": "dart",
            }
        )

    return output


def main() -> int:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    bgn_year = datetime.now().year - YEARS
    bgn_de = f"{bgn_year}0101"
    end_de = today

    print(
        f"[fetch_dividend] range: {bgn_de} ~ {end_de} (years={YEARS})",
        file=sys.stderr,
    )

    companies = load_companies(TOP_N)
    all_items: list[dict[str, Any]] = []

    for i, company in enumerate(companies, 1):
        try:
            items = collect_for_company(company, bgn_de, end_de)
        except Exception as e:
            print(
                f"[fetch_dividend] {company.get('corpName')} error: {e}",
                file=sys.stderr,
            )
            continue
        all_items.extend(items)
        if i % 50 == 0 or i == len(companies):
            print(
                f"[fetch_dividend] progress {i}/{len(companies)} — total items {len(all_items)}",
                file=sys.stderr,
            )

    print(
        f"[fetch_dividend] DONE — {len(all_items)} dividend events",
        file=sys.stderr,
    )

    if not all_items:
        return 1

    json.dump(all_items, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
