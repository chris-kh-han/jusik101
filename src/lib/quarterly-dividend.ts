/**
 * 분기 배당 데이터 추출 — DART /alotMatter 누적값을 분기별 단일값으로 변환.
 *
 * /alotMatter 응답에는 보고서 시점의 누적 dps가 들어있음:
 *   - 11013 (1분기): Q1 dps만
 *   - 11012 (반기):  Q1+Q2 누적
 *   - 11014 (3분기): Q1+Q2+Q3 누적
 *   - 11011 (사업):  연간 합계
 *
 * 분기별 단일값 = 누적 차감.
 */

import type { DartDividendItem } from './dart-api';

/** 한 분기 배당 이벤트 */
export interface QuarterlyDividendPoint {
  readonly year: number; // 사업연도
  readonly quarter: 1 | 2 | 3 | 4;
  /** 분기 결산일 YYYY-MM-DD (배당기준일과 거의 동일) */
  readonly fiscalEndDate: string;
  /** 배당락일 YYYY-MM-DD (estimated 또는 document 출처) */
  readonly exDividendDate: string;
  /** 1주당 배당금 (원) */
  readonly dividendPerShare: number;
  /** 데이터 출처 정밀도 */
  readonly source: 'estimated' | 'document';
  /** 배당지급일 YYYY-MM-DD (document에서 받았을 때만) */
  readonly paymentDate?: string;
}

/** 한 사업연도의 4개 reprt 응답 */
export interface YearlyDividendReports {
  readonly q1?: readonly DartDividendItem[]; // reprt 11013
  readonly h1?: readonly DartDividendItem[]; // reprt 11012
  readonly q3?: readonly DartDividendItem[]; // reprt 11014
  readonly fy?: readonly DartDividendItem[]; // reprt 11011
}

/** 한 사업연도의 분기별 dps (누적 차감 결과) */
export interface YearlyQuarterlyDps {
  readonly q1: number;
  readonly q2: number;
  readonly q3: number;
  readonly q4: number;
  readonly fiscalMonth: number; // 결산월 (1-12)
}

/** 보통주 "주당 현금배당금(원)" 라인의 thstrm 값 (없으면 0) */
function findCommonDps(items: readonly DartDividendItem[] | undefined): number {
  if (!items || items.length === 0) return 0;
  const item =
    items.find(
      (d) => d.se === '주당 현금배당금(원)' && d.stock_knd === '보통주',
    ) ?? items.find((d) => d.se === '주당 현금배당금(원)');
  if (!item || !item.thstrm || item.thstrm === '-') return 0;
  const n = Number(item.thstrm.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 결산월 추출 (없으면 12) */
function findFiscalMonth(
  items: readonly DartDividendItem[] | undefined,
): number {
  const stlm = items?.[0]?.stlm_dt ?? '';
  if (stlm.length < 7) return 12;
  const n = parseInt(stlm.slice(5, 7), 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 12;
}

/**
 * 4개 reprt 응답에서 분기별 단일 dps 추출 (누적 차감).
 *
 * 음수 결과는 0으로 보정 (보고서 누락/정정 케이스).
 */
export function buildQuarterlyDpsForYear(
  reports: YearlyDividendReports,
): YearlyQuarterlyDps {
  const fiscalMonth = findFiscalMonth(
    reports.fy ?? reports.q3 ?? reports.h1 ?? reports.q1,
  );

  const cum = {
    q1: findCommonDps(reports.q1),
    h1: findCommonDps(reports.h1),
    q3: findCommonDps(reports.q3),
    fy: findCommonDps(reports.fy),
  };

  return {
    q1: cum.q1,
    q2: Math.max(0, cum.h1 - cum.q1),
    q3: Math.max(0, cum.q3 - cum.h1),
    q4: Math.max(0, cum.fy - cum.q3),
    fiscalMonth,
  };
}

/**
 * 분기 결산일 (해당 분기 마지막 날, ISO 'YYYY-MM-DD').
 *
 * @example
 * fiscalQuarterEnd(2024, 1, 12) → '2024-03-31'
 * fiscalQuarterEnd(2024, 4, 12) → '2024-12-31'
 * fiscalQuarterEnd(2024, 1, 3)  → '2023-06-30' (3월 결산: Q1=4-6월)
 */
export function fiscalQuarterEnd(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  fiscalMonth: number = 12,
): string {
  // Q4 끝 = fiscalMonth, Q3 = fiscalMonth-3, Q2 = -6, Q1 = -9
  const offset = (quarter - 4) * 3 + fiscalMonth;
  // 음수면 전년도로
  const yearShift = Math.floor((offset - 1) / 12);
  const month = ((((offset - 1) % 12) + 12) % 12) + 1;
  const adjustedYear = year + yearShift;
  const lastDay = new Date(Date.UTC(adjustedYear, month, 0)).getUTCDate();
  return `${adjustedYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * 배당락일 추정 — 배당기준일(분기 결산일) 직전 영업일.
 *
 * 한국 주식 관례:
 *   - 12월 31일은 휴장 → 기준일이 12-31이면 마지막 거래일 = 12-30, 배당락일 = 12-29
 *   - 그 외 분기 마지막날: 그 직전 영업일
 *   - 주말이면 직전 금요일로 보정
 */
export function estimateExDividendDate(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  fiscalMonth: number = 12,
): string {
  const endStr = fiscalQuarterEnd(year, quarter, fiscalMonth);
  const [y, m, d] = endStr.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));

  // 12월 31일은 휴장 → 12-29 직전영업일 (12-30이 휴장이라기보단 거래일임, but 통상 배당락은 직전 거래일에서 또 하루 전)
  // 실제: 기준일 12-31이면 12-30 거래일, 배당락은 12-30이 됨. 우리는 안전하게 30일 우선.
  // 단, 토스 화면을 보면 "25년 12월 29일"로 표시 — 즉 직전 영업일 (12-30이 화요일이면 그 전일 12-29 월요일).
  // 통합 규칙: 기준일 - 1일, 그 후 주말이면 금요일로.
  if (m === 12 && d === 31) {
    // 폐장일이라 12-30이 마지막 거래일, 12-29가 배당락일
    date.setUTCDate(date.getUTCDate() - 2);
  } else {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  // 주말 → 금요일
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 분기 배당 시계열 + 요약 */
export interface QuarterlyDividendSummary {
  readonly points: readonly QuarterlyDividendPoint[]; // 시간순 (오래된 → 최신)
  readonly totalDps: number; // 표시 기간 합계 (원)
  readonly yearsCovered: number; // 데이터 있는 사업연도 수
  readonly fiscalMonth: number;
  /** 가장 최근 사업연도의 배당 횟수 (분기 배당 빈도 표시용) */
  readonly frequency: number;
  /** 가장 최근 사업연도의 배당락일 월 목록 (정렬됨) */
  readonly months: readonly number[];
}

/**
 * 정확한 배당락일/지급일 override 조회 키 (year-Q{n}).
 *
 * `dividend_disclosures` 테이블에서 받아온 정확한 날짜를 매핑할 때 사용.
 */
export type DividendOverrideKey = `${number}-Q${1 | 2 | 3 | 4}`;

export interface DividendOverride {
  readonly exDividendDate: string;
  readonly paymentDate?: string;
  /** alotMatter에 아직 안 잡힌 신규 분기를 위해 dps도 포함 가능 */
  readonly dividendPerShare?: number;
}

/**
 * 여러 년치 분기 dps + (선택) 정확한 날짜 override → 시계열 + 요약.
 */
export function summarizeQuarterlyDividends(
  byYear: ReadonlyMap<number, YearlyQuarterlyDps>,
  overrides?: ReadonlyMap<DividendOverrideKey, DividendOverride>,
): QuarterlyDividendSummary {
  const sorted = [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) {
    return {
      points: [],
      totalDps: 0,
      yearsCovered: 0,
      fiscalMonth: 12,
      frequency: 0,
      months: [],
    };
  }

  const fiscalMonth = sorted[0]![1].fiscalMonth;
  const points: QuarterlyDividendPoint[] = [];
  const seenKeys = new Set<DividendOverrideKey>();

  // 1) /alotMatter 기반 분기 (이미 누적값으로 dps 계산된 것)
  for (const [year, q] of sorted) {
    for (const [n, dps] of [
      [1, q.q1],
      [2, q.q2],
      [3, q.q3],
      [4, q.q4],
    ] as const) {
      if (dps <= 0) continue;
      const fiscalEnd = fiscalQuarterEnd(year, n, q.fiscalMonth);
      const overrideKey = `${year}-Q${n}` as DividendOverrideKey;
      const override = overrides?.get(overrideKey);
      seenKeys.add(overrideKey);
      points.push({
        year,
        quarter: n,
        fiscalEndDate: fiscalEnd,
        exDividendDate:
          override?.exDividendDate ??
          estimateExDividendDate(year, n, q.fiscalMonth),
        dividendPerShare: dps,
        source: override ? 'document' : 'estimated',
        paymentDate: override?.paymentDate,
      });
    }
  }

  // 2) /alotMatter에 아직 없지만 dividend_disclosures에는 있는 신규 분기
  //    (예: 사업보고서 미제출 시점의 직전 분기 — 토스가 빠르게 반영하는 케이스)
  if (overrides) {
    for (const [key, override] of overrides) {
      if (seenKeys.has(key)) continue;
      if (!override.dividendPerShare || override.dividendPerShare <= 0)
        continue;
      const [yearStr, qStr] = key.split('-Q');
      const year = parseInt(yearStr ?? '', 10);
      const quarter = parseInt(qStr ?? '', 10) as 1 | 2 | 3 | 4;
      if (
        !Number.isFinite(year) ||
        !(quarter === 1 || quarter === 2 || quarter === 3 || quarter === 4)
      ) {
        continue;
      }
      points.push({
        year,
        quarter,
        fiscalEndDate: fiscalQuarterEnd(year, quarter, fiscalMonth),
        exDividendDate: override.exDividendDate,
        dividendPerShare: override.dividendPerShare,
        source: 'document',
        paymentDate: override.paymentDate,
      });
    }
    // 새로 추가된 항목 포함해 시간순 재정렬
    points.sort((a, b) => a.exDividendDate.localeCompare(b.exDividendDate));
  }

  const totalDps = points.reduce((sum, p) => sum + p.dividendPerShare, 0);

  // 가장 최근 데이터 있는 사업연도
  const lastYearWithData = [...byYear.keys()].sort((a, b) => b - a)[0]!;
  const lastYearPoints = points.filter((p) => p.year === lastYearWithData);
  const frequency = lastYearPoints.length;
  const months = lastYearPoints
    .map((p) => parseInt(p.exDividendDate.slice(5, 7), 10))
    .sort((a, b) => a - b);

  return {
    points,
    totalDps,
    yearsCovered: sorted.length,
    fiscalMonth,
    frequency,
    months,
  };
}
