/**
 * 미국 배당 시계열 변환 — us_dividends D1 row → QuarterlyDividendPoint[]
 *
 * 한국과 다른 점:
 *   - 누적 차감 없음 (us_dividends에 이미 분기 events 1행/1배당)
 *   - 정확한 ex_dividend_date 있음 (FDR Yahoo 출처는 100% 정확)
 *   - payment_date는 보통 NULL (Yahoo도 안 줌)
 *   - 'estimated' source 없음 — Yahoo든 EDGAR든 모두 정밀
 */

import type {
  DividendOverrideKey,
  QuarterlyDividendPoint,
  QuarterlyDividendSummary,
} from './quarterly-dividend';
import type { UsDividendRow } from './us-data-loader';

/**
 * 캘린더 월 → 분기 (1-12 → 1-4).
 * 미국은 12월 결산 회사 위주이므로 calendar quarter 그대로.
 */
function monthToQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

/**
 * us_dividends rows → QuarterlyDividendSummary
 *
 * @param rows D1 us_dividends (최신 → 과거)
 */
export function buildUsQuarterlyDividends(
  rows: readonly UsDividendRow[],
): QuarterlyDividendSummary {
  if (rows.length === 0) {
    return {
      points: [],
      totalDps: 0,
      yearsCovered: 0,
      fiscalMonth: 12,
      frequency: 0,
      months: [],
    };
  }

  // 시간순 (오래된 → 최신)
  const sorted = [...rows].sort((a, b) =>
    a.ex_dividend_date.localeCompare(b.ex_dividend_date),
  );

  const points: QuarterlyDividendPoint[] = [];
  for (const r of sorted) {
    const exDate = r.ex_dividend_date;
    if (!exDate || exDate.length < 10) continue;
    const year = parseInt(exDate.slice(0, 4), 10);
    const month = parseInt(exDate.slice(5, 7), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

    const quarter = monthToQuarter(month);

    points.push({
      year,
      quarter,
      // 미국 fiscal end는 분기 마지막 달 마지막 날 근사 (정확값 없음)
      fiscalEndDate: exDate, // ex_date 자체를 fiscal end로 (정확한 분기 그룹핑이 목적)
      exDividendDate: exDate,
      dividendPerShare: r.dividend_per_share,
      source: 'document', // 미국은 Yahoo/EDGAR 모두 정밀이라 'document' 표시
      paymentDate: r.payment_date ?? undefined,
    });
  }

  const totalDps = points.reduce((sum, p) => sum + p.dividendPerShare, 0);

  const years = new Set(points.map((p) => p.year));
  const lastYear = Math.max(...points.map((p) => p.year));
  const lastYearPoints = points.filter((p) => p.year === lastYear);
  const months = lastYearPoints
    .map((p) => parseInt(p.exDividendDate.slice(5, 7), 10))
    .sort((a, b) => a - b);

  return {
    points,
    totalDps: Number(totalDps.toFixed(4)),
    yearsCovered: years.size,
    fiscalMonth: 12,
    frequency: lastYearPoints.length,
    months,
  };
}

/** 사용 안 함 — 한국과 인터페이스 호환 위한 placeholder */
export type { DividendOverrideKey };
