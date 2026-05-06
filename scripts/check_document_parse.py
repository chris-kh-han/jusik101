"""
Phase 2 검증: /document.xml 1건 파싱 결과 출력

삼성전자 2024-12-30 배당 공시 (rcept_no = 20250131000632) 를 받아 ZIP 풀고 XML 파싱.
출력: 배당기준일 / 배당지급예정일 / 1주당 배당금
"""

from __future__ import annotations

import io
import os
import re
import sys
import urllib.request
import urllib.parse
import zipfile
from typing import Any

DART_API_KEY = ""
# .env.local에서 직접 읽기
try:
    with open(".env.local", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            if "DART" in k.upper():
                DART_API_KEY = v.strip().strip('"').strip("'")
                break
except FileNotFoundError:
    pass

if not DART_API_KEY:
    print("DART_API_KEY를 찾을 수 없음 (.env.local)", file=sys.stderr)
    sys.exit(1)


# 삼성전자 2024 Q4 배당 공시 (실제 rcept_no 모르므로 list.json부터)
def get_first_dividend_rcept_no() -> str | None:
    params = {
        "crtfc_key": DART_API_KEY,
        "corp_code": "00126380",
        "bgn_de": "20250101",
        "end_de": "20250228",
        "page_count": 100,
    }
    url = "https://opendart.fss.or.kr/api/list.json?" + urllib.parse.urlencode(
        params
    )
    with urllib.request.urlopen(url, timeout=30) as resp:
        import json
        data = json.loads(resp.read().decode("utf-8"))
    for item in data.get("list") or []:
        if "현금" in (item.get("report_nm") or "") and "배당" in (
            item.get("report_nm") or ""
        ):
            return item.get("rcept_no")
    return None


def fetch_zip(rcept_no: str) -> bytes:
    params = {"crtfc_key": DART_API_KEY, "rcept_no": rcept_no}
    url = "https://opendart.fss.or.kr/api/document.xml?" + urllib.parse.urlencode(
        params
    )
    with urllib.request.urlopen(url, timeout=60) as resp:
        return resp.read()


def main() -> int:
    rcept_no = get_first_dividend_rcept_no()
    if not rcept_no:
        print("배당 공시를 찾을 수 없음", file=sys.stderr)
        return 1
    print(f"[check] rcept_no = {rcept_no}", file=sys.stderr)

    zip_bytes = fetch_zip(rcept_no)
    print(f"[check] zip size = {len(zip_bytes)} bytes", file=sys.stderr)

    # ZIP 안 파일 목록
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        # ZIP 아닐 수도 — XML 그대로일 수 있음
        print("[check] not ZIP, treating as raw XML", file=sys.stderr)
        text = zip_bytes.decode("utf-8", errors="ignore")
        print(text[:3000])
        return 0

    print(f"[check] zip contents: {zf.namelist()}", file=sys.stderr)

    for name in zf.namelist():
        raw = zf.read(name)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = raw.decode("euc-kr")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", errors="ignore")

        print(f"\n━━━━━━━━━━ {name} ({len(raw)} bytes) ━━━━━━━━━━", file=sys.stderr)
        # 처음 5000자만 (배당 정보가 보통 앞부분에 있음)
        excerpt = text[:5000]
        print(excerpt)

        # 배당 관련 라벨 위치 확인
        for label in ["배당기준일", "배당락일", "배당금지급", "1주당 배당금", "1주당배당금", "주당배당금"]:
            idx = text.find(label)
            if idx >= 0:
                # 라벨 주변 200자
                window = text[max(0, idx - 50) : idx + 300]
                print(f"\n>>> '{label}' @ {idx}: {window!r}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
