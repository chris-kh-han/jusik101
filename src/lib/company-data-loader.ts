/**
 * 회사 페이지용 데이터 로더
 *
 * D1 캐시 우선 → DART API fallback.
 * 12분기 + 4 재무비율 + 1 배당 + 1 기업개황 = 18개 호출 (캐시 hit이면 0회).
 *
 * 모든 fetch는 Promise.allSettled로 병렬 — 일부 실패해도 가능한 섹션 표시.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  fetchCompanyDetail,
  fetchFinancialStatements,
  fetchFinancialIndex,
  fetchDividend,
  INDEX_CATEGORIES,
  type DartCompanyDetail,
  type DartFinancialIndex,
  type DartDividendItem,
  type IndexCategoryCode,
} from './dart-api';
import { cacheOrFetch } from './financial-cache';
import type { DartFinancialItem, ReportCode, FsDiv } from '@/types/financial';

const REPORT_CODES: readonly ReportCode[] = [
  '11013', // 1분기
  '11012', // 반기
  '11014', // 3분기
  '11011', // 사업
];

export interface QuarterlyReport {
  readonly year: number;
  readonly reportCode: ReportCode;
  readonly items: readonly DartFinancialItem[];
}

/**
 * 12분기 데이터 fetch (3년치)
 */
export async function loadQuarterlyReports(
  db: D1Database | null,
  corpCode: string,
  endYear: number,
  fsDiv: FsDiv = 'CFS',
): Promise<readonly QuarterlyReport[]> {
  // 3년 × 4보고서 = 12개
  const targets: Array<{ year: number; reportCode: ReportCode }> = [];
  for (let y = endYear - 2; y <= endYear; y++) {
    for (const code of REPORT_CODES) {
      targets.push({ year: y, reportCode: code });
    }
  }

  const settled = await Promise.allSettled(
    targets.map(async ({ year, reportCode }) => {
      const items = await cacheOrFetch(
        db,
        {
          corpCode,
          bsnsYear: year,
          reprtCode: reportCode,
          fsDiv,
          endpoint: 'fnlttSinglAcntAll',
        },
        () => fetchFinancialStatements(corpCode, year, reportCode, fsDiv),
      );
      return { year, reportCode, items };
    }),
  );

  return settled
    .filter(
      (r): r is PromiseFulfilledResult<QuarterlyReport> =>
        r.status === 'fulfilled' && r.value.items.length > 0,
    )
    .map((r) => r.value);
}

/**
 * 재무비율 4 카테고리 fetch
 */
export async function loadFinancialIndices(
  db: D1Database | null,
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
): Promise<readonly DartFinancialIndex[]> {
  const settled = await Promise.allSettled(
    INDEX_CATEGORIES.map(async (idxClCode: IndexCategoryCode) => {
      return cacheOrFetch(
        db,
        {
          corpCode,
          bsnsYear: year,
          reprtCode: reportCode,
          endpoint: 'fnlttSinglIndx',
          idxClCode,
        },
        () => fetchFinancialIndex(corpCode, year, reportCode, idxClCode),
      );
    }),
  );

  const all: DartFinancialIndex[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    }
  }
  return all;
}

/** 배당 데이터 fetch */
export async function loadDividend(
  db: D1Database | null,
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
): Promise<readonly DartDividendItem[]> {
  try {
    return await cacheOrFetch(
      db,
      {
        corpCode,
        bsnsYear: year,
        reprtCode: reportCode,
        endpoint: 'alotMatter',
      },
      () => fetchDividend(corpCode, year, reportCode),
    );
  } catch {
    return [];
  }
}

/** 기업 개황 fetch (CEO, 홈페이지 등 raw 데이터) */
export async function loadCompanyInfo(
  db: D1Database | null,
  corpCode: string,
): Promise<DartCompanyDetail | null> {
  try {
    return await cacheOrFetch(
      db,
      {
        corpCode,
        bsnsYear: new Date().getFullYear(),
        reprtCode: '-',
        endpoint: 'company',
      },
      async () => {
        const detail = await fetchCompanyDetail(corpCode);
        if (!detail) throw new Error('company info not found');
        return detail;
      },
    );
  } catch {
    return null;
  }
}

/**
 * 회사 페이지에 필요한 모든 데이터 한 번에 로드
 *
 * 캐시 hit 시 0회 외부 호출.
 * 캐시 miss 시 12 (분기) + 4 (재무비율) + 1 (배당) + 1 (개황) = 18회 병렬 호출.
 */
export async function loadCompanyPageData(
  db: D1Database | null,
  corpCode: string,
  endYear: number,
  fsDiv: FsDiv = 'CFS',
) {
  const [quarterlyReports, indices, dividend, companyInfo] = await Promise.all([
    loadQuarterlyReports(db, corpCode, endYear, fsDiv),
    loadFinancialIndices(db, corpCode, endYear, '11011'),
    loadDividend(db, corpCode, endYear, '11011'),
    loadCompanyInfo(db, corpCode),
  ]);

  return { quarterlyReports, indices, dividend, companyInfo };
}

/** 재무비율 raw → InvestmentMetrics + StabilityMetrics 매핑 */
export function extractMetricsFromIndices(
  indices: readonly DartFinancialIndex[],
): {
  investment: {
    roe: number | null;
  };
  stability: {
    debtRatio: number | null;
    currentRatio: number | null;
  };
} {
  const findVal = (idxNm: string): number | null => {
    const item = indices.find((i) => i.idx_nm === idxNm);
    if (!item || !item.idx_val || item.idx_val === '-') return null;
    const n = Number(item.idx_val.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  return {
    investment: {
      roe: findVal('ROE'),
    },
    stability: {
      debtRatio: findVal('부채비율'),
      currentRatio: findVal('유동비율'),
    },
  };
}

/** 한 시점의 배당/EPS 데이터 */
export interface DividendSnapshot {
  readonly periodLabel: string; // '당기' | '전기' | '전전기' (또는 결산일)
  readonly dividendYield: number | null; // 배당수익률 %
  readonly dividendPerShare: number | null; // 주당 현금배당금 (원)
  readonly payoutRatio: number | null; // 배당성향 %
  readonly eps: number | null; // (연결)주당순이익 (원)
}

/** alotMatter 응답을 3년치 시계열로 변환 + BPS 계산용 보조 정보 */
export interface DividendData {
  /** 최신 시점 (당기) */
  readonly current: DividendSnapshot;
  /** 다년치 (당기/전기/전전기 순) */
  readonly history: readonly DividendSnapshot[];
  /** EPS와 순이익으로 역산한 추정 발행주식수 (BPS 계산용) */
  readonly estimatedShares: number | null;
  /** 결산일 (당기) */
  readonly stlmDt: string;
}

/** 배당 raw → 3년치 + EPS + 추정 발행주식수 */
export function extractDividendData(
  dividend: readonly DartDividendItem[],
): DividendData {
  const parseFloat3 = (raw: string | undefined): number | null => {
    if (!raw || raw === '-' || raw === '') return null;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // 보통주 우선
  const findItem = (se: string) => {
    const common = dividend.find(
      (d) => d.se === se && d.stock_knd === '보통주',
    );
    return common ?? dividend.find((d) => d.se === se);
  };

  // 3개 기간 (당기/전기/전전기) 추출
  const periods: Array<
    keyof Pick<DartDividendItem, 'thstrm' | 'frmtrm' | 'lwfr'>
  > = ['thstrm', 'frmtrm', 'lwfr'];

  // stlm_dt에서 연도 파싱 (예: '2024-12-31' → 2024) 후 N년 전 계산
  const stlmDt = dividend[0]?.stlm_dt ?? '';
  const baseYear = stlmDt.length >= 4 ? parseInt(stlmDt.slice(0, 4), 10) : null;
  const baseMonth = stlmDt.length >= 7 ? parseInt(stlmDt.slice(5, 7), 10) : 12;

  // 결산월 표시 (2024년 12월처럼)
  const periodWithMonth: Record<(typeof periods)[number], string> = {
    thstrm: baseYear ? `${baseYear}년 ${baseMonth}월` : '당기',
    frmtrm: baseYear ? `${baseYear - 1}년 ${baseMonth}월` : '전기',
    lwfr: baseYear ? `${baseYear - 2}년 ${baseMonth}월` : '전전기',
  };

  const yieldItem = findItem('현금배당수익률(%)');
  const dpsItem = findItem('주당 현금배당금(원)');
  const payoutItem = findItem('(연결)현금배당성향(%)');
  const epsItem = findItem('(연결)주당순이익(원)');
  const netIncomeItem = findItem('(연결)당기순이익(백만원)');

  const history: DividendSnapshot[] = periods.map((p) => ({
    periodLabel: periodWithMonth[p],
    dividendYield: parseFloat3(yieldItem?.[p]),
    dividendPerShare: parseFloat3(dpsItem?.[p]),
    payoutRatio: parseFloat3(payoutItem?.[p]),
    eps: parseFloat3(epsItem?.[p]),
  }));

  const current = history[0]!;

  // 발행주식수 = 당기순이익(백만원 → 원) / EPS(원)
  const netIncomeMillion = parseFloat3(netIncomeItem?.thstrm);
  const epsCurrent = current.eps;
  const estimatedShares =
    netIncomeMillion && epsCurrent && epsCurrent !== 0
      ? Math.round((netIncomeMillion * 1_000_000) / epsCurrent)
      : null;

  return {
    current,
    history,
    estimatedShares,
    stlmDt: dividend[0]?.stlm_dt ?? '',
  };
}

/**
 * 발행주식수와 자본총계로 BPS (주당순자산) 계산
 *
 * @example
 * const bps = calculateBPS(estimatedShares, totalEquity);
 * // BPS = 자본총계 / 발행주식수
 */
export function calculateBPS(
  shares: number | null,
  totalEquity: number | null,
): number | null {
  if (!shares || !totalEquity || shares === 0) return null;
  return Math.round(totalEquity / shares);
}

/**
 * 시가총액 기반 가치평가 비율 계산 (PER/PBR/PSR)
 *
 * @param marketCap 시가총액 (원)
 * @param netIncome 당기순이익 (원, 연환산)
 * @param totalEquity 자본총계 (원, BS 시점값)
 * @param revenue 매출액 (원, 연환산)
 *
 * @returns { per, pbr, psr } 분모가 0/음수면 null
 */
export function calculateValuationRatios(
  marketCap: number | null,
  netIncome: number | null,
  totalEquity: number | null,
  revenue: number | null,
): { per: number | null; pbr: number | null; psr: number | null } {
  const safeRatio = (
    numerator: number | null,
    denominator: number | null,
  ): number | null => {
    if (!numerator || !denominator || denominator <= 0) return null;
    const result = numerator / denominator;
    return Number.isFinite(result) ? Number(result.toFixed(2)) : null;
  };

  return {
    per: safeRatio(marketCap, netIncome),
    pbr: safeRatio(marketCap, totalEquity),
    psr: safeRatio(marketCap, revenue),
  };
}

/** 하위 호환을 위한 wrapper (기존 코드 사용처용) */
export function extractDividendMetrics(dividend: readonly DartDividendItem[]) {
  const data = extractDividendData(dividend);
  return {
    dividendYield: data.current.dividendYield,
    dividendPerShare: data.current.dividendPerShare,
    payoutRatio: data.current.payoutRatio,
    eps: data.current.eps,
    estimatedShares: data.estimatedShares,
  };
}
