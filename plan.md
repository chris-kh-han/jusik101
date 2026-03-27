# 재무제표 간소화 웹 - Claude Code 개발 플랜

## 프로젝트 개요

**프로젝트명:** EasyFinance (가칭)
**목표:** DART 재무제표 데이터를 초보자도 쉽게 이해할 수 있도록 시각화하는 웹 서비스
**데이터 소스:** OpenDART API (무료, 상업적 이용 가능)

---

## Phase 1: 프로젝트 초기 세팅

### 1-1. 기술 스택 결정

```
Frontend: Next.js 14+ (App Router) + TypeScript
UI 라이브러리: Tailwind CSS + shadcn/ui
차트 라이브러리: Recharts 또는 Chart.js
Backend: Next.js API Routes (서버리스)
DB: Supabase (PostgreSQL) 또는 PlanetScale (MySQL)
배포: Vercel (무료 티어로 시작)
```

### 1-2. 프로젝트 생성

```bash
npx create-next-app@latest easyfinance --typescript --tailwind --app --src-dir
cd easyfinance
npx shadcn@latest init
npm install recharts axios
```

### 1-3. 폴더 구조

```
src/
├── app/
│   ├── page.tsx                    # 메인 (기업 검색)
│   ├── company/[code]/page.tsx     # 기업별 재무제표 대시보드
│   ├── api/
│   │   ├── search/route.ts         # 기업 검색 API
│   │   ├── financial/route.ts      # 재무제표 조회 API
│   │   └── sync/route.ts           # DART 데이터 동기화 (cron)
│   └── layout.tsx
├── components/
│   ├── SearchBar.tsx               # 기업 검색바
│   ├── BalanceSheet.tsx            # 재무상태표 시각화
│   ├── IncomeStatement.tsx         # 손익계산서 시각화
│   ├── CashFlow.tsx                # 현금흐름표 시각화
│   ├── FinancialHealth.tsx         # 재무 건전성 요약 카드
│   ├── SimpleExplainer.tsx         # 초보자용 설명 툴팁
│   └── charts/
│       ├── WaterfallChart.tsx      # 워터폴 차트 (손익)
│       ├── StackedBar.tsx          # 누적 막대 (자산/부채)
│       └── TrendLine.tsx           # 추세선 (연도별 비교)
├── lib/
│   ├── dart-api.ts                 # OpenDART API 래퍼
│   ├── data-transform.ts           # 데이터 가공/정규화
│   ├── financial-utils.ts          # 재무비율 계산 유틸
│   └── db.ts                       # DB 연결
├── types/
│   └── financial.ts                # TypeScript 타입 정의
└── constants/
    └── accounts.ts                 # 계정과목 한글 매핑/설명
```

---

## Phase 2: OpenDART API 연동

### 2-1. API 키 발급
- https://opendart.fss.or.kr 회원가입 (개인용)
- 인증키 신청 → 발급 (즉시~1일)
- `.env.local`에 저장

```env
DART_API_KEY=your_api_key_here
```

### 2-2. 핵심 API 엔드포인트

```typescript
// lib/dart-api.ts

const BASE_URL = 'https://opendart.fss.or.kr/api';

// 1. 기업 고유번호 조회 (corpCode.xml → 전체 기업 목록 ZIP)
// - 최초 1회 다운로드 후 DB 저장
GET `${BASE_URL}/corpCode.xml?crtfc_key=${API_KEY}`

// 2. 기업 개황 정보
GET `${BASE_URL}/company.json?crtfc_key=${API_KEY}&corp_code=${corpCode}`

// 3. 단일회사 전체 재무제표 ★ 핵심
GET `${BASE_URL}/fnlttSinglAcntAll.json?crtfc_key=${API_KEY}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011&fs_div=CFS`

// 4. 단일회사 주요 계정 (요약본)
GET `${BASE_URL}/fnlttSinglAcnt.json?crtfc_key=${API_KEY}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011&fs_div=CFS`

// reprt_code: 11011(사업보고서), 11012(반기), 11013(1분기), 11014(3분기)
// fs_div: CFS(연결), OFS(개별)
```

### 2-3. 데이터 캐싱 전략 (중요!)

```
유저 요청 → 자체 DB 확인 → 있으면 DB에서 응답
                           → 없으면 DART API 호출 → DB 저장 → 응답

+ Cron Job (매일 새벽): 주요 상장사 최신 데이터 자동 동기화
```

이렇게 하면 하루 10,000건 API 제한에 걸리지 않음.

---

## Phase 3: 데이터 가공 레이어

### 3-1. 원본 데이터 → 정규화

DART에서 오는 데이터는 계정과목명이 복잡함. 이걸 초보자용으로 매핑:

```typescript
// constants/accounts.ts

export const ACCOUNT_SIMPLE_NAMES: Record<string, {
  name: string;        // 쉬운 이름
  emoji: string;       // 시각적 아이콘
  description: string; // 초보자 설명
  category: string;    // 분류
}> = {
  "유동자산": {
    name: "바로 쓸 수 있는 돈",
    emoji: "💰",
    description: "1년 안에 현금으로 바꿀 수 있는 자산이에요. 현금, 예금, 재고 등이 포함돼요.",
    category: "자산"
  },
  "비유동자산": {
    name: "오래 가지고 있는 재산",
    emoji: "🏭",
    description: "공장, 건물, 특허처럼 오랫동안 보유하는 자산이에요.",
    category: "자산"
  },
  "유동부채": {
    name: "곧 갚아야 할 빚",
    emoji: "⏰",
    description: "1년 안에 갚아야 하는 부채예요.",
    category: "부채"
  },
  "매출액": {
    name: "총 판매금액",
    emoji: "🛒",
    description: "회사가 물건이나 서비스를 팔아서 번 전체 금액이에요.",
    category: "매출"
  },
  "영업이익": {
    name: "본업으로 남긴 돈",
    emoji: "✅",
    description: "매출에서 원가와 운영비를 빼고 남은 금액. 본업의 수익성을 보여줘요.",
    category: "이익"
  },
  "당기순이익": {
    name: "최종 순이익",
    emoji: "🏆",
    description: "세금, 이자 등 모든 비용을 빼고 최종적으로 남은 돈이에요.",
    category: "이익"
  },
  // ... 주요 계정과목 30~50개 매핑
};
```

### 3-2. 재무비율 자동 계산

```typescript
// lib/financial-utils.ts

export function calculateRatios(data: FinancialData) {
  return {
    // 수익성
    영업이익률: (data.영업이익 / data.매출액 * 100).toFixed(1),
    순이익률: (data.당기순이익 / data.매출액 * 100).toFixed(1),
    ROE: (data.당기순이익 / data.자본총계 * 100).toFixed(1),

    // 안정성
    부채비율: (data.부채총계 / data.자본총계 * 100).toFixed(1),
    유동비율: (data.유동자산 / data.유동부채 * 100).toFixed(1),

    // 성장성
    매출성장률: ((data.매출액 - data.전년매출액) / data.전년매출액 * 100).toFixed(1),
  };
}

// 재무 건강 점수 (초보자용 종합 점수)
export function getHealthScore(ratios: Ratios): {
  score: number;  // 0~100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
} { ... }
```

---

## Phase 4: UI/UX 구현

### 4-1. 메인 페이지 - 기업 검색

```
┌─────────────────────────────────────────┐
│                                         │
│       🔍 기업명 또는 종목코드 검색       │
│       [삼성전자, 005930 등...]           │
│                                         │
│   인기 검색: 삼성전자 | SK하이닉스 | LG  │
│                                         │
└─────────────────────────────────────────┘
```

### 4-2. 기업 대시보드 - 핵심 화면

```
┌─────────────────────────────────────────┐
│ 삼성전자 (005930)              2024년   │
├─────────────────────────────────────────┤
│                                         │
│  📊 재무 건강 점수: 82/100  [A등급]     │
│  "이 회사는 전반적으로 재무 상태가       │
│   양호합니다"                            │
│                                         │
├──────────┬──────────┬───────────────────┤
│ 💰 매출  │ ✅ 영업  │ 🏆 순이익         │
│ 302조    │  이익    │ 23조              │
│ ▲ 14%   │ 36조    │ ▼ 5%              │
│          │ ▲ 50%  │                     │
├──────────┴──────────┴───────────────────┤
│                                         │
│  [재무상태표] [손익계산서] [현금흐름표]   │
│                                         │
│  ┌─ 재무상태표 (쉬운 버전) ───────────┐ │
│  │                                    │ │
│  │  [자산 막대]  ████████████ 456조    │ │
│  │  [부채 막대]  ██████      123조     │ │
│  │  [자본 막대]  ████████    333조     │ │
│  │                                    │ │
│  │  💡 "자산 중 73%가 자기 돈(자본)   │ │
│  │     이에요. 빚 비율이 낮아서        │ │
│  │     재무가 안정적입니다"            │ │
│  │                                    │ │
│  └────────────────────────────────────┘ │
│                                         │
│  연도별 추세 (5년)                       │
│  ┌────────────────────────────────────┐ │
│  │  📈 라인 차트 (매출/영업이익/순이익) │ │
│  └────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### 4-3. 초보자 모드 vs 상세 모드

```
[🐣 쉬운 설명] [📊 상세 데이터]  ← 토글 스위치

쉬운 설명 모드:
- 계정과목을 쉬운 한글로 표시
- 각 항목에 말풍선 설명
- 자동 해석 코멘트
- 시각적 비유 (파이차트, 이모지 등)

상세 모드:
- 원래 계정과목명 표시
- 전체 숫자 표시
- 재무비율 테이블
- 원본 DART 링크
```

### 4-4. 핵심 시각화 컴포넌트

| 재무제표 | 차트 타입 | 설명 |
|---------|----------|------|
| 재무상태표 | 수평 스택 바 | 자산 = 부채 + 자본을 한눈에 |
| 손익계산서 | 워터폴 차트 | 매출 → 비용 → 영업이익 → 순이익 흐름 |
| 현금흐름표 | 3색 바 차트 | 영업/투자/재무 활동별 현금 흐름 |
| 연도별 추세 | 라인 차트 | 5개년 주요 지표 추이 |
| 재무 건강 | 게이지/레이더 | 종합 점수 및 항목별 평가 |

---

## Phase 5: DB 설계 (캐싱 + 확장)

### 5-1. 테이블 구조

```sql
-- 기업 기본 정보
CREATE TABLE companies (
  corp_code VARCHAR(8) PRIMARY KEY,    -- DART 고유번호
  stock_code VARCHAR(6),               -- 종목코드
  corp_name VARCHAR(100),              -- 기업명
  industry VARCHAR(50),                -- 업종
  listed_market VARCHAR(10),           -- KOSPI/KOSDAQ
  updated_at TIMESTAMP
);

-- 재무제표 데이터 (캐시)
CREATE TABLE financial_statements (
  id SERIAL PRIMARY KEY,
  corp_code VARCHAR(8),
  bsns_year INT,                       -- 사업연도
  reprt_code VARCHAR(5),               -- 보고서 구분
  fs_div VARCHAR(3),                   -- CFS/OFS
  account_name VARCHAR(200),           -- 계정과목명
  amount BIGINT,                       -- 당기금액
  amount_prev BIGINT,                  -- 전기금액
  fetched_at TIMESTAMP,
  UNIQUE(corp_code, bsns_year, reprt_code, fs_div, account_name)
);

-- 검색 로그 (인기 검색어용)
CREATE TABLE search_logs (
  id SERIAL PRIMARY KEY,
  corp_code VARCHAR(8),
  searched_at TIMESTAMP DEFAULT NOW()
);
```

---

## Phase 6: 배포 및 운영

### 6-1. 배포 환경

```
개발: localhost:3000
스테이징: Vercel Preview
프로덕션: Vercel (커스텀 도메인)

Vercel 무료 티어:
- 월 100GB 대역폭
- 서버리스 함수 실행 시간 제한 있음
- 개인 프로젝트 충분

DB:
- Supabase 무료 티어: 500MB, 50,000 rows
- 유저 늘어나면 Pro 플랜 ($25/월)
```

### 6-2. Cron Job 설정 (데이터 자동 동기화)

```
Vercel Cron 또는 외부 서비스 (예: GitHub Actions)
- 매일 새벽 3시: 주요 상장사 100개 최신 재무제표 동기화
- 분기별: 전체 상장사 데이터 갱신
```

### 6-3. 스케일업 로드맵

```
유저 0~100명:   개인 API 키 + Vercel 무료 + Supabase 무료
유저 100~1000:  기업 API 키 전환 + DB 캐싱 강화
유저 1000+:     Supabase Pro + Vercel Pro + CDN 최적화
유저 10000+:    자체 서버 또는 AWS 전환 검토
```

---

## 개발 순서 (Claude Code 작업 순서)

### Sprint 1: 기초 세팅 (Day 1~2)
```
□ Next.js 프로젝트 생성 + Tailwind + shadcn/ui 세팅
□ 폴더 구조 세팅
□ TypeScript 타입 정의
□ OpenDART API 래퍼 함수 작성
□ .env 설정
```

### Sprint 2: 데이터 레이어 (Day 3~4)
```
□ DART API 연동 (기업 검색, 재무제표 조회)
□ 데이터 정규화/변환 함수
□ 계정과목 한글 매핑 테이블
□ 재무비율 계산 유틸
□ Supabase 연동 + 캐싱 로직
```

### Sprint 3: UI 메인 (Day 5~7)
```
□ 메인 페이지 (검색바 + 인기 기업)
□ 기업 대시보드 레이아웃
□ 재무 건강 점수 카드
□ 핵심 지표 요약 카드 (매출/영업이익/순이익)
```

### Sprint 4: 차트 구현 (Day 8~10)
```
□ 재무상태표 시각화 (스택 바)
□ 손익계산서 시각화 (워터폴)
□ 현금흐름표 시각화 (바 차트)
□ 연도별 추세 라인 차트
□ 초보자 설명 툴팁 컴포넌트
```

### Sprint 5: 마무리 (Day 11~14)
```
□ 쉬운 모드 / 상세 모드 토글
□ 반응형 (모바일 대응)
□ SEO 메타 태그
□ 에러 핸들링 + 로딩 상태
□ Vercel 배포 + 도메인 연결
```

---

## Claude Code 프롬프트 예시

각 Sprint에서 Claude Code에 이렇게 요청하면 됩니다:

### Sprint 1 예시
```
"Next.js 14 App Router + TypeScript + Tailwind 프로젝트를 세팅해줘.
shadcn/ui 설치하고, 위 폴더 구조대로 디렉토리 만들어줘.
OpenDART API를 호출하는 래퍼 함수를 lib/dart-api.ts에 작성해줘.
기업 검색, 재무제표 조회 기능이 필요해."
```

### Sprint 3 예시
```
"메인 페이지에 기업 검색 기능을 만들어줘.
검색창에 기업명이나 종목코드를 입력하면
자동완성으로 기업 목록이 뜨고,
선택하면 /company/[code] 페이지로 이동하게 해줘.
디자인은 미니멀하고 깔끔하게."
```

### Sprint 4 예시
```
"재무상태표 데이터를 Recharts로 시각화해줘.
자산/부채/자본을 수평 스택 바 차트로 보여주고,
각 항목에 마우스를 올리면 쉬운 설명이 뜨는 툴팁을 넣어줘.
초보자가 '자산 = 부채 + 자본'을 직관적으로 이해할 수 있게."
```

---

## 참고 사이트 (디자인/기능 레퍼런스)

| 사이트 | 참고 포인트 |
|--------|------------|
| 네이버 금융 | 데이터 요약 방식, 연도별 비교 |
| 딥서치 (deepsearch.com) | 시각화 UI, 경쟁사 비교 |
| Visual Finance | 3D 재무제표 시각화 컨셉 |
| Toolz Square | 간단한 재무제표 생성기 UX |
| Flourish | 인터랙티브 차트 아이디어 |

---

## 주의사항

1. **OpenDART API 키를 프론트엔드에 노출하지 말 것** → 반드시 서버 사이드(API Routes)에서만 호출
2. **DART 데이터는 지연이 있을 수 있음** → 실시간 데이터가 아님을 유저에게 안내
3. **재무제표 해석은 투자 조언이 아님** → 면책 문구 필수
4. **저작권** → DART 데이터 자체는 자유롭게 사용 가능하나, 출처 표기 권장
