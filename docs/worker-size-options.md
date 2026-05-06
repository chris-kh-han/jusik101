# Cloudflare Worker 사이즈 한도 — 옵션 비교

> 2026-05-06 기록 — `/us/[ticker]` 추가 후 worker 한도 (3 MiB / 무료 plan) 초과.
> 현재는 **옵션 B (dynamic import)** 적용 중. 추후 다른 옵션 필요 시 참고.

## 문제

Cloudflare Pages 배포 시:
```
Failed to publish your Function. Got error: Your Worker exceeded the size
limit of 3 MiB. Please upgrade to a paid plan to deploy Workers up to 10 MiB.
```

**Free plan**: 3 MiB per Worker (compressed)
**Paid plan**: 10 MiB per Worker

배포 시점 worker bundle 크기 (raw, gzip 전):
| Worker | 크기 |
|---|---|
| `/company/[code]` | 2.2 MB |
| `/` | 1.8 MB |
| `/us/[ticker]` | 1.7 MB |
| `/api/search` | 1.1 MB |

원인: **Recharts 라이브러리** (~600 KB minified)가 차트를 쓰는 페이지마다 worker bundle에 들어감.

## 옵션

### A. Cloudflare Workers Paid plan ($5/월)

**장점**
- 즉시 해결 (한도 10 MiB로 상향)
- 코드 변경 없음
- 차트 라이브러리 자유롭게 추가 가능

**단점**
- 월 $5 비용
- 단순히 한도만 높이는 거라 근본적 해결 X — 추후 다시 초과 가능

**적용 방법**: Cloudflare Dashboard → Workers → Plans → Workers Paid

---

### B. `next/dynamic`으로 차트 lazy load *(현재 적용)*

**장점**
- 비용 0
- 차트 코드를 client bundle로 분리 → server worker 크기 감소
- Next.js 표준 패턴

**단점**
- 페이지 진입 시 차트 영역 잠깐 비어있음 (loading 상태)
- 'use client' 컴포넌트 wrapping 필요
- `ssr: false` 사용 시 SEO에서 차트 영역 비어있음 (재무지표 페이지엔 영향 적음)

**적용 코드**

```tsx
import dynamic from 'next/dynamic';

const DividendHistorySection = dynamic(
  () => import('@/components/dashboard/DividendHistorySection')
    .then(m => ({ default: m.DividendHistorySection })),
);

const QuarterlyBarLineChart = dynamic(
  () => import('@/components/charts/QuarterlyBarLineChart')
    .then(m => ({ default: m.QuarterlyBarLineChart })),
);
```

**적용 대상**
- `src/app/company/[code]/page.tsx`
- `src/app/us/[ticker]/page.tsx`
- 차트가 들어가는 모든 페이지

---

### C. Recharts 대체 — 가벼운 차트 라이브러리

**장점**
- worker bundle 크기 영구 감소
- 차트 추가해도 한도 안 넘음
- 비용 0

**단점**
- 모든 차트 컴포넌트 재작성 필요 (2~3시간)
- API 다르므로 prop 인터페이스 변경
- 디자인 일관성 다시 맞춰야 함

**후보 라이브러리**

| 라이브러리 | 사이즈 (gzipped) | 특징 |
|---|---|---|
| **Recharts** (현재) | ~75 KB | 사용 중, 풍부한 컴포넌트 |
| **`@nivo/bar` + `@nivo/line`** | 30~40 KB/chart | 모듈화 우수, 모던 |
| **Visx** (Airbnb) | 가변 (필요한 것만) | 가장 작음, 컴포넌트 직접 조립 |
| **Chart.js + react-chartjs-2** | ~40 KB | 안정적, 캔버스 기반 |
| **순수 SVG (자체 구현)** | 0 KB | 완전 제어, 작업 양 큼 |

추천 후보: **Visx** — 필요한 부분만 가져오는 모듈식. tree-shake 잘됨.

---

### D. `/us/[ticker]` 차트 없는 MVP

**장점**
- 즉시 배포 가능
- 코드 변경 최소

**단점**
- ❌ 사용자 룰 위반 ("FULLY FUNCTIONAL and FULLY EXTENSIBLE")
- 차트 없으면 페이지 가치 크게 감소 (토스 스타일 핵심)

**채택 X**.

---

### E. 페이지 단위 split (별도 worker)

**장점**
- 각 페이지가 독립 worker → 서로 간섭 없음

**단점**
- Cloudflare Pages는 단일 worker 모델 — 분리 어려움
- next-on-pages가 자동 분리 못 함
- Cloudflare Workers Multi-Worker 직접 구성 필요 (Pages 안 씀)

**비추**.

---

### F. Recharts tree-shaking 강화

**장점**
- 코드 변경 작음
- Recharts 유지

**단점**
- Recharts는 ESM tree-shaking이 잘 안 되는 라이브러리로 알려짐
- Babel/SWC로 부분 import 해도 큰 효과 없음 가능

**가성비 낮음**.

---

## 결정 매트릭스

| 우선순위 | 추천 |
|---|---|
| 비용 무료 + 빠른 적용 | **B (dynamic import)** ← 현재 |
| 비용 무료 + 영구 해결 | C (Visx 교체) |
| 시간 절약 / 5달러 OK | A (Paid plan) |

## 미래 트리거 — 옵션 변경 시점

- **A → 검토**: 더 복잡한 페이지 (실시간 차트, 분기 빠른 리렌더 등) 추가하면 dynamic import 부족
- **C → 검토**: B 적용 후에도 여전히 한도 가까움 / 새 차트 추가 어려움
- **현 방식 유지 OK**: 페이지 추가 시 **차트만 lazy import** 패턴 일관 적용
