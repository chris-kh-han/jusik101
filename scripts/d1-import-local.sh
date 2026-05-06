#!/usr/bin/env bash
# Idempotent local D1 import.
#
# 문제: wrangler d1 execute --file=*.sql는 트랜잭션 롤백을 안 해서
#       이미 CREATE TABLE된 테이블이 있으면 첫 줄에서 끊김
#       (예: "table companies already exists at offset 13: SQLITE_ERROR")
#
# 해결: prod-dump.sql의 모든 CREATE TABLE 직전에 DROP TABLE IF EXISTS 자동 주입
#       → 매번 안전하게 덮어쓰기 가능
#
# 사용:
#   pnpm d1:import-local            # 이 스크립트 호출
#   pnpm d1:sync-from-prod          # export-prod && import-local
#
# 주의: pnpm pages:dev가 동작 중일 때도 안전 (miniflare가 같은 D1 파일 공유).

set -euo pipefail

cd "$(dirname "$0")/.."

DUMP=".wrangler/prod-dump.sql"
PATCHED=".wrangler/prod-dump-patched.sql"

if [[ ! -f "$DUMP" ]]; then
  echo "❌ $DUMP 없음. 먼저 'pnpm d1:export-prod'를 실행하세요." >&2
  exit 1
fi

echo "🌀 prod-dump.sql 가공 (DROP IF EXISTS 주입 + 거대 row 제외)..."

# Python으로 정확성 + BSD/GNU 양쪽 호환 + 거대 row 필터링.
# 제외 테이블:
#   - financial_cache: DART API 응답 캐시. row 하나가 ~250KB JSON
#     이라 SQLite "statement too long" 발생. 로컬에선 cache miss 시
#     DART API로 fallback (재생성 가능).
python3 - <<EOF
import re
from pathlib import Path

EXCLUDE_TABLES = {"financial_cache"}

src = Path("$DUMP").read_text(encoding="utf-8")

# 1. CREATE TABLE 직전에 DROP TABLE IF EXISTS 주입
patched = re.sub(
    r"^CREATE TABLE (\w+) \(",
    r"DROP TABLE IF EXISTS \1;\nCREATE TABLE \1 (",
    src,
    flags=re.MULTILINE,
)

# 2. CREATE INDEX 직전에 DROP INDEX IF EXISTS 주입
patched = re.sub(
    r"^CREATE INDEX (\w+) ",
    r"DROP INDEX IF EXISTS \1;\nCREATE INDEX \1 ",
    patched,
    flags=re.MULTILINE,
)
patched = re.sub(
    r"^CREATE UNIQUE INDEX (\w+) ",
    r"DROP INDEX IF EXISTS \1;\nCREATE UNIQUE INDEX \1 ",
    patched,
    flags=re.MULTILINE,
)

# 3. 거대 row 제외 (EXCLUDE_TABLES 의 INSERT 라인 통째 삭제)
filtered_lines = []
skipped_inserts = {t: 0 for t in EXCLUDE_TABLES}
for line in patched.splitlines(keepends=True):
    skip = False
    for tbl in EXCLUDE_TABLES:
        if line.startswith(f'INSERT INTO "{tbl}"') or line.startswith(f"INSERT INTO {tbl}"):
            skipped_inserts[tbl] += 1
            skip = True
            break
    if not skip:
        filtered_lines.append(line)

Path("$PATCHED").write_text("".join(filtered_lines), encoding="utf-8")

# 통계
table_count = len(re.findall(r"^CREATE TABLE \w+ \(", src, re.MULTILINE))
index_count = len(re.findall(r"^CREATE (UNIQUE )?INDEX \w+ ", src, re.MULTILINE))
print(f"   tables={table_count} indexes={index_count} → DROP IF EXISTS 주입")
for tbl, n in skipped_inserts.items():
    if n:
        print(f"   skipped: {tbl} (INSERT {n}건 제외 — cache는 fallback 동작)")
EOF

echo "🌀 로컬 D1로 import..."
pnpm exec wrangler d1 execute jusik101-companies --local --file="$PATCHED"

echo "✅ 완료. 로컬 D1 검증:"
pnpm exec wrangler d1 execute jusik101-companies --local \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name" \
  --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data[0]['results'] if isinstance(data, list) else data.get('results', [])
print('   tables:', ', '.join(r['name'] for r in results))
"
