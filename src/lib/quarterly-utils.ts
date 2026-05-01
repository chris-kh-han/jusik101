/**
 * 분기별 재무 데이터 변환 유틸
 *
 * OpenDART의 분기/반기/3분기/사업보고서는 누적 데이터.
 * 단일 분기 매출 = 그 분기 누적 - 직전 분기 누적
 *
 * 보고서 코드:
 *   11013 = 1분기 (Q1, 누적 = Q1)
 *   11012 = 반기  (Q2, 누적 = Q1+Q2)
 *   11014 = 3분기 (Q3, 누적 = Q1+Q2+Q3)
 *   11011 = 사업  (Q4, 누적 = Q1+Q2+Q3+Q4)
 *
 * 단일 분기 추출:
 *   Q1 = 11013
 *   Q2 = 11012 - 11013
 *   Q3 = 11014 - 11012
 *   Q4 = 11011 - 11014
 *
 * 단, 손익계산서/현금흐름표만 누적. 재무상태표는 시점 데이터(스냅샷).
 */

import type { DartFinancialItem } from '@/types/financial';

/** 단일 분기 데이터 포인트 */
export interface QuarterlyDataPoint {
  /** 연도 (예: 2025) */
  readonly year: number;
  /** 분기 (1~4) */
  readonly quarter: 1 | 2 | 3 | 4;
  /** 표시용 라벨 (예: "25년 12월") */
  readonly label: string;

  // 손익계산서 (단일 분기, 차감으로 산출)
  readonly revenue: number | null;
  readonly operatingProfit: number | null;
  readonly netIncome: number | null;

  // 재무상태표 (시점 데이터, 그대로)
  readonly totalAssets: number | null;
  readonly totalLiabilities: number | null;
  readonly totalEquity: number | null;

  // 계산 필드
  readonly netMargin: number | null; // (순이익 / 매출) * 100
  readonly operatingMargin: number | null; // (영업이익 / 매출) * 100
  readonly debtRatio: number | null; // (부채 / 자본) * 100
}

/** 한 보고서 단위 — 누적 데이터 */
interface ReportData {
  readonly year: number;
  readonly reportCode: '11011' | '11012' | '11013' | '11014';
  readonly items: readonly DartFinancialItem[];
}

/** 보고서 코드 → 분기 매핑 (CUMULATIVE end quarter) */
const REPORT_TO_QUARTER: Record<ReportData['reportCode'], 1 | 2 | 3 | 4> = {
  '11013': 1, // 1분기 보고서 → Q1까지 누적
  '11012': 2, // 반기 보고서 → Q2까지 누적
  '11014': 3, // 3분기 보고서 → Q3까지 누적
  '11011': 4, // 사업보고서 → Q4까지 누적 (= 연간)
};

const QUARTER_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: '3월',
  2: '6월',
  3: '9월',
  4: '12월',
};

/** 안전한 숫자 파싱 ('' / '-' / null → null, 그 외는 parseInt) */
function parseAmount(raw: string | null | undefined): number | null {
  if (!raw || raw === '-' || raw === '') return null;
  const cleaned = raw.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 특정 account_nm 항목의 thstrm_amount 추출 */
function extractAmount(
  items: readonly DartFinancialItem[],
  accountName: string,
  sjDiv?: string,
): number | null {
  const item = items.find(
    (it) =>
      it.account_nm === accountName && (sjDiv ? it.sj_div === sjDiv : true),
  );
  return item ? parseAmount(item.thstrm_amount) : null;
}

/** 누적 손익계산서 항목 (사업보고서 전용 - bfefrmtrm으로 전전기 추출용) */
interface CumulativeIS {
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
}

function extractIS(items: readonly DartFinancialItem[]): CumulativeIS {
  return {
    revenue: extractAmount(items, '매출액', 'IS'),
    operatingProfit: extractAmount(items, '영업이익', 'IS'),
    netIncome: extractAmount(items, '당기순이익', 'IS'),
  };
}

/** 재무상태표 (시점 데이터 — 보고서 시점 그대로) */
interface BalanceSheet {
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
}

function extractBS(items: readonly DartFinancialItem[]): BalanceSheet {
  return {
    totalAssets: extractAmount(items, '자산총계', 'BS'),
    totalLiabilities: extractAmount(items, '부채총계', 'BS'),
    totalEquity: extractAmount(items, '자본총계', 'BS'),
  };
}

/** 차감 (양쪽 다 number여야 함, null이면 null) */
function subtract(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

/**
 * 보고서 묶음 → 단일 분기 시계열로 변환
 *
 * @param reports 같은 회사의 다년치 보고서들. 각 회사/연도/분기 조합당 1개.
 * @param maxQuarters 반환할 최대 분기 수 (기본 12 = 3년)
 * @returns 시간순 정렬된 분기 데이터 (오래된 → 최신)
 */
export function buildQuarterlySeries(
  reports: readonly ReportData[],
  maxQuarters = 12,
): readonly QuarterlyDataPoint[] {
  // 연/보고서 코드로 인덱싱
  const reportMap = new Map<string, ReportData>();
  for (const r of reports) {
    reportMap.set(`${r.year}-${r.reportCode}`, r);
  }

  // 모든 (연도, 분기) 조합 생성
  const points: QuarterlyDataPoint[] = [];
  const allYears = [...new Set(reports.map((r) => r.year))].sort();

  for (const year of allYears) {
    const q1Report = reportMap.get(`${year}-11013`);
    const q2Report = reportMap.get(`${year}-11012`);
    const q3Report = reportMap.get(`${year}-11014`);
    const q4Report = reportMap.get(`${year}-11011`);

    const q1Cum = q1Report ? extractIS(q1Report.items) : null;
    const q2Cum = q2Report ? extractIS(q2Report.items) : null;
    const q3Cum = q3Report ? extractIS(q3Report.items) : null;
    const q4Cum = q4Report ? extractIS(q4Report.items) : null;

    // 재무상태표는 누적이 아니므로 그대로
    const q1BS = q1Report ? extractBS(q1Report.items) : null;
    const q2BS = q2Report ? extractBS(q2Report.items) : null;
    const q3BS = q3Report ? extractBS(q3Report.items) : null;
    const q4BS = q4Report ? extractBS(q4Report.items) : null;

    // Q1: 누적 = Q1
    if (q1Cum) {
      points.push(
        makePoint(year, 1, {
          revenue: q1Cum.revenue,
          operatingProfit: q1Cum.operatingProfit,
          netIncome: q1Cum.netIncome,
          ...nullBS(q1BS),
        }),
      );
    }

    // Q2: Q2(반기 누적) - Q1
    if (q2Cum) {
      points.push(
        makePoint(year, 2, {
          revenue: subtract(q2Cum.revenue, q1Cum?.revenue ?? null),
          operatingProfit: subtract(
            q2Cum.operatingProfit,
            q1Cum?.operatingProfit ?? null,
          ),
          netIncome: subtract(q2Cum.netIncome, q1Cum?.netIncome ?? null),
          ...nullBS(q2BS),
        }),
      );
    }

    // Q3: Q3(누적) - Q2(반기 누적)
    if (q3Cum) {
      points.push(
        makePoint(year, 3, {
          revenue: subtract(q3Cum.revenue, q2Cum?.revenue ?? null),
          operatingProfit: subtract(
            q3Cum.operatingProfit,
            q2Cum?.operatingProfit ?? null,
          ),
          netIncome: subtract(q3Cum.netIncome, q2Cum?.netIncome ?? null),
          ...nullBS(q3BS),
        }),
      );
    }

    // Q4: 사업(연간) - Q3(누적)
    if (q4Cum) {
      points.push(
        makePoint(year, 4, {
          revenue: subtract(q4Cum.revenue, q3Cum?.revenue ?? null),
          operatingProfit: subtract(
            q4Cum.operatingProfit,
            q3Cum?.operatingProfit ?? null,
          ),
          netIncome: subtract(q4Cum.netIncome, q3Cum?.netIncome ?? null),
          ...nullBS(q4BS),
        }),
      );
    }
  }

  // 최신순으로 자른 후 다시 시간순 정렬
  return points.slice(-maxQuarters);
}

function nullBS(bs: BalanceSheet | null): BalanceSheet {
  return bs ?? { totalAssets: null, totalLiabilities: null, totalEquity: null };
}

function makePoint(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  data: Partial<Omit<QuarterlyDataPoint, 'year' | 'quarter' | 'label'>>,
): QuarterlyDataPoint {
  const yearShort = String(year).slice(-2);
  const label = `${yearShort}년 ${QUARTER_LABEL[quarter]}`;

  const revenue = data.revenue ?? null;
  const operatingProfit = data.operatingProfit ?? null;
  const netIncome = data.netIncome ?? null;
  const totalAssets = data.totalAssets ?? null;
  const totalLiabilities = data.totalLiabilities ?? null;
  const totalEquity = data.totalEquity ?? null;

  return {
    year,
    quarter,
    label,
    revenue,
    operatingProfit,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netMargin:
      revenue && netIncome !== null && revenue !== 0
        ? (netIncome / revenue) * 100
        : null,
    operatingMargin:
      revenue && operatingProfit !== null && revenue !== 0
        ? (operatingProfit / revenue) * 100
        : null,
    debtRatio:
      totalLiabilities !== null && totalEquity && totalEquity !== 0
        ? (totalLiabilities / totalEquity) * 100
        : null,
  };
}

/**
 * 분기 시계열에서 직전 분기 대비 성장률 계산
 *
 * @example
 * const growth = getQuarterOverQuarterChange(quarters, 'netIncome');
 * // 최신 분기 vs 직전 분기 (소수점 백분율)
 */
export function getQuarterOverQuarterChange(
  quarters: readonly QuarterlyDataPoint[],
  field: 'revenue' | 'operatingProfit' | 'netIncome',
): number | null {
  if (quarters.length < 2) return null;
  const last = quarters[quarters.length - 1];
  const prev = quarters[quarters.length - 2];
  if (!last || !prev) return null;

  const lastVal = last[field];
  const prevVal = prev[field];
  if (lastVal === null || prevVal === null || prevVal === 0) return null;

  return ((lastVal - prevVal) / Math.abs(prevVal)) * 100;
}

/** 보고서 코드 → 분기 번호 노출 (테스트 등에서 사용) */
export { REPORT_TO_QUARTER };
