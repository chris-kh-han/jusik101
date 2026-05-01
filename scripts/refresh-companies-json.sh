#!/bin/bash
# 프로덕션 D1 데이터를 src/data/companies.json으로 dump
# 사용법: pnpm refresh-companies
#
# 실행 시점:
#   - 신규 상장사 추가됐을 때 (보통 D1 sync 다음 날)
#   - 시가총액 정렬 갱신하고 싶을 때
#   - companies.json이 오래됐다고 느낄 때

set -euo pipefail

cd "$(dirname "$0")/.."

echo "🌀 Cloudflare D1에서 데이터 export..."

# D1에서 상장사 데이터 조회 (시총 큰 순)
pnpm exec wrangler d1 execute jusik101-companies --remote \
  --command="SELECT corp_code, corp_name, stock_code, listed_market, market_cap FROM companies WHERE stock_code IS NOT NULL ORDER BY market_cap DESC NULLS LAST" \
  --json > /tmp/d1_export_$$.json

echo "📝 JSON 변환 + companies.json 업데이트..."

python3 <<EOF
import json

with open('/tmp/d1_export_$$.json') as f:
    raw = json.load(f)

results = raw[0]['results'] if isinstance(raw, list) else raw.get('results', [])

out = []
for r in results:
    out.append({
        'corpCode': r['corp_code'],
        'corpName': r['corp_name'],
        'stockCode': r['stock_code'],
        'listedMarket': r.get('listed_market') or 'OTHER',
        'marketCap': r.get('market_cap'),
    })

content = json.dumps(out, ensure_ascii=False, indent=2)

# 기존 파일과 비교
import os
existing_count = 0
if os.path.exists('src/data/companies.json'):
    with open('src/data/companies.json') as f:
        existing = json.load(f)
        existing_count = len(existing)

with open('src/data/companies.json', 'w', encoding='utf-8') as f:
    f.write(content)

new_count = len(out)
diff = new_count - existing_count
arrow = "↑" if diff > 0 else ("↓" if diff < 0 else "=")

print(f"✅ {existing_count} → {new_count}개 ({arrow} {abs(diff)}개)")
print(f"   파일 크기: {len(content.encode()) / 1024:.1f} KB")
print(f"   상위 5개 (시총):")
for c in out[:5]:
    mc = c['marketCap']
    mc_str = f"{mc/1e12:.1f}조" if mc and mc >= 1e12 else (f"{mc/1e8:.0f}억" if mc else "NULL")
    print(f"     {c['corpName']:25} {c['stockCode']:8} {mc_str}")
EOF

rm -f /tmp/d1_export_$$.json

# git diff 확인
echo ""
echo "📊 변경 사항:"
git diff --stat src/data/companies.json || true

echo ""
echo "✨ 완료. 변경사항이 있으면 commit하세요:"
echo "   git add src/data/companies.json"
echo "   git commit -m 'chore: refresh companies.json from D1'"
