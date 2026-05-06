/**
 * 미국 분기 시계열 변환 — us_financials_quarterly D1 row → QuarterlyDataPoint
 *
 * 한국과 다른 점:
 *   - 누적 차감 안 함 (us_financials_quarterly가 이미 분기 단독값 — Step 2 검증 결과)
 *   - SEC가 fiscal_year 기준으로 row 채움 (Apple FY2026 Q2 = 2025-12 ~ 2026-03)
 *   - 라벨은 period_end의 캘린더 연/월 사용 (재무 데이터 시간 일관성을 위해)
 */

import type { QuarterlyDataPoint } from './quarterly-utils';
import type { UsFinancialRow } from './us-data-loader';

/**
 * us_financials_quarterly rows → QuarterlyDataPoint[]
 *
 * 입력은 보통 최신 → 과거 순. 출력은 시간순 (오래된 → 최신, 차트용).
 *
 * @param maxQuarters 최대 분기 (디폴트 12)
 */
export function buildUsQuarterlySeries(
  rows: readonly UsFinancialRow[],
  maxQuarters: number = 12,
): readonly QuarterlyDataPoint[] {
  // 시간순 (오래된 → 최신)
  const sorted = [...rows].sort((a, b) =>
    a.period_end.localeCompare(b.period_end),
  );
  // 최근 N개만
  const trimmed = sorted.slice(-maxQuarters);

  return trimmed.map((r) => {
    const calendarYear = parseInt(r.period_end.slice(0, 4), 10);
    const calendarMonth = parseInt(r.period_end.slice(5, 7), 10);
    // 캘린더 분기 (3,6,9,12 끝)
    const calendarQuarter = (Math.ceil(calendarMonth / 3) || 1) as
      | 1
      | 2
      | 3
      | 4;

    const margin = (n: number | null, d: number | null): number | null => {
      if (!n || !d || d === 0) return null;
      const v = (n / d) * 100;
      return Number.isFinite(v) ? Number(v.toFixed(2)) : null;
    };

    return {
      year: calendarYear,
      quarter: calendarQuarter,
      label: `${String(calendarYear).slice(2)}년 ${calendarMonth}월`,
      revenue: r.revenue,
      operatingProfit: r.operating_income,
      netIncome: r.net_income,
      totalAssets: r.total_assets,
      totalLiabilities: r.total_liabilities,
      totalEquity: r.total_equity,
      netMargin: margin(r.net_income, r.revenue),
      operatingMargin: margin(r.operating_income, r.revenue),
      debtRatio: margin(r.total_liabilities, r.total_equity),
    };
  });
}

/**
 * 가장 최근 분기에서 TTM (Trailing Twelve Months) 계산.
 *
 * 직전 4개 분기 합 — PER/PSR 같은 가치평가 비율 계산용.
 *
 * @returns { ttmRevenue, ttmNetIncome } — 4개 분기 다 있으면 합, 없으면 null
 */
export function calculateTtm(rows: readonly UsFinancialRow[]): {
  readonly ttmRevenue: number | null;
  readonly ttmNetIncome: number | null;
  readonly latestPeriodEnd: string | null;
} {
  if (rows.length < 4) {
    return { ttmRevenue: null, ttmNetIncome: null, latestPeriodEnd: null };
  }
  // 최신 4개 (입력은 보통 DESC)
  const sortedDesc = [...rows].sort((a, b) =>
    b.period_end.localeCompare(a.period_end),
  );
  const last4 = sortedDesc.slice(0, 4);

  const sumOf = (
    accessor: (r: UsFinancialRow) => number | null,
  ): number | null => {
    let sum = 0;
    for (const r of last4) {
      const v = accessor(r);
      if (v === null || v === undefined) return null; // 1개라도 빠지면 TTM 무효
      sum += v;
    }
    return sum;
  };

  return {
    ttmRevenue: sumOf((r) => r.revenue),
    ttmNetIncome: sumOf((r) => r.net_income),
    latestPeriodEnd: last4[0]?.period_end ?? null,
  };
}
