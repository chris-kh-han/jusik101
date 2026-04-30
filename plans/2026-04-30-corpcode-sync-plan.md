# 2026-04-30 국장+미장 종목 자동 동기화 시스템 (Cloudflare 풀스택)

> **변경 이력**: 초기 D1+Vercel Cron → Vercel Blob 검토 → 최종 **Cloudflare 풀스택 + GitHub Actions Public** 결정 (2026-04-30)

## Context

**문제**:
- 현재 `src/data/companies.json`에 정적 41개 한국 기업만 검색 가능
- 미국 주식까지 확장 계획 (SEC EDGAR)
- Vercel Hobby는 상업적 사용 금지 → 수익화 시 이전 부담
- 무료로 최대한 운영하면서 학습 가치도 챙기고 포트폴리오로도 활용하고 싶음

**해결**: **Cloudflare 풀스택** + **GitHub Actions Public repo**로 100% 무료 + 상업적 사용 OK + 글로벌 엣지 인프라 + 포트폴리오 공개

**의도된 결과**:
- 한국 상장사 2,500+ 검색 가능 (미국 주식은 별도 플랜)
- 신규 상장 자동 반영 (주 1회 sync)
- **인프라 비용 0원** (수익화 후에도)
- **상업적 사용 OK** (광고/유료화 가능)
- 학습 가치: Cloudflare Workers, Pages, D1, KV, GitHub Actions 종합 경험
- 포트폴리오로 활용 (Public repo)

---

## Stack

```
Frontend:        Cloudflare Pages (Next.js + @cloudflare/next-on-pages)
Backend (API):   Cloudflare Pages Functions (Edge Runtime)
Storage:         Cloudflare D1 (SQLite, 5GB 무료)
Cron Scheduler:  GitHub Actions (Public repo, 무제한 분)
Secret 관리:      GitHub Secrets + Cloudflare Workers Secrets
모니터링:         Cloudflare Analytics + GitHub Actions logs
```

---

## Scope

✅ **이 플랜의 범위**:
- 한국 상장사 corpCode 동기화 (DART)
- D1 마이그레이션 (정적 JSON → SQLite)
- 검색 API D1 연동
- Cloudflare Pages 배포
- GitHub Actions 주간 sync
- Public repo 보안 강화

❌ **별도 플랜으로 분리**:
- 미국 주식 (SEC EDGAR) — corpCode 안정화 후
- 재무제표 데이터 캐싱
- 사용자 인증/즐겨찾기
- 광고/수익화 통합

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              GitHub (Public Repo)                    │
│  - jusik101 코드                                     │
│  - GitHub Actions cron 매주 월 03:00 UTC             │
│  - GitHub Secrets: CRON_SECRET                       │
│  - Secret Protection + Push Protection 활성화         │
└──────────────────┬───────────────────────────────────┘
                   │ HTTPS POST (Authorization: Bearer)
                   ▼
┌──────────────────────────────────────────────────────┐
│        Cloudflare Pages Functions                    │
│  POST /api/sync/companies                            │
│   1. CRON_SECRET 검증                                │
│   2. OpenDART corpCode.xml 다운로드                  │
│   3. ZIP 풀고 XML 파싱 (jszip + fast-xml-parser)     │
│   4. 상장사 필터 + Zod 검증                          │
│   5. D1 트랜잭션 UPSERT (배치 1,000개)               │
└──────────────────┬───────────────────────────────────┘
                   │ D1 binding (env.DB)
                   ▼
┌──────────────────────────────────────────────────────┐
│       Cloudflare D1 (jusik101-companies)             │
│  companies (corp_code PK + 인덱스)                   │
└──────────────────┬───────────────────────────────────┘
                   │ D1 binding
                   ▲
┌──────────────────────────────────────────────────────┐
│        Cloudflare Pages (Frontend)                   │
│  GET /api/search?q=...                               │
│   → D1 LIKE 쿼리 + 점수화 → 상위 10개                │
│  Server Components / Client Components 정상 동작      │
└──────────────────────────────────────────────────────┘
```

---

## Critical Compatibility Notes

### Next.js 16 + Cloudflare Pages

**호환 (이 프로젝트 동작 OK)**:
- App Router ✅
- Server Components ✅
- API Routes ✅ (Edge runtime으로 변환)
- Dynamic routes `[code]` ✅
- `next/font` ✅
- Recharts (클라이언트) ✅

**제약 (현재 안 씀, 추후 도입 시 검토)**:
- Image Optimization ❌ (현재 안 씀)
- ISR with revalidate ⚠️ (현재 안 씀)
- Middleware ⚠️ (현재 안 씀)
- Node.js APIs (`fs`, `child_process`) ❌

**필수 어댑터**: `@cloudflare/next-on-pages`

---

## Implementation Steps (14단계)

### Step 1: GitHub repo Public 전환

**사전 점검** (모두 통과해야 함):
```bash
git ls-files | grep -E "\.env"                                  # 출력 없어야
git log --all -p 2>/dev/null | grep -iE "(api_key|secret).*=.*[a-zA-Z0-9]{16,}"  # 출력 없어야
cat .gitignore | grep -E "\.env"                                # .env* 있어야
gitleaks detect --source . --verbose                            # no leaks found
```

→ 통과 시 Settings > Danger Zone > Change visibility > Public

### Step 2: GitHub Secret Protection + Pre-commit Hook

- **Secret Protection** Enable (Code security & analysis 페이지)
- **Push Protection** Enable
- **gitleaks** brew 설치
- `.git/hooks/pre-commit` 파일 생성 (gitleaks protect --staged)
- chmod +x

### Step 3: Cloudflare 계정 생성

- https://dash.cloudflare.com/sign-up
- 대시보드에서 Workers & Pages, D1 메뉴 확인

### Step 4: Wrangler CLI + 의존성

```bash
pnpm add -D wrangler @cloudflare/workers-types @cloudflare/next-on-pages
pnpm exec wrangler login
pnpm exec wrangler whoami  # 검증
```

### Step 5: D1 데이터베이스 생성

```bash
pnpm exec wrangler d1 create jusik101-companies
# database_id 보관
```

### Step 6: 마이그레이션 스키마 작성 + 실행

**`migrations/0001_companies.sql`**:
```sql
CREATE TABLE companies (
  corp_code     TEXT PRIMARY KEY,
  corp_name     TEXT NOT NULL,
  stock_code    TEXT,
  listed_market TEXT,
  modify_date   TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_companies_name ON companies(corp_name);
CREATE INDEX idx_companies_stock ON companies(stock_code) WHERE stock_code IS NOT NULL;
CREATE INDEX idx_companies_market ON companies(listed_market);
```

```bash
pnpm exec wrangler d1 execute jusik101-companies --remote --file=migrations/0001_companies.sql
```

### Step 7: wrangler.toml + Next.js 설정

**`wrangler.toml`**:
```toml
name = "jusik101"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"

[[d1_databases]]
binding = "DB"
database_name = "jusik101-companies"
database_id = "<step-5-id>"
```

**`package.json`** scripts 추가:
- `pages:build`, `pages:dev`, `pages:deploy`

**`next.config.ts`** Cloudflare 호환 설정

### Step 8: 로컬 Cloudflare Pages 동작 검증

```bash
pnpm pages:build
pnpm pages:dev
# http://localhost:8788 접속, 기존 페이지 정상 렌더 확인
```

→ 호환성 문제 발생 시 여기서 발견하고 대응

### Step 9: D1 클라이언트 작성

**신규 파일**: `src/lib/d1-client.ts`
- Pages Functions 환경: `env.DB` 직접 사용
- 함수: `d1Query<T>(env, sql, params)`, `d1Batch(env, statements)`
- `D1Error` 클래스 (기존 `DartApiError` 패턴 재사용)

### Step 10: Sync 라우트 작성

**신규 파일**: `src/app/api/sync/companies/route.ts`
- `export const runtime = 'edge'`
- `Authorization: Bearer ${CRON_SECRET}` 검증
- OpenDART corpCode.xml 다운로드
- jszip + fast-xml-parser
- 상장사 필터 + Zod 검증
- D1 배치 UPSERT (1,000개씩)

```bash
pnpm add jszip fast-xml-parser
```

### Step 11: 검색 API D1 연동

**신규 파일**: `src/lib/company-search-d1.ts`
- D1 LIKE 쿼리 (정확/접두/부분) UNION + ORDER BY score
- 기존 `getMatchScore()` 로직 재사용

**수정**: `src/app/api/search/route.ts`
- D1 검색으로 전환
- 실패 시 정적 JSON fallback

**신규 파일**: `src/lib/popular-companies.ts`
- 12개 stockCode 하드코딩 → D1에서 corp_name 조회

**수정**: `src/components/search/PopularCompanies.tsx`
- Server Component로 변환

### Step 12: Cloudflare Pages 배포

```bash
pnpm exec wrangler pages secret put DART_API_KEY
pnpm exec wrangler pages secret put CRON_SECRET
pnpm pages:deploy
# https://jusik101.pages.dev 배포 확인
```

### Step 13: GitHub Actions Cron 설정

**신규 파일**: `.github/workflows/sync-companies.yml`
```yaml
name: Sync Companies (Weekly)
on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://jusik101.pages.dev/api/sync/companies \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -f --max-time 120
```

**GitHub Secrets**: `CRON_SECRET` 추가

### Step 14: 초기 시드 + E2E 테스트

```bash
# 수동 sync
curl -X POST https://jusik101.pages.dev/api/sync/companies \
  -H "Authorization: Bearer ${CRON_SECRET}"

# D1 확인
pnpm exec wrangler d1 execute jusik101-companies --remote \
  --command="SELECT COUNT(*) FROM companies"

# 검색 테스트
curl "https://jusik101.pages.dev/api/search?q=현대"
```

---

## Critical Files

| 파일 | 변경 종류 |
|---|---|
| `wrangler.toml` | 신규 |
| `migrations/0001_companies.sql` | 신규 |
| `src/lib/d1-client.ts` | 신규 |
| `src/app/api/sync/companies/route.ts` | 신규 (Edge runtime) |
| `src/lib/company-search-d1.ts` | 신규 |
| `src/lib/popular-companies.ts` | 신규 |
| `src/app/api/search/route.ts` | 수정 (D1 + Edge) |
| `src/components/search/PopularCompanies.tsx` | 수정 |
| `next.config.ts` | 수정 (Cloudflare 호환) |
| `package.json` | 수정 (deps + scripts) |
| `.github/workflows/sync-companies.yml` | 신규 |
| `.gitignore` | 검증 (.env, .wrangler 포함) |
| `.env.example` | 수정 |
| `.git/hooks/pre-commit` | 신규 (gitleaks) |

---

## Reused Utilities

- **`src/lib/dart-api.ts:25` `dartFetch<T>()`** — fetch 패턴 (Edge runtime 호환)
- **`src/lib/dart-api.ts:74` `DartApiError`** — 에러 패턴 → `D1Error` 따라서
- **`src/lib/company-search.ts:17` `getMatchScore()`** — 점수화 로직 그대로
- **기존 Zod 스키마** — `src/app/api/search/route.ts` 검증 패턴

---

## Security Considerations

1. **Public repo secret 관리 (3중 방어)**:
   - 로컬: gitleaks pre-commit hook
   - GitHub: Push Protection (commit 차단)
   - GitHub: Secret Scanning (사후 알림)

2. **인증 토큰 절대 commit 금지**:
   - GitHub Actions → GitHub Secrets만
   - Cloudflare Workers Secrets (wrangler secret put)
   - 절대 코드/config 파일에 하드코딩 ❌

3. **CRON_SECRET**:
   - 32자 이상 랜덤 (`openssl rand -hex 32`)
   - GitHub Actions → Cloudflare Pages 호출 시 검증

4. **Cloudflare API 토큰 권한 최소화**:
   - D1:Edit, Pages:Edit만

5. **SQL Injection 방지**:
   - D1 prepared statements 강제

---

## Verification

### 단계별 검증
- **Step 1-2**: `git log` 깔끔 + gitleaks/Secret Protection/Push Protection 활성
- **Step 3-5**: `wrangler whoami` + `wrangler d1 list` 확인
- **Step 6**: `SELECT name FROM sqlite_master` 으로 테이블 확인
- **Step 7-8**: `pnpm pages:dev` 로컬 동작 (호환성 검증 포인트)
- **Step 9-11**: `curl /api/search?q=삼성` 로컬 응답 확인
- **Step 12**: 프로덕션 URL 메인 페이지 정상
- **Step 13**: GitHub Actions `workflow_dispatch` 수동 실행 통과
- **Step 14**: D1에 2,500+ 행, 검색 결과 정상

### End-to-End
1. https://jusik101.pages.dev 접속
2. "현대" 검색 → 현대자동차/모비스/건설/제철 등 표시
3. "현대자동차" 클릭 → /company/00164742 페이지 정상
4. 재무 데이터 표시
5. 모바일 반응형

### 회귀 테스트
- 기존 41개 기업 검색 동일하거나 더 많이
- `/company/[code]` 정상
- 인기 기업 12개 표시
- 모바일 반응형

---

## Risks & Mitigations

| 위험 | 완화책 |
|---|---|
| Public repo secret 노출 | 3중 방어선 (gitleaks + Push Protection + Secret Scanning) |
| Cloudflare Pages + Next.js 호환성 | Step 8 로컬 검증에서 조기 발견 |
| D1 연결 실패 시 검색 다운 | 정적 JSON fallback 유지 |
| 다음 주 cron 안 도는 경우 | `workflow_dispatch` 수동 백업 |
| Edge runtime Node.js 제약 | sync 라우트에서 fetch만 사용 |
| 마이그레이션 실수 | 매 변경 전 `wrangler d1 backup create` |

---

## Cost Projection

| 사용량 | 총 비용 |
|---|---|
| 사용자 1,000명 | $0 |
| 사용자 10,000명 | $0 |
| 사용자 100,000명 | $0 |
| 사용자 1,000,000명 | $0 ~ $5 |

수익화 가능 (광고 OK), 무료 한도 매우 넉넉.

---

## Progress Tracking

- [x] **Step 1**: GitHub Public 전환 + 사전 점검
- [x] **Step 2**: gitleaks + Secret/Push Protection
- [ ] **Step 3**: Cloudflare 계정 생성
- [ ] **Step 4**: Wrangler CLI 설치
- [ ] **Step 5**: D1 DB 생성
- [ ] **Step 6**: 마이그레이션 SQL
- [ ] **Step 7**: wrangler.toml + Next.js 설정
- [ ] **Step 8**: 로컬 Cloudflare Pages 검증 ⚠️ 호환성 체크포인트
- [ ] **Step 9**: D1 클라이언트
- [ ] **Step 10**: Sync 라우트
- [ ] **Step 11**: 검색 API D1 연동
- [ ] **Step 12**: Cloudflare Pages 배포
- [ ] **Step 13**: GitHub Actions cron
- [ ] **Step 14**: 초기 시드 + E2E 테스트

---

## Next Steps After This Plan

- 미국 주식 (SEC EDGAR) — 별도 sync route + tickers 테이블
- 재무제표 D1 캐싱 — DART/SEC API 절약
- 검색 FTS5 — 한글 형태소 검색
- 광고 통합 (Google AdSense, Carbon Ads)
- 사용자 인증 (Cloudflare Access 또는 자체 OAuth)
- 즐겨찾기 기능
- n8n 통합 — Slack 알림, 다른 자동화
