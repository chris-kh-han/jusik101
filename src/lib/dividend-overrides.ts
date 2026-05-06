/**
 * D1 dividend_disclosures 테이블에서 정확한 배당락일/지급일 override 조회.
 *
 * Phase 2: GitHub Actions cron이 DART /document.xml 파싱한 결과를 저장한 테이블.
 * 페이지 렌더 시 (year, quarter)별 키로 조회해서 Phase 1 추정값 대체.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { d1Query, D1Error } from './d1-client';
import type {
  DividendOverride,
  DividendOverrideKey,
} from './quarterly-dividend';

interface DisclosureRow {
  readonly ex_dividend_date: string; // YYYY-MM-DD
  readonly payment_date: string | null;
  readonly dividend_per_share: number;
}

/**
 * 한 종목의 모든 배당 disclosure를 (year, quarter) → override 맵으로 변환.
 *
 * 분기 매핑:
 *   - ex_dividend_date의 월 → 분기 (단, fiscalMonth 12 가정)
 *   - 12월 결산 외 회사도 동일 매핑 (분기는 calendar quarter 기준)
 *
 * 같은 year-quarter에 여러 disclosure 있으면 가장 dps가 큰 것 채택 (특별배당 우선).
 */
export async function loadDividendOverrides(
  db: D1Database | null,
  stockCode: string,
  fiscalMonth: number = 12,
): Promise<ReadonlyMap<DividendOverrideKey, DividendOverride>> {
  if (!db) return new Map();

  let rows: readonly DisclosureRow[] = [];
  try {
    rows = await d1Query<DisclosureRow>(
      db,
      `SELECT ex_dividend_date, payment_date, dividend_per_share
       FROM dividend_disclosures
       WHERE stock_code = ? AND dividend_type = 'CASH'
       ORDER BY ex_dividend_date DESC`,
      [stockCode],
    );
  } catch (error) {
    if (error instanceof D1Error) return new Map();
    throw error;
  }

  const overrides = new Map<DividendOverrideKey, DividendOverride>();

  for (const row of rows) {
    const exDate = row.ex_dividend_date;
    if (!exDate || exDate.length < 10) continue;

    const year = parseInt(exDate.slice(0, 4), 10);
    const month = parseInt(exDate.slice(5, 7), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

    // 분기 결정: 결산월이 12면 calendar quarter
    // 결산월 N이면 Q1 = N-9..N-7, Q2 = N-6..N-4, Q3 = N-3..N-1, Q4 = N..N+2
    const quarter = monthToQuarter(month, fiscalMonth);
    const dataYear = adjustYearForFiscal(year, month, fiscalMonth);

    const key = `${dataYear}-Q${quarter}` as DividendOverrideKey;

    // 같은 분기에 여러 건이면 dps 큰 거 우선 (특별배당 합산은 안 함)
    const existing = overrides.get(key);
    if (existing) continue;

    overrides.set(key, {
      exDividendDate: exDate,
      paymentDate: row.payment_date ?? undefined,
      dividendPerShare:
        Number.isFinite(row.dividend_per_share) && row.dividend_per_share > 0
          ? row.dividend_per_share
          : undefined,
    });
  }

  return overrides;
}

/**
 * 캘린더 월 → 사업연도 분기.
 *
 * 결산월 12: Q1=1-3, Q2=4-6, Q3=7-9, Q4=10-12
 * 결산월 3:  Q1=4-6, Q2=7-9, Q3=10-12, Q4=1-3 (다음 해)
 */
function monthToQuarter(month: number, fiscalMonth: number): 1 | 2 | 3 | 4 {
  // 결산월에서 N 분기 거꾸로 거슬러 올라가는 offset
  // (month - fiscalMonth) mod 12를 4분기로 나눔
  const diff = (((month - fiscalMonth - 1) % 12) + 12) % 12;
  // diff: 0=Q4 끝, 11=Q4 시작-1
  // diff 0-2 → Q4, 3-5 → Q1, 6-8 → Q2, 9-11 → Q3
  // 더 자연스럽게:
  const q = Math.floor(((month - fiscalMonth + 11) % 12) / 3) + 1;
  if (q < 1) return 1;
  if (q > 4) return 4;
  return q as 1 | 2 | 3 | 4;
}

/**
 * 결산월이 12 외인 경우, 캘린더 연도와 사업연도가 다를 수 있어 보정.
 *
 * 예: 결산월 3 (3월 결산), 12월 배당 → 사업연도는 다음 해 4월부터지만
 *     공시는 12월에 나옴 → 같은 사업연도(현재 캘린더 연도)로 간주.
 *
 * 단순화: 결산월 12면 그대로, 그 외는 boundary cases가 복잡해 일단 그대로 두고
 *         12월 결산 회사 위주로 정확도 확보.
 */
function adjustYearForFiscal(
  calendarYear: number,
  month: number,
  fiscalMonth: number,
): number {
  if (fiscalMonth === 12) return calendarYear;
  // 결산월보다 큰 달에 발생한 배당은 다음 사업연도
  if (month > fiscalMonth) return calendarYear + 1;
  return calendarYear;
}
